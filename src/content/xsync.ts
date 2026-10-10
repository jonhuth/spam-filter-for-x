// Runs two-way sync with X (see core/sync.ts for the merge rules).
// One tab at a time (storage lock), pushes capped per run, and a failed or
// suspicious read from X never deletes anything.

import { looksLikeBadRead, planSize, planSync, type XLists } from "../core/sync";
import type { XAction, XListsRead } from "../shared/bridge";
import {
	loadSettings,
	normalizeEntry,
	type Settings,
	toggleEntry,
	updateSettings,
} from "../shared/settings";

export const XSYNC_KEY = "xsync_v1";
const LOCK_KEY = "xsync_lock";
const MAX_PUSH = 40;
const PUSH_GAP_MS = 350;

export interface SyncStatus {
	ok: boolean;
	at: number;
	pulled: number;
	pushed: number;
	/** Changes still waiting (cap reached or X refused). */
	pending: number;
	error?: string;
}

interface SyncState {
	snapshot: XLists | null;
	wordIds: Record<string, string>;
	status: SyncStatus | null;
}

export interface SyncDeps {
	readX: () => Promise<XListsRead | null>;
	pushX: (action: XAction, target: string) => Promise<boolean>;
	sleep?: (ms: number) => Promise<void>;
}

const tabId = Math.random().toString(36).slice(2);

async function loadState(): Promise<SyncState> {
	try {
		const s = (await chrome.storage.local.get(XSYNC_KEY))[XSYNC_KEY] as SyncState | undefined;
		return { snapshot: s?.snapshot ?? null, wordIds: s?.wordIds ?? {}, status: s?.status ?? null };
	} catch {
		return { snapshot: null, wordIds: {}, status: null };
	}
}

async function saveState(s: SyncState): Promise<void> {
	await chrome.storage.local.set({ [XSYNC_KEY]: s });
}

async function takeLock(): Promise<boolean> {
	const now = Date.now();
	const cur = (await chrome.storage.local.get(LOCK_KEY))[LOCK_KEY] as
		| { owner: string; until: number }
		| undefined;
	if (cur && cur.owner !== tabId && cur.until > now) return false;
	await chrome.storage.local.set({ [LOCK_KEY]: { owner: tabId, until: now + 90_000 } });
	const check = (await chrome.storage.local.get(LOCK_KEY))[LOCK_KEY] as
		| { owner: string }
		| undefined;
	return check?.owner === tabId;
}

async function releaseLock(): Promise<void> {
	const cur = (await chrome.storage.local.get(LOCK_KEY))[LOCK_KEY] as { owner: string } | undefined;
	if (cur?.owner === tabId) await chrome.storage.local.remove(LOCK_KEY);
}

const norm = (list: "mutedWords" | "mutedAccounts" | "blockedAccounts", vs: string[]) => [
	...new Set(vs.map((v) => normalizeEntry(list, v)).filter(Boolean)),
];

export function localLists(s: Settings): XLists {
	return {
		words: s.lists.mutedWords,
		muted: s.lists.mutedAccounts,
		blocked: s.lists.blockedAccounts,
	};
}

/** Signature of the synced lists, to skip syncing on unrelated settings changes. */
export function listsSig(s: Settings): string {
	return JSON.stringify(localLists(s));
}

export async function runSync(deps: SyncDeps): Promise<SyncStatus | null> {
	const settings = await loadSettings();
	if (!settings.syncWithX) return null;
	if (!(await takeLock())) return null;
	const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
	const state = await loadState();
	try {
		const read = await deps.readX();
		if (!read)
			return await finish(state, {
				ok: false,
				at: Date.now(),
				pulled: 0,
				pushed: 0,
				pending: 0,
				error: "Couldn’t read your lists from X",
			});
		const x: XLists = {
			words: norm("mutedWords", read.words),
			muted: norm("mutedAccounts", read.muted),
			blocked: norm("blockedAccounts", read.blocked),
		};
		if (looksLikeBadRead(x, state.snapshot))
			return await finish(state, {
				ok: false,
				at: Date.now(),
				pulled: 0,
				pushed: 0,
				pending: 0,
				error: "X returned empty lists — skipped to keep yours safe",
			});
		state.wordIds = { ...state.wordIds, ...read.wordIds };

		const plan = planSync(localLists(settings), x, state.snapshot);

		// 1. Apply X's changes locally.
		const l = plan.local;
		if (planSize(plan).local > 0) {
			await updateSettings((s) => {
				for (const v of l.addWords) toggleEntry(s, "mutedWords", v, true);
				for (const v of l.removeWords) toggleEntry(s, "mutedWords", v, false);
				for (const v of l.addBlocked) toggleEntry(s, "blockedAccounts", v, true);
				for (const v of l.removeBlocked) toggleEntry(s, "blockedAccounts", v, false);
				for (const v of l.addMuted) toggleEntry(s, "mutedAccounts", v, true);
				for (const v of l.removeMuted) toggleEntry(s, "mutedAccounts", v, false);
			});
		}

		// 2. Push local changes to X; track what X now has.
		const now = { words: new Set(x.words), muted: new Set(x.muted), blocked: new Set(x.blocked) };
		const ops: [XAction, string, () => void][] = [
			...plan.x.block.map((h): [XAction, string, () => void] => [
				"block",
				h,
				() => now.blocked.add(h),
			]),
			...plan.x.unblock.map((h): [XAction, string, () => void] => [
				"unblock",
				h,
				() => now.blocked.delete(h),
			]),
			...plan.x.mute.map((h): [XAction, string, () => void] => ["mute", h, () => now.muted.add(h)]),
			...plan.x.unmute.map((h): [XAction, string, () => void] => [
				"unmute",
				h,
				() => now.muted.delete(h),
			]),
			...plan.x.muteWord.map((w): [XAction, string, () => void] => [
				"muteWord",
				w,
				() => now.words.add(w),
			]),
			...plan.x.unmuteWord.map((w): [XAction, string, () => void] => [
				"unmuteWord",
				w,
				() => now.words.delete(w),
			]),
		];
		let pushed = 0;
		let failed = 0;
		for (const [action, target, onOk] of ops.slice(0, MAX_PUSH)) {
			const arg = action === "unmuteWord" ? state.wordIds[target] : target;
			if (!arg) {
				failed++;
				continue;
			}
			if (pushed + failed > 0) await sleep(PUSH_GAP_MS);
			if (await deps.pushX(action, arg)) {
				onOk();
				pushed++;
				if (action === "unmuteWord") delete state.wordIds[target];
			} else failed++;
		}

		// 3. Snapshot = what X has now (to our best knowledge).
		state.snapshot = { words: [...now.words], muted: [...now.muted], blocked: [...now.blocked] };
		const pending = Math.max(0, ops.length - MAX_PUSH) + failed;
		return await finish(state, {
			ok: failed === 0,
			at: Date.now(),
			pulled: planSize(plan).local,
			pushed,
			pending,
			error: failed
				? `${failed} change${failed === 1 ? "" : "s"} X didn’t accept — will retry`
				: undefined,
		});
	} finally {
		await releaseLock();
	}
}

async function finish(state: SyncState, status: SyncStatus): Promise<SyncStatus> {
	state.status = status;
	await saveState(state);
	return status;
}

export async function loadSyncStatus(): Promise<SyncStatus | null> {
	return (await loadState()).status;
}

export function describeStatus(s: SyncStatus | null): string {
	if (!s) return "Not synced with X yet";
	const mins = Math.round((Date.now() - s.at) / 60_000);
	const ago = mins < 1 ? "just now" : mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`;
	if (!s.ok) return `${s.error ?? "Sync problem"} · ${ago}`;
	const moved = s.pulled + s.pushed;
	return `Synced with X ${ago}${moved ? ` · ${s.pulled} from X, ${s.pushed} to X` : ""}`;
}
