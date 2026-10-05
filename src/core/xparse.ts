// Parse X web GraphQL responses into normalized Account / Post records.
// Tolerates both the pre-2025 layout (everything under `legacy`) and the
// current layout (`core`, `avatar`, `location`, `relationship_perspectives`).

import type { AboutAccount, Account, ParsedBatch, Post } from "./types";

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null;
const obj = (v: unknown): Json => (isObj(v) ? v : {});
const str = (v: unknown): string | undefined =>
	typeof v === "string" && v.length > 0 ? v : undefined;
const num = (v: unknown): number | undefined =>
	typeof v === "number" && Number.isFinite(v)
		? v
		: typeof v === "string" && /^\d+$/.test(v)
			? Number(v)
			: undefined;
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);

/** X dates look like "Wed Oct 10 20:19:24 +0000 2018". */
export function parseXDate(v: unknown): number | undefined {
	const s = str(v);
	if (!s) return undefined;
	const ms = Date.parse(s);
	return Number.isFinite(ms) ? ms : undefined;
}

/** Unwrap TweetWithVisibilityResults and similar wrappers. */
function unwrapTweet(node: Json): Json {
	if (node.__typename === "TweetWithVisibilityResults" && isObj(node.tweet)) return node.tweet;
	if (isObj(node.tweet) && !node.legacy) return node.tweet;
	return node;
}

export function parseUser(node: unknown, now = Date.now()): Account | null {
	if (!isObj(node)) return null;
	if (node.__typename && node.__typename !== "User") return null;
	const legacy = obj(node.legacy);
	const core = obj(node.core);
	const id = str(node.rest_id);
	const handle = str(core.screen_name) ?? str(legacy.screen_name);
	if (!id || !handle) return null;

	const avatarUrl =
		str(obj(node.avatar).image_url) ?? str(legacy.profile_image_url_https) ?? undefined;
	const rel = obj(node.relationship_perspectives);
	const youFollow = bool(rel.following) ?? bool(legacy.following);
	const followsYou = bool(rel.followed_by) ?? bool(legacy.followed_by);
	const verification = obj(node.verification);

	const account: Account = {
		id,
		handle: handle.toLowerCase(),
		displayName: str(core.name) ?? str(legacy.name),
		followers: num(obj(node.relationship_counts).followers) ?? num(legacy.followers_count),
		following: num(obj(node.relationship_counts).following) ?? num(legacy.friends_count),
		posts: num(obj(node.tweet_counts).tweets) ?? num(legacy.statuses_count),
		createdAt: parseXDate(core.created_at) ?? parseXDate(legacy.created_at),
		defaultAvatar:
			bool(legacy.default_profile_image) ??
			(avatarUrl ? avatarUrl.includes("default_profile") : undefined),
		blueVerified: bool(node.is_blue_verified),
		verified: bool(verification.verified) ?? bool(legacy.verified),
		protected: bool(obj(node.privacy).protected) ?? bool(legacy.protected),
		bio: str(obj(node.profile_bio).description) ?? str(legacy.description),
		profileLocation: str(obj(node.location).location) ?? str(legacy.location),
		youFollow,
		followsYou,
		seenAt: now,
	};
	const about = parseAboutProfile(node.about_profile, now);
	if (about) account.about = about;
	return account;
}

export function parseAboutProfile(node: unknown, now = Date.now()): AboutAccount | null {
	if (!isObj(node)) return null;
	const changes = obj(node.username_changes);
	return {
		basedIn: str(node.account_based_in) ?? null,
		locationAccurate: bool(node.location_accurate),
		createdCountryAccurate: bool(node.created_country_accurate),
		source: str(node.source),
		usernameChanges: num(changes.count),
		fetchedAt: now,
	};
}

/** Parse an AboutAccountQuery response body. */
export function parseAboutAccountResponse(body: unknown, now = Date.now()): AboutAccount | null {
	const result = obj(obj(obj(body).data).user_result_by_screen_name).result;
	return parseAboutProfile(obj(result).about_profile, now);
}

/** The full account (profile + about) from an AboutAccountQuery response. */
export function parseAboutAccountUser(body: unknown, now = Date.now()): Account | null {
	return parseUser(obj(obj(obj(body).data).user_result_by_screen_name).result, now);
}

function userFromResults(v: unknown): Json | undefined {
	const r = obj(obj(v).user_results).result;
	return isObj(r) ? r : undefined;
}

export function parseTweet(raw: unknown): Post | null {
	if (!isObj(raw)) return null;
	const node = unwrapTweet(raw);
	if (node.__typename && node.__typename !== "Tweet") return null;
	// Since 2026 X may serve Tweet with legacy=null and fields at the top level.
	const legacy = isObj(node.legacy) ? { ...node, ...node.legacy } : node;
	const id = str(node.rest_id) ?? str(legacy.id_str);
	const userNode = userFromResults(node.core);
	const userCore = obj(userNode?.core);
	const userLegacy = obj(userNode?.legacy);
	const authorId = str(legacy.user_id_str) ?? str(userNode?.rest_id);
	const authorHandle = str(userCore.screen_name) ?? str(userLegacy.screen_name);
	if (!id || !authorId || !authorHandle) return null;
	const note = obj(obj(obj(node.note_tweet).note_tweet_results).result);
	return {
		id,
		authorId,
		authorHandle: authorHandle.toLowerCase(),
		text: str(note.text) ?? str(legacy.full_text) ?? "",
		lang: str(legacy.lang),
		conversationId: str(legacy.conversation_id_str),
		inReplyToId: str(legacy.in_reply_to_status_id_str),
		inReplyToHandle: str(legacy.in_reply_to_screen_name)?.toLowerCase(),
		quotedId: str(legacy.quoted_status_id_str),
		createdAt: parseXDate(legacy.created_at),
		likes: num(legacy.favorite_count),
		replies: num(legacy.reply_count),
		views: num(obj(node.views).count),
	};
}

/**
 * Walk any GraphQL response and collect every User and Tweet node.
 * Promoted entries are detected from timeline item content.
 */
export function parseGraphQL(body: unknown, now = Date.now()): ParsedBatch {
	const accounts = new Map<string, Account>();
	const posts = new Map<string, Post>();
	const stack: { v: unknown; depth: number; promoted: boolean }[] = [
		{ v: body, depth: 0, promoted: false },
	];
	let visited = 0;
	while (stack.length > 0 && visited < 200_000) {
		const { v, depth, promoted: inPromoted } = stack.pop()!;
		visited++;
		if (!isObj(v) || depth > 40) continue;
		if (Array.isArray(v)) {
			for (const item of v) stack.push({ v: item, depth: depth + 1, promoted: inPromoted });
			continue;
		}
		const promoted = inPromoted || isObj(v.promotedMetadata);
		const type = v.__typename;
		if (type === "User" || (type === undefined && isObj(v.legacy) && v.rest_id && v.core)) {
			const account = parseUser(v, now);
			if (account) {
				const prev = accounts.get(account.handle);
				accounts.set(account.handle, prev ? mergeAccount(prev, account) : account);
			}
		} else if (type === "Tweet" || type === "TweetWithVisibilityResults") {
			const post = parseTweet(v);
			if (post) {
				if (promoted) post.promoted = true;
				posts.set(post.id, { ...posts.get(post.id), ...post });
			}
		}
		for (const child of Object.values(v)) {
			if (isObj(child)) stack.push({ v: child, depth: depth + 1, promoted });
		}
	}
	return { accounts: [...accounts.values()], posts: [...posts.values()] };
}

/** Merge newer fields over older ones without clobbering known values with undefined. */
export function mergeAccount(prev: Account, next: Partial<Account>): Account {
	const merged: Account = { ...prev };
	for (const [k, v] of Object.entries(next) as [keyof Account, unknown][]) {
		if (v !== undefined) (merged as unknown as Record<string, unknown>)[k] = v;
	}
	return merged;
}

/** Extract `queryId` for an operation from a request URL like /i/api/graphql/<id>/<Op>. */
export function queryIdFromUrl(url: string): { op: string; id: string } | null {
	const m = url.match(/\/i\/api\/graphql\/([A-Za-z0-9_-]+)\/([A-Za-z]+)/);
	return m?.[1] && m[2] ? { id: m[1], op: m[2] } : null;
}

/** Extract every queryId/operationName pair from X's main JS bundle. */
export function queryIdsFromBundle(source: string): Record<string, string> {
	const out: Record<string, string> = {};
	const re = /queryId:"([A-Za-z0-9_-]+)",operationName:"([A-Za-z]+)"/g;
	for (const m of source.matchAll(re)) {
		if (m[1] && m[2]) out[m[2]] = m[1];
	}
	return out;
}
