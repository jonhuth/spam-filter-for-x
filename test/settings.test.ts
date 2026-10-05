import { describe, expect, test } from "bun:test";
import { AboutQueue } from "../src/content/aboutQueue";
import {
	DEFAULT_SETTINGS,
	migrateV3,
	normalizeEntry,
	sanitize,
	toggleEntry,
} from "../src/shared/settings";

describe("settings", () => {
	test("migrates v3 keys", () => {
		const s = migrateV3({
			extension_enabled: false,
			bot_detection_enabled: false,
			hidden_countries: { countries: ["india", "USA", ""], updatedAt: 1 },
			onboarding_dismissed: true,
		});
		expect(s.showFlags).toBe(false);
		expect(s.farmAction).toBe("label");
		expect(s.lists.hiddenCountries).toEqual(["India", "United States"]);
		expect(s.onboardingDismissed).toBe(true);
	});

	test("sanitize repairs bad input", () => {
		const s = sanitize({
			farmAction: "nuke",
			lists: { mutedAccounts: ["@Bob", "bad handle!", "bob"] },
		});
		expect(s.farmAction).toBe("hide");
		expect(s.lists.mutedAccounts).toEqual(["bob"]);
		expect(s.lists.mutedWords).toEqual([]);
	});

	test("an account lives in only one of trusted/muted/blocked", () => {
		const s = DEFAULT_SETTINGS();
		toggleEntry(s, "mutedAccounts", "@bob", true);
		toggleEntry(s, "blockedAccounts", "bob", true);
		expect(s.lists.mutedAccounts).toEqual([]);
		expect(s.lists.blockedAccounts).toEqual(["bob"]);
		toggleEntry(s, "trustedAccounts", "BOB", true);
		expect(s.lists.blockedAccounts).toEqual([]);
		expect(s.lists.trustedAccounts).toEqual(["bob"]);
	});

	test("normalizes entries per list", () => {
		expect(normalizeEntry("hiddenCountries", "uk")).toBe("United Kingdom");
		expect(normalizeEntry("mutedWords", "  GM  ")).toBe("gm");
		expect(normalizeEntry("blockedAccounts", "@this_handle_is_far_too_long")).toBe("");
	});
});

describe("AboutQueue", () => {
	const fakeClock = () => {
		let t = 0;
		return { now: () => t, sleep: async (ms: number) => void (t += ms) };
	};

	test("newest request first, spaced by min gap", async () => {
		const clock = fakeClock();
		const calls: [string, number][] = [];
		const done: string[] = [];
		const q = new AboutQueue(
			async (h) => {
				calls.push([h, clock.now()]);
				return { about: { basedIn: "India", fetchedAt: 0 }, status: 200 };
			},
			(h) => done.push(h),
			{ minGapMs: 1000, ...clock },
		);
		q.request("a");
		q.request("b");
		q.request("c");
		await Bun.sleep(5);
		expect(done).toEqual(["a", "c", "b"]);
		expect(calls.map((c) => c[1])).toEqual([0, 1000, 2000]);
	});

	test("backs off on 429 and retries; transient errors are not cached", async () => {
		const clock = fakeClock();
		const statuses = [429, 200, 500];
		const done: string[] = [];
		const q = new AboutQueue(
			async () => ({ about: null, status: statuses.shift() ?? 200 }),
			(h) => done.push(h),
			{ minGapMs: 10, baseBackoffMs: 60_000, ...clock },
		);
		q.request("a");
		await Bun.sleep(5);
		expect(done).toEqual(["a"]);
		expect(clock.now()).toBeGreaterThanOrEqual(60_000);
		q.request("b");
		await Bun.sleep(5);
		expect(done).toEqual(["a"]); // 500 → not cached
	});
});

describe("v3 migration keeps user lists", () => {
	test("mute/block lists, whitelist, human overrides, sensitivity", () => {
		const s = migrateV3({
			bot_sensitivity: 5,
			mute_block_lists: {
				muteWords: [
					{ id: "1", term: "GM" },
					{ id: "2", term: "airdrop" },
				],
				muteAccounts: [{ id: "3", username: "@Spammer" }],
				blockAccounts: [{ id: "4", username: "scammer" }],
			},
			bot_whitelist: ["Friend", "spammer"],
			bot_overrides: { pal: { forceHuman: true }, bot1: { forceBot: true } },
		});
		expect(s.lists.mutedWords).toEqual(["airdrop", "gm"]);
		expect(s.lists.mutedAccounts).toEqual(["spammer"]);
		expect(s.lists.blockedAccounts).toEqual(["scammer"]);
		expect(s.lists.trustedAccounts).toEqual(["friend", "pal"]);
		expect(s.sensitivity).toBe("strict");
	});
});

describe("muted words in spaceless scripts", () => {
	test("CJK matches as substring", async () => {
		const { matchesMutedWord } = await import("../src/shared/settings");
		expect(matchesMutedWord("这是垃圾广告", ["垃圾"])).toBe("垃圾");
		expect(matchesMutedWord("AT&T outage", ["at&t"])).toBe("at&t");
	});
});

describe("AboutQueue failures", () => {
	test("auth/404 failures pause the queue and are reported, not cached", async () => {
		let t = 0;
		const failed: [string, number][] = [];
		const done: string[] = [];
		const q = new AboutQueue(
			async () => ({ about: null, status: 404 }),
			(h) => done.push(h),
			{ minGapMs: 10, baseBackoffMs: 1000, now: () => t, sleep: async (ms) => void (t += ms) },
			(h, status) => failed.push([h, status]),
		);
		q.request("a");
		q.request("b");
		await Bun.sleep(5);
		expect(done).toEqual([]);
		expect(failed.map((f) => f[0]).sort()).toEqual(["a", "b"]);
		expect(q.rateLimitedUntil).toBeGreaterThan(0);
	});
});
