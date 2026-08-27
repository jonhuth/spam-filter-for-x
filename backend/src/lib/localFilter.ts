import type { BotVerdict, ReplyData } from "../types.js";

/**
 * Server local score — keep in sync with extension/botDetection.js.
 * Profile high-signal gates only (see docs/agent/scoring.md). No text heuristics.
 */

function verdict(partial: Omit<BotVerdict, "source"> & { source?: BotVerdict["source"] }): BotVerdict {
	return {
		isBot: Boolean(partial.isBot),
		isSlop: Boolean(partial.isSlop),
		confidence: Math.min(1, Math.max(0, Number(partial.confidence) || 0.5)),
		category: partial.category,
		reason: partial.reason,
		signals: Array.isArray(partial.signals) ? partial.signals.slice(0, 5) : [],
		source: "local",
	};
}

function hasKnownProfileCounts(reply: ReplyData): boolean {
	return (
		(Number.isFinite(reply.followers) && reply.followers > 0) ||
		(Number.isFinite(reply.following) && reply.following > 0)
	);
}

function accountAgeDays(createdAt: string | undefined | null): number | null {
	if (!createdAt) return null;
	const t = Date.parse(String(createdAt));
	if (!Number.isFinite(t)) return null;
	return (Date.now() - t) / (24 * 60 * 60 * 1000);
}

export function localClassifyReply(reply: ReplyData): BotVerdict | null {
	if (reply.isVerified) return null;

	const extreme = classifyExtremeFarmProfile(reply);
	if (extreme) return extreme;

	const shell = classifyNewShellFarm(reply);
	if (shell) return shell;

	return null;
}

/** Gate A: extreme following/followers ratio */
export function classifyFollowRatio(reply: ReplyData): BotVerdict | null {
	return classifyExtremeFarmProfile(reply);
}

export function classifyExtremeFarmProfile(reply: ReplyData): BotVerdict | null {
	if (!hasKnownProfileCounts(reply)) return null;
	const followers = Math.max(0, Number(reply.followers) || 0);
	const following = Math.max(0, Number(reply.following) || 0);
	if (following < 2500) return null;
	const ratio = following / Math.max(followers, 1);
	if (!(followers < 120 && ratio >= 30)) return null;

	const ratioLabel = `${Math.round(ratio)}:1`;
	return verdict({
		isBot: true,
		isSlop: true,
		confidence: 0.9,
		category: "airdrop_farmer",
		reason: `Extreme follow-farm profile: following ${following} vs ${followers} followers (${ratioLabel})`,
		signals: ["profile_ratio_extreme", `following_${following}`, `followers_${followers}`],
	});
}

/** Gate B: new shell + mass follow + default avatar */
export function classifyNewShellFarm(reply: ReplyData): BotVerdict | null {
	if (!hasKnownProfileCounts(reply)) return null;
	if (reply.hasCustomAvatar !== false) return null;
	const age = accountAgeDays(reply.accountCreatedAt);
	if (age == null || age > 45) return null;

	const followers = Math.max(0, Number(reply.followers) || 0);
	const following = Math.max(0, Number(reply.following) || 0);
	if (following < 1500 || followers >= 80) return null;
	const ratio = following / Math.max(followers, 1);
	if (ratio < 20) return null;

	return verdict({
		isBot: true,
		isSlop: true,
		confidence: 0.88,
		category: "airdrop_farmer",
		reason: `New shell account (~${Math.round(age)}d) mass-following with default avatar`,
		signals: ["profile_new_shell", `age_days_${Math.round(age)}`, `ratio_${Math.round(ratio)}`],
	});
}
