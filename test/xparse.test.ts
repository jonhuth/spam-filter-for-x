import { describe, expect, test } from "bun:test";
import {
	parseAboutAccountResponse,
	parseAboutAccountUser,
	parseGraphQL,
	queryIdFromUrl,
	queryIdsFromBundle,
} from "../src/core/xparse";

const fixture = (name: string) => Bun.file(`${import.meta.dir}/fixtures/${name}`).json();

describe("parseGraphQL across X layouts", () => {
	for (const file of ["user-timeline-entry-v3-no-legacy.json", "user-timeline-entry.json"]) {
		test(file, async () => {
			const { accounts, posts } = parseGraphQL(await fixture(file));
			const byHandle = Object.fromEntries(accounts.map((a) => [a.handle, a]));

			const priya = byHandle.priya_codes!;
			expect(priya.followers).toBe(4821);
			expect(priya.following).toBe(612);
			expect(priya.youFollow).toBe(true);
			expect(priya.createdAt).toBe(Date.parse("Wed Nov 30 09:12:44 +0000 2022"));
			expect(priya.defaultAvatar).toBe(false);

			const farm = byHandle.crypto_gains_2026!;
			expect(farm.followers).toBe(73);
			expect(farm.following).toBe(4987);
			expect(farm.youFollow).toBe(false);

			const reply = posts.find((p) => p.authorHandle === "crypto_gains_2026")!;
			expect(reply.inReplyToId).toBe("2104572631185227899");
			expect(reply.conversationId).toBe("2104572631185227899");
			expect(reply.text.length).toBeGreaterThan(0);
			expect(reply.text.endsWith("…")).toBe(false); // note_tweet full text preferred

			const ad = posts.find((p) => p.authorHandle === "acme_cloud")!;
			expect(ad.promoted).toBe(true);
			expect(posts.find((p) => p.authorHandle === "priya_codes")!.promoted).toBeUndefined();
		});
	}

	test("legacy (pre-2025) user layout", async () => {
		const { accounts } = parseGraphQL(await fixture("legacy-user.json"));
		expect(accounts).toHaveLength(1);
		expect(accounts[0]!.handle).toBe("priya_codes");
		expect(accounts[0]!.followers).toBe(3911);
		expect(accounts[0]!.youFollow).toBe(true);
	});

	test("skips stub users with no core/legacy and tombstones", () => {
		const { accounts, posts } = parseGraphQL({
			a: { __typename: "User", rest_id: "1", action_counts: {} },
			b: { __typename: "TweetTombstone" },
			c: { __typename: "UserUnavailable", reason: "Suspended" },
		});
		expect(accounts).toHaveLength(0);
		expect(posts).toHaveLength(0);
	});

	test("Tweet with legacy=null reads top-level fields", () => {
		const { posts } = parseGraphQL({
			__typename: "Tweet",
			rest_id: "9",
			legacy: null,
			full_text: "hello",
			conversation_id_str: "8",
			in_reply_to_status_id_str: "8",
			core: {
				user_results: {
					result: { __typename: "User", rest_id: "5", core: { screen_name: "Bob" } },
				},
			},
		});
		expect(posts[0]).toMatchObject({
			id: "9",
			authorHandle: "bob",
			text: "hello",
			inReplyToId: "8",
		});
	});
});

describe("AboutAccountQuery", () => {
	test("country + app store source", async () => {
		const body = await fixture("about-account.json");
		const about = parseAboutAccountResponse(body)!;
		expect(about.basedIn).toBe("India");
		expect(about.locationAccurate).toBe(true);
		expect(about.source).toBe("India Android App");
		expect(about.usernameChanges).toBe(4); // string "4" in the wire format
		const account = parseAboutAccountUser(body)!;
		expect(account.handle).toBe("crypto_gains_2026");
		expect(account.about?.basedIn).toBe("India");
	});

	test("region-level, inaccurate location", async () => {
		const about = parseAboutAccountResponse(await fixture("about-account-region-web.json"))!;
		expect(about.basedIn).toBe("South Asia");
		expect(about.locationAccurate).toBe(false);
		expect(about.createdCountryAccurate).toBe(false);
		expect(about.usernameChanges).toBe(0);
	});
});

describe("queryId discovery", () => {
	test("from request URLs", () => {
		expect(queryIdFromUrl("https://x.com/i/api/graphql/abc_-12/TweetDetail?variables=")).toEqual({
			id: "abc_-12",
			op: "TweetDetail",
		});
		expect(queryIdFromUrl("https://x.com/home")).toBeNull();
	});

	test("from the main bundle", () => {
		const src =
			'e.exports={queryId:"og4a4SdSF3WiQkkwaPCdPg",operationName:"HomeTimeline",operationType:"query"};' +
			'e.exports={queryId:"TzOG2twZEfhr9KmClvVVqA",operationName:"AboutAccountQuery",operationType:"query"}';
		expect(queryIdsFromBundle(src)).toEqual({
			HomeTimeline: "og4a4SdSF3WiQkkwaPCdPg",
			AboutAccountQuery: "TzOG2twZEfhr9KmClvVVqA",
		});
	});
});
