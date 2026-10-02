import Anthropic from "@anthropic-ai/sdk";
import type { BotVerdict, ReplyData, SpamCategory } from "../types.js";
import { SYSTEM_PROMPT, buildSingleUserMessage, buildUserMessage } from "./prompt.js";

const anthropic = new Anthropic();

interface AIResponse {
	is_bot: boolean;
	is_slop?: boolean;
	confidence: number;
	category: SpamCategory;
	reason: string;
	signals: string[];
}

function parseAIResponse(text: string): AIResponse | null {
	try {
		const cleaned = text
			.replace(/```json\n?/g, "")
			.replace(/```\n?/g, "")
			.trim();
		const parsed = JSON.parse(cleaned);
		return normalizeParsed(parsed);
	} catch {
		console.error("Failed to parse AI response:", text.substring(0, 200));
		return null;
	}
}

function normalizeParsed(parsed: Record<string, unknown>): AIResponse {
	const isBot = Boolean(parsed.is_bot);
	const isSlop = parsed.is_slop !== undefined ? Boolean(parsed.is_slop) : isBot;
	return {
		is_bot: isBot,
		is_slop: isSlop,
		confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5)),
		category: validateCategory(parsed.category),
		reason: String(parsed.reason || "Unknown"),
		signals: Array.isArray(parsed.signals) ? (parsed.signals as unknown[]).map(String).slice(0, 5) : [],
	};
}

function parseBatchAIResponse(text: string, expectedCount: number): AIResponse[] {
	try {
		const cleaned = text
			.replace(/```json\n?/g, "")
			.replace(/```\n?/g, "")
			.trim();
		const parsed = JSON.parse(cleaned);

		if (!Array.isArray(parsed)) {
			if (expectedCount === 1 && typeof parsed === "object" && parsed) {
				return [normalizeParsed(parsed as Record<string, unknown>)];
			}
			console.error("Batch response is not an array");
			return [];
		}

		return parsed.map((item: Record<string, unknown>) => normalizeParsed(item));
	} catch {
		console.error("Failed to parse batch AI response:", text.substring(0, 200));
		return [];
	}
}

function validateCategory(cat: unknown): SpamCategory {
	const valid: SpamCategory[] = [
		"engagement_farmer",
		"sycophant",
		"self_promoter",
		"airdrop_farmer",
		"crypto_spam",
		"llm_slop",
		"genuine",
	];
	if (typeof cat === "string" && valid.includes(cat as SpamCategory)) {
		return cat as SpamCategory;
	}
	return "crypto_spam";
}

/** Min confidence to accept AI is_bot — weak bot calls become human (cut FPs). */
const AI_BOT_MIN_CONF = 0.85;

function toVerdict(parsed: AIResponse): BotVerdict {
	let isBot = Boolean(parsed.is_bot);
	let isSlop = parsed.is_slop !== undefined ? Boolean(parsed.is_slop) : isBot;
	let confidence = Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5));
	let category = parsed.category;
	let reason = parsed.reason;

	// Soft AI bot flags are a major FP source — demote to slop or genuine
	if (isBot && confidence < AI_BOT_MIN_CONF) {
		isBot = false;
		isSlop = isSlop || confidence >= 0.55;
		category = isSlop ? "llm_slop" : "genuine";
		reason = isSlop
			? `${reason} (downgraded: weak bot confidence)`
			: `${reason} (downgraded to human: weak bot confidence)`;
		confidence = isSlop ? Math.max(confidence, 0.6) : Math.max(1 - confidence, 0.7);
	}

	return {
		isBot,
		isSlop: isBot ? true : isSlop,
		confidence,
		category,
		reason,
		signals: parsed.signals,
		source: "ai",
	};
}

export async function classifySingleReply(reply: ReplyData): Promise<BotVerdict | null> {
	if (!process.env.ANTHROPIC_API_KEY) {
		return null;
	}

	try {
		const message = await anthropic.messages.create({
			model: "claude-haiku-4-5-20251001",
			max_tokens: 280,
			system: SYSTEM_PROMPT,
			messages: [{ role: "user", content: buildSingleUserMessage(reply) }],
		});

		const content = message.content[0];
		if (content.type !== "text") return null;

		const parsed = parseAIResponse(content.text);
		if (!parsed) return null;

		return toVerdict(parsed);
	} catch (error) {
		console.error("Anthropic API error:", error);
		return null;
	}
}

export async function classifyBatchReplies(replies: ReplyData[]): Promise<(BotVerdict | null)[]> {
	if (replies.length === 0) return [];
	if (!process.env.ANTHROPIC_API_KEY) {
		return replies.map(() => null);
	}
	if (replies.length === 1) {
		const result = await classifySingleReply(replies[0]);
		return [result];
	}

	try {
		const message = await anthropic.messages.create({
			model: "claude-haiku-4-5-20251001",
			max_tokens: 640,
			system: SYSTEM_PROMPT,
			messages: [{ role: "user", content: buildUserMessage(replies) }],
		});

		const content = message.content[0];
		if (content.type !== "text") {
			return replies.map(() => null);
		}

		const parsed = parseBatchAIResponse(content.text, replies.length);

		const results: (BotVerdict | null)[] = [];
		for (let i = 0; i < replies.length; i++) {
			if (parsed[i]) {
				results.push(toVerdict(parsed[i]));
			} else {
				results.push(null);
			}
		}

		return results;
	} catch (error) {
		console.error("Anthropic API batch error:", error);
		return replies.map(() => null);
	}
}
