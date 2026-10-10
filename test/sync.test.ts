import { describe, expect, test } from "bun:test";
import { looksLikeBadRead, planSync, type XLists } from "../src/core/sync";

const L = (words: string[] = [], muted: string[] = [], blocked: string[] = []): XLists => ({
	words,
	muted,
	blocked,
});

describe("planSync", () => {
	test("first sync is a union — nothing deleted on either side", () => {
		const p = planSync(L(["gm"], ["a"], ["b"]), L(["airdrop"], ["c"], ["d"]), null);
		expect(p.local).toMatchObject({ addWords: ["airdrop"], addMuted: ["c"], addBlocked: ["d"] });
		expect(p.x).toMatchObject({ muteWord: ["gm"], mute: ["a"], block: ["b"] });
		expect([...p.local.removeWords, ...p.local.removeMuted, ...p.x.unmute, ...p.x.unblock]).toEqual(
			[],
		);
	});

	test("added on X → added here; removed on X → removed here", () => {
		const snap = L(["gm", "old"], ["a"], []);
		const p = planSync(L(["gm", "old"], ["a"], []), L(["gm", "new"], [], ["z"]), snap);
		expect(p.local.addWords).toEqual(["new"]);
		expect(p.local.removeWords).toEqual(["old"]);
		expect(p.local.removeMuted).toEqual(["a"]);
		expect(p.local.addBlocked).toEqual(["z"]);
		expect(p.x).toMatchObject({ muteWord: [], unmuteWord: [], mute: [], unmute: [] });
	});

	test("added here → pushed; removed here → removed on X", () => {
		const snap = L(["gm"], ["a"], ["b"]);
		const p = planSync(L(["airdrop"], ["a", "c"], []), L(["gm"], ["a"], ["b"]), snap);
		expect(p.x).toMatchObject({
			muteWord: ["airdrop"],
			unmuteWord: ["gm"],
			mute: ["c"],
			unblock: ["b"],
		});
		expect(p.local).toMatchObject({ addWords: [], removeWords: [], removeBlocked: [] });
	});

	test("in sync → no-op", () => {
		const s = L(["gm"], ["a"], ["b"]);
		const p = planSync(s, s, s);
		expect(Object.values(p.local).flat()).toEqual([]);
		expect(Object.values(p.x).flat()).toEqual([]);
	});

	test("muted+blocked on X: blocked wins here, no unmute churn on X", () => {
		const p = planSync(L([], [], []), L([], ["a"], ["a"]), null);
		expect(p.local.addBlocked).toEqual(["a"]);
		expect(p.local.addMuted).toEqual([]);
		// next sync: X still has both, local only blocked
		const snap = L([], ["a"], ["a"]);
		const p2 = planSync(L([], [], ["a"]), L([], ["a"], ["a"]), snap);
		expect(p2.x.unmute).toEqual([]);
		expect(p2.local.addMuted).toEqual([]);
	});

	test("an empty read from X after a populated sync is flagged as bad", () => {
		expect(looksLikeBadRead(L(), L(["a", "b", "c"], ["d", "e"]))).toBe(true);
		expect(looksLikeBadRead(L(), L(["a"]))).toBe(false);
		expect(looksLikeBadRead(L(), null)).toBe(false);
	});
});
