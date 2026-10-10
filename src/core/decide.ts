// Pure decision: given everything known about a post, what to show.
// Order: block/mute/muted words > trust > hidden countries > score-based action.

import type { Settings } from "../shared/settings";
import { matchesMutedWord } from "../shared/settings";
import type { ThreadContext } from "./context";
import { type Place, resolvePlace } from "./country";
import { scorePost, type Verdict } from "./score";
import type { Account, Post } from "./types";

/** "fold": hidden inside a thread's single summary bar. */
export type Visibility = "show" | "collapse" | "hide" | "fold";

export interface Decision {
	visibility: Visibility;
	/** Short reason for the collapsed bar. */
	summary: string;
	verdict: Verdict;
	place: Place | null;
	masked: boolean;
	/** Set when hidden by your lists (muted word / account / block / country). */
	listReason: string | null;
	mutedWord: string | null;
}

export interface DecideInput {
	post: Post;
	account?: Account;
	parentText?: string;
	context?: ThreadContext;
	clusterSize?: number;
	settings: Settings;
	/** The post the user opened on a status page — never hidden. */
	isFocal?: boolean;
	/** A reply inside the open thread: score-based hides fold into one bar. */
	inThread?: boolean;
	/** The user tapped "Show all" for this thread. */
	threadRevealed?: boolean;
	feedback?: "fine" | "spam";
	now?: number;
}

const LABEL_TEXT = { farm: "Likely farm", slop: "Low-quality reply" } as const;

export function decide(input: DecideInput): Decision {
	const { settings: s, post, account } = input;
	const handle = post.authorHandle;
	const place = resolvePlace(account?.about?.basedIn);
	const masked = account?.about?.locationAccurate === false;
	const lists = s.lists;
	const trusted = lists.trustedAccounts.includes(handle);

	const verdict = scorePost({
		account,
		post,
		parentText: input.parentText,
		context: input.context,
		clusterSize: input.clusterSize,
		homeBlocs: s.homeBlocs,
		watchCountries: lists.watchCountries,
		trusted,
		sensitivity: s.sensitivity,
		feedback: input.feedback,
		now: input.now,
	});

	const base = { verdict, place, masked, listReason: null, mutedWord: null };
	const at = `@${handle}`;
	const show = (): Decision => ({ ...base, visibility: "show", summary: "" });
	const cap = (v: Visibility): Visibility => (input.isFocal && v !== "show" ? "show" : v);

	if (!s.enabled) return show();

	if (lists.blockedAccounts.includes(handle))
		return { ...base, visibility: cap("hide"), summary: `Blocked ${at}`, listReason: "blocked" };
	if (lists.mutedAccounts.includes(handle))
		return { ...base, visibility: cap("collapse"), summary: `Muted ${at}`, listReason: "muted" };
	const word = matchesMutedWord(post.text, lists.mutedWords);
	if (word)
		return {
			...base,
			visibility: cap("collapse"),
			summary: `Muted word “${word}” · ${at}`,
			listReason: "word",
			mutedWord: word,
		};

	if (trusted || account?.youFollow) return show();

	if (place && lists.hiddenCountries.some((c) => c.toLowerCase() === place.name.toLowerCase()))
		return {
			...base,
			visibility: cap("hide"),
			summary: `${place.emoji} ${place.name} hidden`,
			listReason: "country",
		};

	if (verdict.label === "farm" || verdict.label === "slop") {
		const action = verdict.label === "farm" ? s.farmAction : s.slopAction;
		let vis: Visibility = action === "hide" ? "hide" : action === "collapse" ? "collapse" : "show";
		if (input.inThread && vis !== "show") vis = input.threadRevealed ? "show" : "fold";
		const flag = place ? `${place.emoji} ` : "";
		// Reasons may lead with the same flag; don't repeat it in the bar.
		const reason = (verdict.signals[0]?.reason ?? "").replace(place ? `${place.emoji} ` : /^$/, "");
		return {
			...base,
			visibility: cap(vis),
			summary: `${LABEL_TEXT[verdict.label]} · ${flag}${at} · ${reason}`,
		};
	}
	return show();
}
