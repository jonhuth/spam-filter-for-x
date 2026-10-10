// Your 👍/👎 on accounts. Applied immediately as a scoring signal, and kept
// (with the signals that fired) so `bun run calibrate` can tune weights.

import type { Signal } from "../core/score";

export const FEEDBACK_KEY = "feedback_v4";
const MAX = 3_000;

export type Vote = "fine" | "spam";

export interface FeedbackEntry {
	vote: Vote;
	at: number;
	/** Score and signal ids at the time of the vote (excluding your own vote). */
	score: number;
	signals: { id: string; weight: number }[];
	label: string;
	basedIn?: string | null;
	/** First 140 chars of the post you voted on, for reviewing misfires. */
	text?: string;
}

export type FeedbackMap = Record<string, FeedbackEntry>;

export async function loadFeedback(): Promise<FeedbackMap> {
	try {
		return ((await chrome.storage.local.get(FEEDBACK_KEY))[FEEDBACK_KEY] as FeedbackMap) ?? {};
	} catch {
		return {};
	}
}

export async function setVote(handle: string, entry: FeedbackEntry | null): Promise<FeedbackMap> {
	const all = await loadFeedback();
	if (entry) all[handle] = entry;
	else delete all[handle];
	let out = all;
	const keys = Object.keys(all);
	if (keys.length > MAX) {
		out = Object.fromEntries(
			Object.entries(all)
				.sort((a, b) => b[1].at - a[1].at)
				.slice(0, MAX),
		);
	}
	try {
		await chrome.storage.local.set({ [FEEDBACK_KEY]: out });
	} catch {
		/* storage unavailable */
	}
	return out;
}

export function entryFor(
	vote: Vote,
	verdict: { score: number; label: string; signals: Signal[] },
	basedIn: string | null | undefined,
	text: string,
): FeedbackEntry {
	const signals = verdict.signals
		.filter((s) => !s.id.startsWith("your-"))
		.map((s) => ({ id: s.id, weight: s.weight }));
	return {
		vote,
		at: Date.now(),
		score: Math.round(signals.reduce((a, s) => a + s.weight, 0) * 10) / 10,
		signals,
		label: verdict.label,
		basedIn,
		text: text.slice(0, 140),
	};
}

export interface SignalStats {
	id: string;
	spam: number;
	fine: number;
	/** Share of votes where this signal fired that were "spam". */
	precision: number;
}

/** Per-signal hit counts across your votes; low precision → weight too high. */
export function calibrate(map: FeedbackMap): {
	votes: number;
	falsePositives: number;
	missed: number;
	signals: SignalStats[];
} {
	const stats = new Map<string, { spam: number; fine: number }>();
	let falsePositives = 0;
	let missed = 0;
	const entries = Object.values(map);
	for (const e of entries) {
		const flagged = e.label === "slop" || e.label === "farm";
		if (e.vote === "fine" && flagged) falsePositives++;
		if (e.vote === "spam" && !flagged) missed++;
		for (const s of e.signals) {
			const st = stats.get(s.id) ?? { spam: 0, fine: 0 };
			st[e.vote]++;
			stats.set(s.id, st);
		}
	}
	return {
		votes: entries.length,
		falsePositives,
		missed,
		signals: [...stats.entries()]
			.map(([id, st]) => ({ id, ...st, precision: st.spam / Math.max(1, st.spam + st.fine) }))
			.sort((a, b) => a.precision - b.precision || b.fine - a.fine),
	};
}
