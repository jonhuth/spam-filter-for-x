import { beforeEach, describe, expect, test } from "bun:test";
import type { XAction, XListsRead } from "../src/shared/bridge";

// Minimal in-memory chrome.storage.local
const store: Record<string, unknown> = {};
(globalThis as unknown as { chrome: unknown }).chrome = {
	runtime: { id: "test" },
	storage: {
		local: {
			get: async (keys: string | string[] | null) => {
				if (keys === null) return { ...store };
				const ks = Array.isArray(keys) ? keys : [keys];
				return Object.fromEntries(
					ks.filter((k) => k in store).map((k) => [k, structuredClone(store[k])]),
				);
			},
			set: async (o: Record<string, unknown>) => Object.assign(store, structuredClone(o)),
			remove: async (k: string | string[]) => {
				for (const key of Array.isArray(k) ? k : [k]) delete store[key];
			},
		},
		onChanged: { addListener() {}, removeListener() {} },
	},
};

const { runSync } = await import("../src/content/xsync");
const { loadSettings, updateSettings, toggleEntry } = await import("../src/shared/settings");

/** Fake X account. */
function fakeX(init: { words?: string[]; muted?: string[]; blocked?: string[] } = {}) {
	let id = 100;
	const x = {
		words: new Map((init.words ?? []).map((w) => [w, String(id++)])),
		muted: new Set(init.muted ?? []),
		blocked: new Set(init.blocked ?? []),
		refuse: new Set<string>(),
		readFails: false,
		calls: [] as string[],
	};
	const readX = async (): Promise<XListsRead | null> =>
		x.readFails
			? null
			: {
					words: [...x.words.keys()],
					muted: [...x.muted],
					blocked: [...x.blocked],
					wordIds: Object.fromEntries(x.words),
				};
	const pushX = async (action: XAction, target: string) => {
		x.calls.push(`${action}:${target}`);
		if (x.refuse.has(target)) return false;
		if (action === "mute") x.muted.add(target);
		if (action === "unmute") x.muted.delete(target);
		if (action === "block") x.blocked.add(target);
		if (action === "unblock") x.blocked.delete(target);
		if (action === "muteWord") x.words.set(target, String(id++));
		if (action === "unmuteWord") for (const [w, i] of x.words) if (i === target) x.words.delete(w);
		return true;
	};
	return { x, deps: { readX, pushX, sleep: async () => {} } };
}

const lists = async () => (await loadSettings()).lists;

beforeEach(() => {
	for (const k of Object.keys(store)) delete store[k];
});

describe("runSync", () => {
	test("first sync: union both ways", async () => {
		await updateSettings((s) => {
			toggleEntry(s, "mutedWords", "gm", true);
			toggleEntry(s, "blockedAccounts", "localbot", true);
		});
		const { x, deps } = fakeX({ words: ["airdrop"], muted: ["xmuted"] });
		const st = await runSync(deps);
		expect(st?.ok).toBe(true);
		expect((await lists()).mutedWords).toEqual(["airdrop", "gm"]);
		expect((await lists()).mutedAccounts).toEqual(["xmuted"]);
		expect([...x.words.keys()].sort()).toEqual(["airdrop", "gm"]);
		expect([...x.blocked]).toEqual(["localbot"]);
	});

	test("removals flow both ways after the first sync", async () => {
		const { x, deps } = fakeX({ words: ["gm", "wagmi"], muted: ["a"], blocked: ["b"] });
		await runSync(deps);
		// removed on X
		x.words.delete("wagmi");
		// removed here
		await updateSettings((s) => toggleEntry(s, "blockedAccounts", "b", false));
		await updateSettings((s) => toggleEntry(s, "mutedWords", "gm", false));
		const st = await runSync(deps);
		expect(st?.ok).toBe(true);
		expect((await lists()).mutedWords).toEqual([]);
		expect([...x.blocked]).toEqual([]);
		expect([...x.words.keys()]).toEqual([]); // unmuted "gm" on X via its id
		expect((await lists()).mutedAccounts).toEqual(["a"]);
	});

	test("a failed read changes nothing", async () => {
		const { x, deps } = fakeX({ words: ["gm"] });
		await runSync(deps);
		x.readFails = true;
		await updateSettings((s) => toggleEntry(s, "mutedWords", "new", true));
		const st = await runSync(deps);
		expect(st?.ok).toBe(false);
		expect((await lists()).mutedWords).toEqual(["gm", "new"]);
		expect(x.calls.filter((c) => c.startsWith("muteWord:new"))).toEqual([]);
	});

	test("X suddenly empty after a populated sync → skipped, nothing deleted", async () => {
		const { x, deps } = fakeX({ words: ["a", "b", "c"], muted: ["d", "e"] });
		await runSync(deps);
		x.words.clear();
		x.muted.clear();
		const st = await runSync(deps);
		expect(st?.ok).toBe(false);
		expect((await lists()).mutedWords).toEqual(["a", "b", "c"]);
	});

	test("refused pushes stay pending and retry next sync", async () => {
		const { x, deps } = fakeX();
		await updateSettings((s) => toggleEntry(s, "mutedAccounts", "stubborn", true));
		x.refuse.add("stubborn");
		const st = await runSync(deps);
		expect(st).toMatchObject({ ok: false, pending: 1 });
		expect((await lists()).mutedAccounts).toEqual(["stubborn"]); // kept locally
		x.refuse.clear();
		const st2 = await runSync(deps);
		expect(st2?.ok).toBe(true);
		expect([...x.muted]).toEqual(["stubborn"]);
	});

	test("sync off → no reads, no pushes", async () => {
		await updateSettings((s) => {
			s.syncWithX = false;
		});
		const { x, deps } = fakeX({ words: ["gm"] });
		expect(await runSync(deps)).toBeNull();
		expect(x.calls).toEqual([]);
		expect((await lists()).mutedWords).toEqual([]);
	});
});
