import { describe, expect, test } from "bun:test";
import { AboutQueue } from "../src/content/aboutQueue";
import { decide } from "../src/core/decide";
import type { Account, Post } from "../src/core/types";
import { calibrate, entryFor, type FeedbackMap } from "../src/shared/feedback";
import { DEFAULT_SETTINGS } from "../src/shared/settings";

const NOW = Date.parse("2026-10-09T00:00:00Z");
const DAY = 86_400_000;
const clock = () => {
	let t = 0;
	return { now: () => t, sleep: async (ms: number) => void (t += ms) };
};

describe("AboutQueue priority and pacing", () => {
	test("riskiest first, ties to most recent", async () => {
		const c = clock();
		const order: string[] = [];
		const q = new AboutQueue(
			async (h) => {
				order.push(h);
				return { about: null, status: 200 };
			},
			() => {},
			{ minGapMs: 100, ...c },
		);
		q.request("first", 0); // starts immediately
		q.request("established", -10);
		q.request("newbie", 4);
		q.request("meh", 1);
		q.request("newbie2", 4);
		await Bun.sleep(5);
		expect(order).toEqual(["first", "newbie2", "newbie", "meh", "established"]);
	});

	test("spreads X's remaining budget over the window", async () => {
		const c = clock();
		const times: number[] = [];
		const q = new AboutQueue(
			async () => {
				times.push(c.now());
				// 13 left (10 usable after reserve) in a 60s window → 6s apart
				return { about: null, status: 200, rate: { remaining: 13, resetAt: c.now() + 60_000 } };
			},
			() => {},
			{ minGapMs: 2000, floorGapMs: 500, ...c },
		);
		for (const h of ["a", "b", "c"]) q.request(h);
		await Bun.sleep(5);
		expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(5_900);
		expect(q.gapMs()).toBeGreaterThan(2000);
	});

	test("plenty of budget goes faster than the default, but not below the floor", () => {
		const c = clock();
		const q = new AboutQueue(
			async () => ({ about: null, status: 200 }),
			() => {},
			{
				minGapMs: 2000,
				floorGapMs: 600,
				...c,
			},
		);
		// @ts-expect-error test hook: inject observed rate
		q.rate = { remaining: 500, resetAt: 900_000 };
		expect(q.gapMs()).toBeGreaterThanOrEqual(600);
		expect(q.gapMs()).toBeLessThan(2000);
	});

	test("429 waits for X's reset time when it is sooner than the backoff", async () => {
		const c = clock();
		let n = 0;
		const done: string[] = [];
		const q = new AboutQueue(
			async () =>
				n++ === 0
					? { about: null, status: 429, rate: { remaining: 0, resetAt: 45_000 } }
					: { about: null, status: 200 },
			(h) => done.push(h),
			{ baseBackoffMs: 300_000, ...c },
		);
		q.request("a");
		await Bun.sleep(5);
		expect(done).toEqual(["a"]);
		expect(c.now()).toBeGreaterThanOrEqual(45_000);
		expect(c.now()).toBeLessThan(300_000);
	});
});

const acct = (o: Partial<Account> = {}): Account => ({
	id: "1",
	handle: "x",
	followers: 40,
	following: 4900,
	createdAt: NOW - 20 * DAY,
	defaultAvatar: true,
	seenAt: NOW,
	...o,
});
const reply = (text: string): Post => ({
	id: "2",
	authorId: "1",
	authorHandle: "x",
	text,
	conversationId: "1",
	inReplyToId: "1",
});

describe("thread folding", () => {
	const s = DEFAULT_SETTINGS();
	test("score-based hides fold inside an open thread; Show all reveals", () => {
		const base = { account: acct(), post: reply("Great point!"), settings: s, now: NOW };
		expect(decide(base).visibility).toBe("hide");
		expect(decide({ ...base, inThread: true }).visibility).toBe("fold");
		expect(decide({ ...base, inThread: true, threadRevealed: true }).visibility).toBe("show");
	});

	test("list-based hides (blocked) never fold or reveal", () => {
		const blocked = DEFAULT_SETTINGS();
		blocked.lists.blockedAccounts = ["x"];
		const d = decide({
			account: acct(),
			post: reply("hi"),
			settings: blocked,
			inThread: true,
			threadRevealed: true,
			now: NOW,
		});
		expect(d.visibility).toBe("hide");
	});
});

describe("feedback", () => {
	const s = DEFAULT_SETTINGS();
	test("👍 rescues a flagged account, 👎 flags an unflagged one", () => {
		const farm = { account: acct(), post: reply("Great point!"), settings: s, now: NOW };
		expect(decide({ ...farm, feedback: "fine" }).visibility).toBe("show");
		const human = {
			account: acct({
				followers: 900,
				following: 300,
				createdAt: NOW - 2000 * DAY,
				defaultAvatar: false,
			}),
			post: reply("I think the CBO number is off"),
			settings: s,
			now: NOW,
		};
		expect(decide(human).visibility).toBe("show");
		expect(decide({ ...human, feedback: "spam" }).verdict.label).not.toBe("ok");
	});

	test("calibration flags signals that fire on people you marked fine", () => {
		const v = (vote: "fine" | "spam", label: string, ids: string[]) =>
			entryFor(
				vote,
				{ score: 0, label, signals: ids.map((id) => ({ id, weight: 1, reason: "" })) },
				null,
				"t",
			);
		const map: FeedbackMap = {
			a: v("fine", "slop", ["generic-praise", "age-120"]),
			b: v("fine", "slop", ["generic-praise"]),
			c: v("spam", "slop", ["generic-praise", "off-region-politics"]),
			d: v("spam", "ok", ["off-region-politics"]),
		};
		const r = calibrate(map);
		expect(r.votes).toBe(4);
		expect(r.falsePositives).toBe(2);
		expect(r.missed).toBe(1);
		const praise = r.signals.find((s) => s.id === "generic-praise")!;
		expect(praise).toMatchObject({ spam: 1, fine: 2 });
		expect(r.signals[0]!.id).toBe("age-120"); // lowest precision first
	});
});
