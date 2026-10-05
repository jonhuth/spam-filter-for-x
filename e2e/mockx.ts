// A tiny fake x.com: X-shaped GraphQL (current no-legacy layout) + X-like DOM.
// Lets us run the real built extension end-to-end without an X session.

const NOW = Date.now();
const DAY = 86_400_000;
const xDate = (ms: number) => new Date(ms).toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+) (.+) GMT$/, "$1 $3 $2 $5 +0000 $4");

export interface MockUser {
	handle: string;
	name: string;
	followers: number;
	following: number;
	ageDays: number;
	basedIn: string;
	youFollow?: boolean;
	defaultAvatar?: boolean;
	source?: string;
	locationAccurate?: boolean;
}

export interface MockPost {
	id: string;
	user: MockUser;
	text: string;
	replyTo?: string;
}

export const users: Record<string, MockUser> = {
	senator: { handle: "senate_watch", name: "Senate Watch", followers: 210_000, following: 300, ageDays: 4000, basedIn: "United States" },
	farm1: { handle: "maga_eagle84721", name: "Patriot Eagle", followers: 31, following: 4200, ageDays: 19, basedIn: "Nigeria", defaultAvatar: true },
	farm2: { handle: "usa_first29384", name: "USA First", followers: 22, following: 3900, ageDays: 25, basedIn: "Pakistan", defaultAvatar: true },
	farm3: { handle: "liberty_wins5512", name: "Liberty Wins", followers: 45, following: 3100, ageDays: 33, basedIn: "Bangladesh", defaultAvatar: true },
	slop: { handle: "growth_mindset_ai", name: "Growth Mindset", followers: 140, following: 900, ageDays: 210, basedIn: "India", source: "India Android App" },
	human: { handle: "policy_nerd", name: "Policy Nerd", followers: 2300, following: 500, ageDays: 2900, basedIn: "Germany" },
	friend: { handle: "my_friend", name: "Friend", followers: 300, following: 280, ageDays: 1500, basedIn: "Canada", youFollow: true },
	vpn: { handle: "texas_truth_news", name: "Texas Truth", followers: 600, following: 1400, ageDays: 95, basedIn: "United States", source: "Nigeria Android App", locationAccurate: false },
};

const ROOT = "1900000000000000001";
export const posts: MockPost[] = [
	{ id: ROOT, user: users.senator!, text: "Senate passes the budget bill 51-49 after a late-night vote. Trump expected to sign Friday." },
	{ id: "1900000000000000002", user: users.farm1!, text: "This is exactly what America needs right now, God bless!", replyTo: ROOT },
	{ id: "1900000000000000003", user: users.farm2!, text: "This is exactly what America needs right now. God bless 🇺🇸", replyTo: ROOT },
	{ id: "1900000000000000004", user: users.farm3!, text: "this is exactly what America needs right now god bless!!", replyTo: ROOT },
	{ id: "1900000000000000005", user: users.slop!, text: "Great insight! It's not just a bill, it's a movement. 🚀", replyTo: ROOT },
	{ id: "1900000000000000006", user: users.human!, text: "The CBO score was released yesterday — the deficit impact is bigger than the summary suggests, see table 3.", replyTo: ROOT },
	{ id: "1900000000000000007", user: users.friend!, text: "well said, so true", replyTo: ROOT },
	{ id: "1900000000000000008", user: users.vpn!, text: "Well said. Couldn't agree more 💯", replyTo: ROOT },
];

function userNode(u: MockUser) {
	return {
		__typename: "User",
		rest_id: `9${u.handle.length}${u.followers}`,
		core: { screen_name: u.handle, name: u.name, created_at: xDate(NOW - u.ageDays * DAY) },
		avatar: {
			image_url: u.defaultAvatar
				? "https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png"
				: `https://pbs.twimg.com/profile_images/1/${u.handle}_normal.jpg`,
		},
		relationship_counts: { followers: u.followers, following: u.following },
		tweet_counts: { tweets: 1000 },
		relationship_perspectives: { following: Boolean(u.youFollow), followed_by: false },
		is_blue_verified: false,
		verification: { verified: false },
		privacy: { protected: false },
		location: { location: "" },
	};
}

export function tweetDetail() {
	return {
		data: {
			threaded_conversation_with_injections_v2: {
				instructions: [
					{
						type: "TimelineAddEntries",
						entries: posts.map((p) => ({
							entryId: `conversationthread-${p.id}`,
							content: {
								itemContent: {
									tweet_results: {
										result: {
											__typename: "Tweet",
											rest_id: p.id,
											core: { user_results: { result: userNode(p.user) } },
											legacy: {
												full_text: p.text,
												conversation_id_str: ROOT,
												in_reply_to_status_id_str: p.replyTo,
												in_reply_to_screen_name: p.replyTo ? users.senator!.handle : undefined,
												user_id_str: userNode(p.user).rest_id,
												lang: "en",
											},
										},
									},
								},
							},
						})),
					},
				],
			},
		},
	};
}

export function aboutAccount(handle: string) {
	const u = Object.values(users).find((x) => x.handle === handle);
	if (!u) return { data: {} };
	return {
		data: {
			user_result_by_screen_name: {
				result: {
					...userNode(u),
					about_profile: {
						account_based_in: u.basedIn,
						location_accurate: u.locationAccurate ?? true,
						source: u.source ?? "Web",
						username_changes: { count: "0" },
					},
				},
			},
		},
	};
}

export function page(): string {
	const article = (p: MockPost) => `
<div data-testid="cellInnerDiv"><article data-testid="tweet" role="article" style="border-bottom:1px solid #eff3f4;padding:12px 16px">
  <div data-testid="User-Name" style="display:flex;gap:4px;align-items:center">
    <div style="display:flex"><a href="/${p.user.handle}" style="font-weight:700;color:#0f1419;text-decoration:none"><span>${p.user.name}</span></a></div>
    <div style="display:flex;gap:4px;color:#536471"><a href="/${p.user.handle}" style="color:#536471;text-decoration:none">@${p.user.handle}</a> · <a href="/${p.user.handle}/status/${p.id}"><time>1h</time></a></div>
  </div>
  <div data-testid="tweetText" style="margin-top:4px">${p.text}</div>
</article></div>`;
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>X</title><style>body{margin:0;font:15px/1.4 -apple-system,system-ui,sans-serif;color:#0f1419;background:#fff}
main{max-width:600px;margin:0 auto;border-left:1px solid #eff3f4;border-right:1px solid #eff3f4;min-height:100vh}</style></head>
<body><main id="timeline"></main>
<script>
  // X loads data via GraphQL with an auth header, then renders.
  setTimeout(async () => {
    await fetch('/i/api/graphql/MockDetailId/TweetDetail?variables=%7B%7D', { headers: { authorization: 'Bearer mock', 'x-csrf-token': 'mock' } });
    document.getElementById('timeline').innerHTML = ${JSON.stringify(posts.map(article).join(""))};
  }, 300);
</script></body></html>`;
}

export const ROOT_ID = ROOT;
