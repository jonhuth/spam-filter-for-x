import Anthropic from "@anthropic-ai/sdk";
import { Hono } from "hono";

const app = new Hono();
const anthropic = new Anthropic();

interface SuggestBody {
	seed?: string;
	kind?: "word" | "account";
	limit?: number;
}

/**
 * Expand a mute seed into related words/phrases for bulk mute lists.
 * Offline client also has STEM_PACKS — this is the optional AI boost.
 */
app.post("/", async (c) => {
	try {
		const body = (await c.req.json()) as SuggestBody;
		const seed = String(body.seed || "")
			.trim()
			.slice(0, 80);
		const kind = body.kind === "account" ? "account" : "word";
		const limit = Math.min(24, Math.max(4, Number(body.limit) || 12));

		if (!seed) {
			return c.json({ error: "seed is required" }, 400);
		}

		if (!process.env.ANTHROPIC_API_KEY) {
			return c.json({ suggestions: [], source: "unavailable" });
		}

		const system =
			kind === "account"
				? `You suggest Twitter/X spam account name patterns to mute/block.
Return ONLY a JSON array of short strings (handles without @), max ${limit} items.
No markdown, no commentary.`
				: `You help build X/Twitter mute-word lists for spam, crypto shills, engagement farming, and scams.
Given a seed term, suggest related mute words and short phrases a user might want to mute.
Rules:
- Return ONLY a JSON array of strings, max ${limit} items
- Include morphological variants, common slang, and co-occurring spam phrases
- Prefer high-precision spam terms; avoid generic English (the, good, love)
- No markdown fences, no commentary`;

		const message = await anthropic.messages.create({
			model: "claude-haiku-4-5-20251001",
			max_tokens: 400,
			system,
			messages: [
				{
					role: "user",
					content: `Seed: ${JSON.stringify(seed)}\nReturn JSON array of up to ${limit} suggestions.`,
				},
			],
		});

		const content = message.content[0];
		if (content.type !== "text") {
			return c.json({ suggestions: [], source: "ai" });
		}

		const cleaned = content.text
			.replace(/```json\n?/g, "")
			.replace(/```\n?/g, "")
			.trim();
		let parsed: unknown;
		try {
			parsed = JSON.parse(cleaned);
		} catch {
			// try extract array
			const m = cleaned.match(/\[[\s\S]*\]/);
			parsed = m ? JSON.parse(m[0]) : [];
		}

		const suggestions = (Array.isArray(parsed) ? parsed : [])
			.map((x) => String(x || "").trim())
			.filter((x) => x.length >= 2 && x.length <= 60)
			.slice(0, limit);

		return c.json({ suggestions, source: "ai", seed });
	} catch (error) {
		console.error("suggest-mutes error:", error);
		return c.json({ error: "Internal server error", suggestions: [] }, 500);
	}
});

export default app;
