// Two-way sync of muted words, muted accounts and blocked accounts with X.
//
// Three-way merge between your local lists, X's current lists, and the
// snapshot of X from the last successful sync:
//   on X, not in snapshot        → added on X      → add locally
//   in snapshot, gone from X     → removed on X    → remove locally
//   local only, not in snapshot  → added here      → push to X
//   in snapshot + X, gone locally → removed here    → remove on X
// With no snapshot (first sync) nothing is deleted on either side: union.
// Pure: no I/O. Values must already be normalized (lowercase handles/words).

export interface XLists {
	words: string[];
	muted: string[];
	blocked: string[];
}

export interface SyncPlan {
	local: {
		addWords: string[];
		removeWords: string[];
		addMuted: string[];
		removeMuted: string[];
		addBlocked: string[];
		removeBlocked: string[];
	};
	x: {
		muteWord: string[];
		unmuteWord: string[];
		mute: string[];
		unmute: string[];
		block: string[];
		unblock: string[];
	};
}

const set = (a: string[]) => new Set(a);
const minus = (a: string[], b: Set<string>) => a.filter((v) => !b.has(v));

function merge(local: string[], x: string[], snap: string[] | null) {
	const L = set(local);
	const X = set(x);
	if (!snap) {
		return { addLocal: minus(x, L), removeLocal: [], addX: minus(local, X), removeX: [] };
	}
	const S = set(snap);
	return {
		addLocal: x.filter((v) => !S.has(v) && !L.has(v)),
		removeLocal: local.filter((v) => S.has(v) && !X.has(v)),
		addX: local.filter((v) => !S.has(v) && !X.has(v)),
		removeX: x.filter((v) => S.has(v) && !L.has(v)),
	};
}

export function planSync(local: XLists, x: XLists, snapshot: XLists | null): SyncPlan {
	const w = merge(local.words, x.words, snapshot?.words ?? null);
	const b = merge(local.blocked, x.blocked, snapshot?.blocked ?? null);
	const m = merge(local.muted, x.muted, snapshot?.muted ?? null);

	// Locally an account is muted OR blocked, never both; on X it can be both.
	// Blocked wins: don't pull a mute for a locally blocked account (it would
	// unblock it here), and don't unmute on X just because block superseded it.
	const localBlocked = set([...local.blocked, ...b.addLocal]);
	const addMuted = m.addLocal.filter((h) => !localBlocked.has(h));
	const unmute = m.removeX.filter((h) => !localBlocked.has(h));

	return {
		local: {
			addWords: w.addLocal,
			removeWords: w.removeLocal,
			addMuted,
			removeMuted: m.removeLocal,
			addBlocked: b.addLocal,
			removeBlocked: b.removeLocal,
		},
		x: {
			muteWord: w.addX,
			unmuteWord: w.removeX,
			mute: m.addX,
			unmute,
			block: b.addX,
			unblock: b.removeX,
		},
	};
}

/**
 * X answered, but with nothing where we previously knew of a lot: treat as a
 * broken read (API change, partial outage), never as "you unmuted everything".
 */
export function looksLikeBadRead(x: XLists, snapshot: XLists | null): boolean {
	if (!snapshot) return false;
	const before = snapshot.words.length + snapshot.muted.length + snapshot.blocked.length;
	const now = x.words.length + x.muted.length + x.blocked.length;
	return before >= 5 && now === 0;
}

export function planSize(p: SyncPlan): { local: number; x: number } {
	const n = (o: Record<string, string[]>) => Object.values(o).reduce((a, v) => a + v.length, 0);
	return { local: n(p.local), x: n(p.x) };
}
