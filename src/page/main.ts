// Runs in X's page world. Passively parses X's own GraphQL traffic, and
// performs the few active calls (About this account, mute/block) with the
// user's own session headers. Must never break X: every hook is try/catch.

import {
	parseAboutAccountResponse,
	parseAboutAccountUser,
	parseGraphQL,
	queryIdFromUrl,
	queryIdsFromBundle,
} from "../core/xparse";
import {
	type ContentToPage,
	type Envelope,
	isEnvelope,
	type PageToContent,
} from "../shared/bridge";

const nonce = (document.currentScript as HTMLScriptElement | null)?.dataset.sfxNonce ?? "";

/** Fallbacks only; live ids are learned from traffic or X's bundle. */
const FALLBACK_QUERY_IDS: Record<string, string> = {
	AboutAccountQuery: "XRqGa7EeokUU5kppkh13EA",
};
const queryIds: Record<string, string> = {};
const ABOUT_FEATURES = encodeURIComponent(
	JSON.stringify({ responsive_web_graphql_timeline_navigation_enabled: true }),
);
let headers: Record<string, string> | null = null;

function send(msg: PageToContent): void {
	const env: Envelope<PageToContent> = { tag: "sfx", nonce, dir: "toContent", msg };
	window.postMessage(env, window.location.origin);
}

/** Only session/auth headers; per-request ones (transaction id, content-type) must not be replayed. */
const REPLAY_HEADERS = [
	"authorization",
	"x-csrf-token",
	"x-twitter-auth-type",
	"x-twitter-active-user",
	"x-twitter-client-language",
];
function pickAuthHeaders(h: Record<string, string>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const k of REPLAY_HEADERS) if (h[k]) out[k] = h[k];
	return out;
}

function captureHeaders(h: HeadersInit | undefined): void {
	if (!h) return;
	const out: Record<string, string> = {};
	try {
		new Headers(h).forEach((v, k) => {
			out[k] = v;
		});
	} catch {
		return;
	}
	if (out.authorization) headers = pickAuthHeaders(out);
}

function handleGraphQLBody(url: string, body: unknown): void {
	const q = queryIdFromUrl(url);
	if (q) queryIds[q.op] = q.id;
	const batch = parseGraphQL(body);
	if (batch.accounts.length || batch.posts.length) send({ kind: "batch", batch });
}

const isGraphQL = (url: string) => url.includes("/i/api/graphql/");

// fetch hook
const originalFetch = window.fetch;
window.fetch = Object.assign(
	async function patchedFetch(this: unknown, ...args: Parameters<typeof fetch>) {
		const [input, init] = args;
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		if (isGraphQL(url)) {
			try {
				captureHeaders(init?.headers ?? (input instanceof Request ? input.headers : undefined));
			} catch {
				/* ignore */
			}
		}
		const response = await originalFetch.apply(this, args);
		if (isGraphQL(url)) {
			response
				.clone()
				.json()
				.then((body) => handleGraphQLBody(url, body))
				.catch(() => {});
		}
		return response;
	},
	{ preconnect: originalFetch.preconnect },
) as typeof fetch;

// XHR hook (X has used both over time)
const XHR = XMLHttpRequest.prototype;
const originalOpen = XHR.open;
const originalSetHeader = XHR.setRequestHeader;
XHR.open = function patchedOpen(
	this: XMLHttpRequest & { __sfxUrl?: string; __sfxHeaders?: Record<string, string> },
	...args: unknown[]
) {
	this.__sfxUrl = String(args[1] ?? "");
	this.__sfxHeaders = {};
	if (isGraphQL(this.__sfxUrl)) {
		this.addEventListener("load", () => {
			try {
				if (this.responseType === "" || this.responseType === "text")
					handleGraphQLBody(this.__sfxUrl!, JSON.parse(this.responseText));
				else if (this.responseType === "json") handleGraphQLBody(this.__sfxUrl!, this.response);
			} catch {
				/* ignore */
			}
		});
	}
	return (originalOpen as (...a: unknown[]) => void).apply(this, args);
} as typeof XHR.open;
XHR.setRequestHeader = function patchedSetHeader(
	this: XMLHttpRequest & { __sfxUrl?: string; __sfxHeaders?: Record<string, string> },
	name: string,
	value: string,
) {
	if (this.__sfxHeaders && isGraphQL(this.__sfxUrl ?? "")) {
		this.__sfxHeaders[name.toLowerCase()] = value;
		if (this.__sfxHeaders.authorization) headers = pickAuthHeaders(this.__sfxHeaders);
	}
	return originalSetHeader.call(this, name, value);
};

let bundleScanned = false;
async function discoverQueryId(op: string): Promise<string | undefined> {
	if (queryIds[op]) return queryIds[op];
	if (!bundleScanned) {
		bundleScanned = true;
		const scripts = [...document.querySelectorAll<HTMLScriptElement>("script[src]")]
			.map((s) => s.src)
			.filter(
				(src) =>
					/\/(?:main|api)\.[\w]+\.js$/.test(src) ||
					src.includes("/responsive-web/client-web/main."),
			);
		for (const src of scripts) {
			try {
				const text = await (await originalFetch(src)).text();
				Object.assign(queryIds, { ...queryIdsFromBundle(text), ...queryIds });
			} catch {
				/* CORS or network — fall back */
			}
		}
	}
	return queryIds[op] ?? FALLBACK_QUERY_IDS[op];
}

async function waitForHeaders(): Promise<boolean> {
	for (let i = 0; i < 50 && !headers; i++) await new Promise((r) => setTimeout(r, 100));
	return Boolean(headers);
}

async function fetchAbout(reqId: number, handle: string): Promise<void> {
	let status = 0;
	try {
		await waitForHeaders();
		const id = await discoverQueryId("AboutAccountQuery");
		const variables = encodeURIComponent(JSON.stringify({ screenName: handle }));
		const res = await originalFetch(
			`/i/api/graphql/${id}/AboutAccountQuery?variables=${variables}&features=${ABOUT_FEATURES}`,
			{
				credentials: "include",
				headers: headers ?? {},
			},
		);
		status = res.status;
		const body = res.ok ? await res.json() : null;
		const about = body ? parseAboutAccountResponse(body) : null;
		const account = body ? parseAboutAccountUser(body) : null;
		if (account) send({ kind: "batch", batch: { accounts: [account], posts: [] } });
		send({ kind: "about", reqId, handle, about, status });
	} catch {
		send({ kind: "about", reqId, handle, about: null, status });
	}
}

/** X's own REST endpoints used by its mute/block menu items. */
const X_ACTIONS = {
	mute: ["/i/api/1.1/mutes/users/create.json", "screen_name"],
	unmute: ["/i/api/1.1/mutes/users/destroy.json", "screen_name"],
	block: ["/i/api/1.1/blocks/create.json", "screen_name"],
	unblock: ["/i/api/1.1/blocks/destroy.json", "screen_name"],
	muteWord: ["/i/api/1.1/mutes/keywords/create.json", "keyword"],
} as const;

async function runXAction(
	reqId: number,
	action: keyof typeof X_ACTIONS,
	target: string,
): Promise<void> {
	let status = 0;
	try {
		await waitForHeaders();
		const [path, field] = X_ACTIONS[action];
		const body = new URLSearchParams({ [field]: target });
		if (action === "muteWord") {
			body.set("mute_surfaces", "notifications,home_timeline,tweet_replies");
			body.set("mute_option", "");
			body.set("duration", "");
		}
		const h: Record<string, string> = { ...(headers ?? {}) };
		h["content-type"] = "application/x-www-form-urlencoded";
		const res = await originalFetch(path, {
			method: "POST",
			credentials: "include",
			headers: h,
			body,
		});
		status = res.status;
		send({ kind: "xActionResult", reqId, ok: res.ok, status });
	} catch {
		send({ kind: "xActionResult", reqId, ok: false, status });
	}
}

window.addEventListener("message", (event) => {
	if (event.source !== window || !isEnvelope<ContentToPage>(event.data, nonce, "toPage")) return;
	const msg = event.data.msg;
	if (msg.kind === "about") void fetchAbout(msg.reqId, msg.handle);
	else if (msg.kind === "xAction") void runXAction(msg.reqId, msg.action, msg.target);
});

send({ kind: "ready" });
