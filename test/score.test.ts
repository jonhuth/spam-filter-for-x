import { describe, expect, test } from "bun:test";
import { threadContext } from "../src/core/context";
import { flagForCode, resolvePlace } from "../src/core/country";
import { decide } from "../src/core/decide";
import { scorePost } from "../src/core/score";
import { duplicateClusters, textFeatures } from "../src/core/text";
import type { Account, Post } from "../src/core/types";
import { DEFAULT_SETTINGS, type Settings, toggleEntry } from "../src/shared/settings";

const NOW = Date.parse("2026-10-04T00:00:00Z");
const DAY = 86_400_000;

const acct = (over: Partial<Account> = {}): Account => ({
	id: "1",
	handle: "someone",
	followers: 800,
	following: 400,
	createdAt: NOW - 3 * 365 * DAY,
	defaultAvatar: false,
	seenAt: NOW,
	...over,
});
const reply = (text: string, over: Partial<Post> = {}): Post => ({
	id: "10",
	authorId: "1",
	authorHandle: "someone",
	text,
	conversationId: "1",
	inReplyToId: "1",
	...over,
});
const settings = (fn?: (s: Settings) => void) => {
	const s = DEFAULT_SETTINGS();
	fn?.(s);
	return s;
};

describe("country", () => {
	test("resolves names, aliases, cities and regions", () => {
		expect(resolvePlace("India")).toMatchObject({ code: "IN", emoji: "🇮🇳", bloc: "south-asia" });
		expect(resolvePlace("USA")?.name).toBe("United States");
		expect(resolvePlace("Lagos, Nigeria")?.code).toBe("NG");
		expect(resolvePlace("Türkiye")?.code).toBe("TR");
		expect(resolvePlace("South Asia")).toMatchObject({
			kind: "region",
			emoji: "🌏",
			bloc: "south-asia",
		});
		expect(resolvePlace("Europe")?.emoji).toBe("🇪🇺");
		expect(resolvePlace("Austin, TX")).toMatchObject({ kind: "region", emoji: "🌐" });
		expect(resolvePlace("")).toBeNull();
		expect(flagForCode("gb")).toBe("🇬🇧");
	});
});

describe("text features", () => {
	test("generic praise, AI style, spam bait", () => {
		expect(textFeatures("Great insight! Thanks for sharing 🙌").genericPraise).toBeTruthy();
		expect(textFeatures("It's not just a tool, it's a movement.").aiStyle).toBeTruthy();
		expect(textFeatures("DM me for the signal group").spamCta).toBeTruthy();
		expect(textFeatures("🔥🔥🚀").emojiOnly).toBe(true);
		const human = textFeatures("lol no, the index was on the wrong column");
		expect([human.genericPraise, human.aiStyle, human.spamCta]).toEqual([null, null, null]);
	});

	test("duplicate clusters need 3+ distinct authors and real sentences", () => {
		const items = [
			{ id: "a", authorHandle: "x1", text: "This is exactly what the market needs right now" },
			{ id: "b", authorHandle: "x2", text: "This is exactly what the market needs right now!!" },
			{ id: "c", authorHandle: "x3", text: "this is exactly what the market needs right now 🚀" },
			{ id: "d", authorHandle: "x4", text: "I disagree, rates are the real story here" },
			{ id: "e", authorHandle: "y1", text: "lol" },
			{ id: "f", authorHandle: "y2", text: "lol" },
			{ id: "g", authorHandle: "y3", text: "lol" },
		];
		const out = duplicateClusters(items);
		expect(out.get("a")).toBe(3);
		expect(out.has("d")).toBe(false);
		expect(out.has("e")).toBe(false);
	});
});

describe("thread context", () => {
	test("US politics by topic, otherwise by author country", () => {
		expect(threadContext("The Senate vote on the filibuster tonight")).toMatchObject({
			bloc: "north-america",
			political: true,
		});
		expect(threadContext("Lovely sunset at the beach", "Nigeria")).toMatchObject({
			bloc: "sub-saharan-africa",
			political: false,
		});
		expect(threadContext("Lovely sunset")).toEqual({ political: false });
	});
});

describe("scoring", () => {
	const usPolitics = threadContext("Trump and Congress on the budget");

	test("ordinary human reply is ok", () => {
		const v = scorePost({
			account: acct(),
			post: reply("Source? The CBO number was different"),
			now: NOW,
		});
		expect(v.label).toBe("ok");
	});

	test("short human chat is not slop on its own", () => {
		expect(scorePost({ account: acct(), post: reply("true"), now: NOW }).label).toBe("ok");
	});

	test("off-region account with generic reply in US politics is slop, with reasons", () => {
		const v = scorePost({
			account: acct({
				createdAt: NOW - 200 * DAY,
				followers: 90,
				about: { basedIn: "Nigeria", fetchedAt: NOW },
			}),
			post: reply("Well said, so true!"),
			context: usPolitics,
			now: NOW,
		});
		expect(v.label).toBe("slop");
		expect(v.signals.map((s) => s.id)).toEqual(
			expect.arrayContaining(["off-region-politics", "generic-praise"]),
		);
		expect(v.signals.find((s) => s.id === "off-region-politics")!.reason).toContain("🇳🇬");
	});

	test("country alone never makes slop", () => {
		const v = scorePost({
			account: acct({ about: { basedIn: "Nigeria", fetchedAt: NOW } }),
			post: reply("The CBO scored this differently last year, see table 3"),
			context: usPolitics,
			now: NOW,
		});
		expect(v.label).toBe("ok");
	});

	test("home blocs are never off-region", () => {
		const v = scorePost({
			account: acct({ about: { basedIn: "Germany", fetchedAt: NOW } }),
			post: reply("so true"),
			context: usPolitics,
			homeBlocs: ["europe"],
			now: NOW,
		});
		expect(v.signals.some((s) => s.id.startsWith("off-region"))).toBe(false);
	});

	test("farm requires a strong signal", () => {
		const farm = scorePost({
			account: acct({
				followers: 40,
				following: 4900,
				createdAt: NOW - 20 * DAY,
				defaultAvatar: true,
				handle: "user83749201",
			}),
			post: reply("Great point!"),
			now: NOW,
		});
		expect(farm.label).toBe("farm");

		const weakOnly = scorePost({
			account: acct({ createdAt: NOW - 10 * DAY, defaultAvatar: true, handle: "user83749201" }),
			post: reply("Great point! Couldn't agree more"),
			now: NOW,
		});
		expect(weakOnly.label).toBe("slop");
	});

	test("app store / based-in mismatch and VPN flags add weight", () => {
		const v = scorePost({
			account: acct({
				about: {
					basedIn: "United States",
					source: "Nigeria Android App",
					locationAccurate: false,
					fetchedAt: NOW,
				},
			}),
			post: reply("hm"),
			now: NOW,
		});
		expect(v.signals.map((s) => s.id)).toEqual(
			expect.arrayContaining(["store-mismatch", "location-masked"]),
		);
	});

	test("you follow / trusted always wins", () => {
		const spammy = reply("DM me for 100x airdrop");
		expect(scorePost({ account: acct({ youFollow: true }), post: spammy, now: NOW }).label).toBe(
			"trusted",
		);
		expect(scorePost({ account: acct(), post: spammy, trusted: true, now: NOW }).label).toBe(
			"trusted",
		);
	});
});

describe("decide", () => {
	const base = { account: acct(), now: NOW };

	test("blocked hides, muted collapses, muted word collapses even for follows", () => {
		expect(
			decide({
				...base,
				post: reply("hi"),
				settings: settings((s) => toggleEntry(s, "blockedAccounts", "@someone")),
			}).visibility,
		).toBe("hide");
		expect(
			decide({
				...base,
				post: reply("hi"),
				settings: settings((s) => toggleEntry(s, "mutedAccounts", "someone")),
			}).visibility,
		).toBe("collapse");
		const d = decide({
			account: acct({ youFollow: true }),
			post: reply("big Crypto news today"),
			settings: settings((s) => toggleEntry(s, "mutedWords", "crypto")),
			now: NOW,
		});
		expect(d.visibility).toBe("collapse");
		expect(d.mutedWord).toBe("crypto");
	});

	test("muted words match whole words only", () => {
		const s = settings((x) => toggleEntry(x, "mutedWords", "eth"));
		expect(decide({ ...base, post: reply("something else"), settings: s }).visibility).toBe("show");
		expect(decide({ ...base, post: reply("buy ETH now"), settings: s }).visibility).toBe(
			"collapse",
		);
	});

	test("hidden country hides; trust beats country", () => {
		const s = settings((x) => toggleEntry(x, "hiddenCountries", "india"));
		const indian = acct({ about: { basedIn: "India", fetchedAt: NOW } });
		expect(
			decide({ account: indian, post: reply("hello"), settings: s, now: NOW }).visibility,
		).toBe("hide");
		toggleEntry(s, "trustedAccounts", "someone");
		expect(
			decide({ account: indian, post: reply("hello"), settings: s, now: NOW }).visibility,
		).toBe("show");
	});

	test("focal post is never hidden", () => {
		const s = settings((x) => toggleEntry(x, "blockedAccounts", "someone"));
		expect(decide({ ...base, post: reply("x"), settings: s, isFocal: true }).visibility).toBe(
			"show",
		);
	});

	test("actions follow settings; disabled shows everything", () => {
		const farmAcct = acct({
			followers: 40,
			following: 4900,
			createdAt: NOW - 20 * DAY,
			defaultAvatar: true,
		});
		const post = reply("Great point!");
		expect(decide({ account: farmAcct, post, settings: settings(), now: NOW }).visibility).toBe(
			"hide",
		);
		expect(
			decide({
				account: farmAcct,
				post,
				settings: settings((s) => (s.farmAction = "label")),
				now: NOW,
			}).visibility,
		).toBe("show");
		expect(
			decide({ account: farmAcct, post, settings: settings((s) => (s.enabled = false)), now: NOW })
				.visibility,
		).toBe("show");
	});
});
