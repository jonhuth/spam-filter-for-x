// Content script: injects the page bridge at document_start, then keeps every
// visible post's flag, verdict and visibility in sync with the local store.

import { type ThreadContext, threadContext } from "../core/context";
import { decide } from "../core/decide";
import { duplicateClusters } from "../core/text";
import type { AboutAccount, Post } from "../core/types";
import {
	type ContentToPage,
	type Envelope,
	isEnvelope,
	type PageToContent,
	type XAction,
} from "../shared/bridge";
import {
	hasEntry,
	type ListName,
	loadSettings,
	normalizeEntry,
	SETTINGS_KEY,
	type Settings,
	sanitize,
	toggleEntry,
	updateSettings,
} from "../shared/settings";
import { AboutQueue } from "./aboutQueue";
import { focalPostId, readTweet, SEL } from "./dom";
import { FocusMode } from "./focus.js";
import { type MenuAction, openMenu, toast } from "./menu";
import { applyVisibility, clearAll, ensureStyles, renderChips } from "./render";
import { ABOUT_CLEARED_KEY, Store } from "./store";

const nonce = crypto.randomUUID();
const store = new Store();
let settings: Settings | null = null;

// ── Page bridge ───────────────────────────────────────────────────────────

function injectPageScript(): void {
	const script = document.createElement("script");
	script.src = chrome.runtime.getURL("page.js");
	script.dataset.sfxNonce = nonce;
	script.onload = () => script.remove();
	(document.head ?? document.documentElement).appendChild(script);
}

let reqSeq = 0;
const pending = new Map<number, (msg: PageToContent) => void>();

// Messages wait until the page script announces it is listening.
let pageReady = false;
const outbox: ContentToPage[] = [];

function toPage(msg: ContentToPage): void {
	if (!pageReady) {
		outbox.push(msg);
		return;
	}
	const env: Envelope<ContentToPage> = { tag: "sfx", nonce, dir: "toPage", msg };
	window.postMessage(env, window.location.origin);
}

function request<T extends PageToContent>(
	build: (reqId: number) => ContentToPage,
	timeoutMs = 15_000,
): Promise<T | null> {
	const reqId = ++reqSeq;
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			pending.delete(reqId);
			resolve(null);
		}, timeoutMs);
		pending.set(reqId, (msg) => {
			clearTimeout(timer);
			resolve(msg as T);
		});
		toPage(build(reqId));
	});
}

window.addEventListener("message", (event) => {
	if (event.source !== window || !isEnvelope<PageToContent>(event.data, nonce, "toContent")) return;
	const msg = event.data.msg;
	if (msg.kind === "ready") {
		pageReady = true;
		for (const m of outbox.splice(0)) toPage(m);
	} else if (msg.kind === "batch") store.ingest(msg.batch);
	else if (msg.kind === "about" || msg.kind === "xActionResult") {
		pending.get(msg.reqId)?.(msg);
		pending.delete(msg.reqId);
	}
});

const aboutQueue = new AboutQueue(
	async (handle) => {
		const res = await request<Extract<PageToContent, { kind: "about" }>>((reqId) => ({
			kind: "about",
			reqId,
			handle,
		}));
		return { about: res?.about ?? null, status: res?.status ?? 0 };
	},
	(handle, about) => {
		store.setAbout(
			handle,
			about ?? ({ basedIn: null, fetchedAt: Date.now() } satisfies AboutAccount),
		);
	},
);

async function mirrorToX(action: XAction, target: string): Promise<boolean> {
	const res = await request<Extract<PageToContent, { kind: "xActionResult" }>>((reqId) => ({
		kind: "xAction",
		reqId,
		action,
		target,
	}));
	return Boolean(res?.ok);
}

// ── Evaluation ────────────────────────────────────────────────────────────

const contextCache = new Map<string, { ctx: ThreadContext; key: string }>();
const clusterCache = new Map<string, { sizes: Map<string, number>; count: number }>();

function contextFor(post: Post): ThreadContext | undefined {
	const convId = post.conversationId;
	if (!convId) return undefined;
	const root = store.posts.get(convId);
	if (!root) return undefined;
	const basedIn = store.getAbout(root.authorHandle)?.basedIn ?? null;
	const key = `${root.text.length}:${basedIn}`;
	const hit = contextCache.get(convId);
	if (hit?.key === key) return hit.ctx;
	const ctx = threadContext(root.text, basedIn);
	contextCache.set(convId, { ctx, key });
	return ctx;
}

function clusterSize(post: Post): number | undefined {
	const convId = post.conversationId;
	if (!convId || !post.inReplyToId) return undefined;
	const replies = [...store.posts.values()].filter(
		(p) => p.conversationId === convId && p.inReplyToId,
	);
	let entry = clusterCache.get(convId);
	if (!entry || entry.count !== replies.length) {
		entry = { sizes: duplicateClusters(replies), count: replies.length };
		clusterCache.set(convId, entry);
	}
	return entry.sizes.get(post.id);
}

const visible = new Set<HTMLElement>();
const io = new IntersectionObserver(
	(entries) => {
		for (const e of entries) {
			const el = e.target as HTMLElement;
			if (e.isIntersecting) {
				visible.add(el);
				evaluate(el);
			} else visible.delete(el);
		}
	},
	{ rootMargin: "800px 0px" },
);

function evaluate(el: HTMLElement): void {
	const s = settings;
	if (!s) return;
	if (!el.dataset.sfxSeen) {
		el.dataset.sfxSeen = "1";
		io.observe(el);
	}
	const ref = readTweet(el);
	const intercepted = ref.postId ? store.posts.get(ref.postId) : undefined;
	const handle = intercepted?.authorHandle ?? ref.handle;
	if (!handle) return;
	el.dataset.sfxHandle = handle;
	const post: Post = intercepted ?? {
		id: ref.postId ?? "",
		authorId: "",
		authorHandle: handle,
		text: ref.text,
	};
	const account = store.account(handle);

	if (s.enabled && store.needsAbout(handle) && visible.has(el)) aboutQueue.request(handle);

	const parent = post.inReplyToId ? store.posts.get(post.inReplyToId) : undefined;
	const d = decide({
		post,
		account,
		parentText: parent?.text,
		context: contextFor(post),
		clusterSize: clusterSize(post),
		settings: s,
		isFocal: Boolean(ref.postId && ref.postId === focalPostId()),
	});

	renderChips(
		el,
		{
			handle,
			place: d.place,
			loading: s.enabled && store.aboutPending(handle),
			masked: d.masked,
			verdict: d.verdict,
			muted: d.listReason === "muted" || d.listReason === "word" ? "muted" : null,
			showFlag: s.enabled && s.showFlags,
			showBadge: s.enabled,
		},
		(anchor) => showMenu(anchor, handle, d, post),
	);
	applyVisibility(el, d.visibility, d.summary, () => evaluate(el));
}

function showMenu(
	anchor: HTMLElement,
	handle: string,
	d: ReturnType<typeof decide>,
	post: Post,
): void {
	const s = settings;
	if (!s) return;
	const place = d.place;
	openMenu(
		anchor,
		{
			handle,
			place,
			masked: d.masked,
			verdict: d.verdict,
			mutedBy: d.mutedWord,
			isMuted: hasEntry(s, "mutedAccounts", handle),
			isBlocked: hasEntry(s, "blockedAccounts", handle),
			isTrusted: hasEntry(s, "trustedAccounts", handle),
			isCountryHidden: Boolean(place && hasEntry(s, "hiddenCountries", place.name)),
			isCountryWatched: Boolean(place && hasEntry(s, "watchCountries", place.name)),
			mirrorToX: s.mirrorToX,
			selectedText: window.getSelection()?.toString().trim() || "",
		},
		(a) => void runAction(a, handle, place?.name, post),
	);
}

async function setEntry(list: ListName, value: string, on: boolean): Promise<void> {
	settings = await updateSettings((s) => toggleEntry(s, list, value, on));
	rescanAll();
}

async function runAction(
	a: MenuAction,
	handle: string,
	country: string | undefined,
	_post: Post,
): Promise<void> {
	const s = settings;
	if (!s) return;
	const at = `@${handle}`;
	const target: Partial<Record<MenuAction["type"], [ListName, string | undefined]>> = {
		mute: ["mutedAccounts", handle],
		block: ["blockedAccounts", handle],
		trust: ["trustedAccounts", handle],
		hideCountry: ["hiddenCountries", country],
		watchCountry: ["watchCountries", country],
		muteWord: ["mutedWords", a.type === "muteWord" ? a.word : undefined],
	};
	const t = target[a.type];
	if (t && !normalizeEntry(t[0], t[1] ?? "")) {
		toast("Couldn’t apply that — invalid entry");
		return;
	}
	switch (a.type) {
		case "mute":
		case "block": {
			const list: ListName = a.type === "mute" ? "mutedAccounts" : "blockedAccounts";
			await setEntry(list, handle, a.on);
			let suffix = "";
			if (s.mirrorToX) {
				const action: XAction =
					a.type === "mute" ? (a.on ? "mute" : "unmute") : a.on ? "block" : "unblock";
				suffix = (await mirrorToX(action, handle)) ? " here and on X" : " here (X didn’t respond)";
			}
			const verb =
				a.type === "mute" ? (a.on ? "Muted" : "Unmuted") : a.on ? "Blocked" : "Unblocked";
			toast(`${verb} ${at}${suffix}`, () => void setEntry(list, handle, !a.on));
			break;
		}
		case "trust":
			await setEntry("trustedAccounts", handle, a.on);
			toast(
				a.on ? `Always showing ${at}` : `Stopped trusting ${at}`,
				() => void setEntry("trustedAccounts", handle, !a.on),
			);
			break;
		case "hideCountry":
		case "watchCountry": {
			if (!country) return;
			const list: ListName = a.type === "hideCountry" ? "hiddenCountries" : "watchCountries";
			await setEntry(list, country, a.on);
			const verb =
				a.type === "hideCountry" ? (a.on ? "Hiding" : "Showing") : a.on ? "Watching" : "Unwatched";
			toast(`${verb} ${country}`, () => void setEntry(list, country, !a.on));
			break;
		}
		case "muteWord": {
			await setEntry("mutedWords", a.word, true);
			// X's keyword unmute needs X's own id, so a mirrored word mute has no
			// one-tap undo here; it can be removed in X's settings.
			if (s.mirrorToX && (await mirrorToX("muteWord", a.word)))
				toast(`Muted “${a.word}” here and on X`);
			else toast(`Muted “${a.word}”`, () => void setEntry("mutedWords", a.word, false));
			break;
		}
		case "mirrorToX":
			settings = await updateSettings((x) => {
				x.mirrorToX = a.on;
			});
			break;
	}
}

// ── Scanning ──────────────────────────────────────────────────────────────

let scanQueued = false;
const dirty = new Set<HTMLElement>();

function scheduleScan(els?: Iterable<HTMLElement>): void {
	if (els) for (const el of els) dirty.add(el);
	if (scanQueued) return;
	scanQueued = true;
	requestAnimationFrame(() => {
		scanQueued = false;
		const batch = [...dirty];
		dirty.clear();
		for (const el of batch) if (el.isConnected) evaluate(el);
	});
}

function rescanAll(): void {
	scheduleScan(document.querySelectorAll<HTMLElement>(SEL.tweet));
}

store.onChange((handles) => {
	const els: HTMLElement[] = [];
	for (const el of document.querySelectorAll<HTMLElement>(SEL.tweet)) {
		const h = el.dataset.sfxHandle;
		if (!h || handles.has(h)) els.push(el);
	}
	scheduleScan(els);
});

function observeDom(): void {
	new MutationObserver((mutations) => {
		const found: HTMLElement[] = [];
		for (const m of mutations) {
			for (const n of m.addedNodes) {
				if (!(n instanceof HTMLElement)) continue;
				if (n.matches(SEL.tweet)) found.push(n);
				else found.push(...n.querySelectorAll<HTMLElement>(SEL.tweet));
			}
		}
		if (found.length) scheduleScan(found);
	}).observe(document.body, { childList: true, subtree: true });
	rescanAll();
}

chrome.storage.onChanged.addListener((changes, area) => {
	if (area !== "local") return;
	if (changes[SETTINGS_KEY]) {
		settings = sanitize(changes[SETTINGS_KEY].newValue);
		if (!settings.enabled) clearAll();
		rescanAll();
	}
	if (changes[ABOUT_CLEARED_KEY]) {
		store.reset();
		rescanAll();
	}
});

// ── Boot ──────────────────────────────────────────────────────────────────

injectPageScript();

async function boot(): Promise<void> {
	[settings] = await Promise.all([loadSettings(), store.load()]);
	ensureStyles();
	await FocusMode.initFocusMode();
	if (document.body) observeDom();
	else document.addEventListener("DOMContentLoaded", observeDom, { once: true });
}

void boot();
