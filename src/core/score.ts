// Explainable reply/post scoring: a sum of named, weighted signals.
// Bias: missing a bot is better than flagging a person. Hard trust always wins.

import type { ThreadContext } from "./context";
import { BLOC_LABEL, type Bloc, resolvePlace } from "./country";
import { textFeatures } from "./text";
import type { Account, Post } from "./types";

export type Label = "trusted" | "ok" | "slop" | "farm";

export interface Signal {
	id: string;
	weight: number;
	/** Human-readable reason shown in the "why" popover. */
	reason: string;
	/** Strong signals can justify "farm" on their own combined with others. */
	strong?: boolean;
}

export interface Verdict {
	label: Label;
	score: number;
	signals: Signal[];
}

export type Sensitivity = "relaxed" | "balanced" | "strict";

const THRESHOLDS: Record<Sensitivity, { slop: number; farm: number }> = {
	relaxed: { slop: 3.5, farm: 5.5 },
	balanced: { slop: 2.5, farm: 4.5 },
	strict: { slop: 1.8, farm: 3.5 },
};

export interface ScoreInput {
	account?: Account;
	post: Post;
	parentText?: string;
	context?: ThreadContext;
	/** Size of the near-duplicate cluster this post belongs to, if any. */
	clusterSize?: number;
	/** Blocs the user considers home — never counted as off-region. */
	homeBlocs?: Bloc[];
	/** Canonical names of countries the user wants weighted as suspicious. */
	watchCountries?: string[];
	trusted?: boolean;
	/** Your own 👍/👎 on this account. */
	feedback?: "fine" | "spam";
	now?: number;
	sensitivity?: Sensitivity;
}

const DAY = 86_400_000;

export function accountSignals(a: Account | undefined, now: number): Signal[] {
	if (!a) return [];
	const out: Signal[] = [];
	const { followers, following } = a;
	const known = followers !== undefined && following !== undefined;
	const ratio = known ? following / Math.max(followers, 1) : 0;
	const ageDays = a.createdAt ? (now - a.createdAt) / DAY : undefined;

	if (known && following >= 2500 && followers < 120 && ratio >= 30 && !a.verified) {
		out.push({
			id: "farm-ratio",
			weight: 3,
			strong: true,
			reason: `Follows ${following.toLocaleString()}, followed by ${followers}`,
		});
	} else if (
		known &&
		ageDays !== undefined &&
		ageDays <= 45 &&
		following >= 1500 &&
		followers < 80 &&
		ratio >= 20
	) {
		out.push({
			id: "new-shell",
			weight: 3,
			strong: true,
			reason: `New account mass-following (${Math.round(ageDays)}d old)`,
		});
	}

	if (ageDays !== undefined) {
		if (ageDays < 30)
			out.push({ id: "age-30", weight: 1.2, reason: `Account ${Math.round(ageDays)} days old` });
		else if (ageDays < 120)
			out.push({ id: "age-120", weight: 0.6, reason: `Account ${Math.round(ageDays)} days old` });
		else if (ageDays > 5 * 365 && (followers ?? 0) >= 300)
			out.push({ id: "established", weight: -1.5, reason: "Established account" });
	}
	if (a.defaultAvatar) out.push({ id: "default-avatar", weight: 0.6, reason: "Default avatar" });
	if (/\d{6,}$/.test(a.handle))
		out.push({ id: "default-handle", weight: 0.5, reason: "Auto-generated handle" });
	if (a.blueVerified && known && followers < 150 && !a.verified)
		out.push({ id: "paid-boost", weight: 0.8, reason: "Paid checkmark, tiny audience" });
	if ((a.about?.usernameChanges ?? 0) >= 3)
		out.push({
			id: "renamed",
			weight: 0.8,
			reason: `Renamed ${a.about!.usernameChanges} times`,
		});
	if ((followers ?? 0) >= 20_000 && !a.blueVerified)
		out.push({ id: "large-organic", weight: -1, reason: "Large organic following" });
	return out;
}

export function geoSignals(
	a: Account | undefined,
	context: ThreadContext | undefined,
	homeBlocs: Bloc[],
	watchCountries: string[],
): Signal[] {
	const about = a?.about;
	if (!about?.basedIn) return [];
	const out: Signal[] = [];
	const place = resolvePlace(about.basedIn);
	if (!place) return out;

	if (
		place.bloc &&
		context?.bloc &&
		place.bloc !== context.bloc &&
		!homeBlocs.includes(place.bloc)
	) {
		const where = BLOC_LABEL[context.bloc];
		out.push(
			context.political
				? {
						id: "off-region-politics",
						weight: 2,
						reason: `${place.emoji} ${place.name} account in ${where} politics`,
					}
				: {
						id: "off-region",
						weight: 0.5,
						reason: `${place.emoji} ${place.name} account in a ${where} thread`,
					},
		);
	}
	if (about.locationAccurate === false)
		out.push({
			id: "location-masked",
			weight: 0.7,
			reason: "X flags location as possibly inaccurate (VPN/proxy)",
		});

	const sourcePlace = storeCountry(about.source);
	if (
		sourcePlace &&
		place.kind === "country" &&
		sourcePlace.code &&
		sourcePlace.code !== place.code
	) {
		out.push({
			id: "store-mismatch",
			weight: 1.2,
			reason: `Based in ${place.name} but connects via ${sourcePlace.name} app store`,
		});
	}
	if (watchCountries.some((c) => c.toLowerCase() === place.name.toLowerCase()))
		out.push({
			id: "watch-country",
			weight: 1.5,
			reason: `${place.emoji} ${place.name} is on your watch list`,
		});
	return out;
}

/** "United States App Store" → United States. */
function storeCountry(source: string | undefined) {
	const m = source?.match(/^(.+?)\s+(?:App Store|Android App|Play Store|Google Play)$/i);
	if (!m?.[1]) return null;
	const p = resolvePlace(m[1]);
	return p?.kind === "country" ? p : null;
}

export function textSignals(
	post: Post,
	parentText: string | undefined,
	isReply: boolean,
): Signal[] {
	const f = textFeatures(post.text, parentText);
	const out: Signal[] = [];
	if (f.spamCta)
		out.push({ id: "spam-cta", weight: 3, strong: true, reason: `Spam bait: “${f.spamCta}”` });
	if (!isReply) return out;
	if (f.genericPraise)
		out.push({ id: "generic-praise", weight: 1, reason: `Generic reply: “${f.genericPraise}”` });
	if (f.aiStyle)
		out.push({ id: "ai-style", weight: 1, reason: `AI-style phrasing: “${f.aiStyle}”` });
	if (f.emojiOnly && f.emojiCount >= 2)
		out.push({ id: "emoji-only", weight: 0.5, reason: "Emoji-only reply" });
	if (f.hashtagCount >= 3)
		out.push({ id: "hashtags", weight: 0.6, reason: "Hashtag-stuffed reply" });
	if (f.parentEcho >= 0.5 && f.wordCount >= 6)
		out.push({ id: "echo", weight: 1, reason: "Restates the post it replies to" });
	return out;
}

export function scorePost(input: ScoreInput): Verdict {
	const now = input.now ?? Date.now();
	const a = input.account;
	if (input.trusted || a?.youFollow)
		return {
			label: "trusted",
			score: 0,
			signals: [
				{
					id: "trusted",
					weight: 0,
					reason: input.trusted ? "You trust this account" : "You follow them",
				},
			],
		};

	const isReply = Boolean(input.post.inReplyToId);
	const signals: Signal[] = [
		...accountSignals(a, now),
		...geoSignals(a, input.context, input.homeBlocs ?? [], input.watchCountries ?? []),
		...textSignals(input.post, input.parentText, isReply),
	];
	if (a?.followsYou) signals.push({ id: "follows-you", weight: -2, reason: "Follows you" });
	if (input.feedback === "fine")
		signals.push({ id: "your-fine", weight: -4, reason: "You marked this account fine" });
	if (input.feedback === "spam")
		signals.push({
			id: "your-spam",
			weight: 4,
			strong: true,
			reason: "You marked this account spam",
		});
	if ((input.clusterSize ?? 0) >= 3)
		signals.push({
			id: "duplicate-cluster",
			weight: 2.5,
			strong: true,
			reason: `Near-identical to ${input.clusterSize! - 1} other replies`,
		});

	const score = Math.round(signals.reduce((s, x) => s + x.weight, 0) * 10) / 10;
	const t = THRESHOLDS[input.sensitivity ?? "balanced"];
	const hasStrong = signals.some((s) => s.strong);
	// Farm needs a strong signal: weak signals alone only ever reach "slop".
	const label: Label =
		score >= t.farm && hasStrong
			? "farm"
			: score >= t.slop && (isReply || hasStrong)
				? "slop"
				: "ok";
	return { label, score, signals: signals.sort((x, y) => y.weight - x.weight) };
}
