import type { ReplyData } from "../types.js";

/**
 * AI is the last gate for *text* judgments. Profile extremes are handled offline.
 * Keep prompt short — fewer rules, fewer hallucinated bot labels.
 */
export const SYSTEM_PROMPT = `You classify X/Twitter replies. Default GENUINE human.

is_bot=true only if evidence is strong (prefer missing bots over false bots).
Short chat ("true","gm","lol","exactly","great post") is almost always human.
Missing profile fields are NEUTRAL — never invent red flags.

is_bot may be true when 2+ of:
- Extreme follow-farm metadata (following ≥2500, followers <120, ratio ≥30) when counts given
- Clear scam/promo spam (wallets, fake giveaways, mass identical promo)
- Obvious automation with no human substance

is_bot must be false when:
- Verified, or followers ≥2000 with normal conversation
- Only a short friendly reply
- Counts unknown

is_slop=true only for empty farm catchphrases or clear LLM paste with no post-specific content (is_bot still false unless profile also screams farm).

confidence ≥ 0.85 required for is_bot=true. Unsure → is_bot=false, category=genuine.

Output JSON only:
is_bot, is_slop, confidence, category (genuine|airdrop_farmer|engagement_farmer|crypto_spam|llm_slop|sycophant|self_promoter), reason, signals[]`;

function formatReplyBlock(r: ReplyData, i: number): string {
	const parts: string[] = [`REPLY ${i + 1}: @${r.username} (${r.displayName})`, `Text: "${r.replyText || "[empty]"}"`];
	if (r.originalTweetText) {
		parts.push(`OP: "${String(r.originalTweetText).slice(0, 300)}"`);
	}
	if (r.bio) parts.push(`Bio: "${String(r.bio).slice(0, 200)}"`);
	if (r.followers > 0 || r.following > 0) {
		const ratio = r.following / Math.max(r.followers, 1);
		parts.push(`Followers: ${r.followers} Following: ${r.following} ratio: ${ratio.toFixed(1)}x`);
	} else {
		parts.push("Followers/following: unknown");
	}
	if (r.accountCreatedAt) parts.push(`Created: ${r.accountCreatedAt}`);
	if (r.isVerified) parts.push("Verified: true");
	if (r.hasCustomAvatar === false) parts.push("Default avatar: true");
	return parts.join("\n");
}

export function buildUserMessage(replies: ReplyData[]): string {
	const body = replies.map((r, i) => formatReplyBlock(r, i)).join("\n\n---\n\n");
	return `Classify ${replies.length} replies. JSON array length ${replies.length}, no markdown.\n\n${body}\n\n[{"is_bot":...,"is_slop":...,"confidence":...,"category":"...","reason":"...","signals":[...]}, ...]`;
}

export function buildSingleUserMessage(reply: ReplyData): string {
	return `Classify. JSON object only, no markdown.\n\n${formatReplyBlock(reply, 0)}\n\n{"is_bot":...,"is_slop":...,"confidence":...,"category":"...","reason":"...","signals":[...]}`;
}
