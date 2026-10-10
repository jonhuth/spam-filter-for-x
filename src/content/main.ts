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
	entryFor,
	FEEDBACK_KEY,
	type FeedbackMap,
	loadFeedback,
	setVote,
} from "../shared/feedback";
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
import { initFocus } from "./focus";
import { openManager } from "./manager";
import { type MenuAction, openMenu, toast } from "./menu";
import { applyVisibility, clearAll, ensureStyles, renderChips, renderThreadBar } from "./render";
import { ABOUT_CLEARED_KEY, Store } from "./store";

const nonce = crypto.randomUUID();
const store = new Store();
let settings: Settings | null = null;
let feedback: FeedbackMap = {};
/** Conversation ids where the user tapped "Show all". */
const revealedThreads = new Set<string>();

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
	else if (msg.kind === "about" || msg.kind === "xActionResult" || msg.kind === "importResult") {
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
		return { about: res?.about ?? null, status: res?.status ?? 0, rate: res?.rate };
	},
	(handle, about) => {
		store.setAbout(
			handle,
			about ?? ({ basedIn: null, fetchedAt: Date.now() } satisfies AboutAccount),
		);
	},
	{},
	(handle) => store.markFailed(handle),
);

async function importFromX() {
	const res = await request<Extract<PageToContent, { kind: "importResult" }>>(
		(reqId) => ({ kind: "importLists", reqId }),
		60_000,
	);
	return res?.lists ?? null;
}

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
const clusterCache = new Map<string, { sizes: Map<string, number>; storeSize: number }>();

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
	// Recompute only when the store has grown since the last pass.
	let entry = clusterCache.get(convId);
	if (!entry || entry.storeSize !== store.posts.size) {
		const replies = [...store.posts.values()].filter(
			(p) => p.conversationId === convId && p.inReplyToId,
		);
		entry = { sizes: duplicateClusters(replies), storeSize: store.posts.size };
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
	const d = decideFor(post, ref.postId);

	// Riskiest unknown accounts get located first; trusted ones last.
	if (s.enabled && store.needsAbout(handle) && visible.has(el)) {
		const priority =
			d.verdict.label === "trusted" ? -10 : d.verdict.score + (post.inReplyToId ? 1 : 0);
		aboutQueue.request(handle, priority);
	}

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

function threadOf(): { focalId: string; convId: string } | null {
	const focalId = focalPostId();
	if (!focalId) return null;
	return { focalId, convId: store.posts.get(focalId)?.conversationId ?? focalId };
}

function decideFor(post: Post, domPostId?: string | null) {
	const thread = threadOf();
	const id = domPostId ?? post.id;
	const inThread = Boolean(
		thread && id !== thread.focalId && post.inReplyToId && post.conversationId === thread.convId,
	);
	const parent = post.inReplyToId ? store.posts.get(post.inReplyToId) : undefined;
	return decide({
		post,
		account: store.account(post.authorHandle),
		parentText: parent?.text,
		context: contextFor(post),
		clusterSize: clusterSize(post),
		settings: settings!,
		isFocal: Boolean(thread && id === thread.focalId),
		inThread,
		threadRevealed: Boolean(thread && revealedThreads.has(thread.convId)),
		feedback: feedback[post.authorHandle]?.vote,
	});
}

/** "18 low-quality replies hidden · 🇳🇬 6 · 🇮🇳 5" over every reply X sent, not only mounted ones. */
function threadSummary(): string | null {
	const thread = threadOf();
	if (!thread || !settings || revealedThreads.has(thread.convId)) return null;
	let n = 0;
	const byPlace = new Map<string, number>();
	for (const p of store.posts.values()) {
		if (p.conversationId !== thread.convId || !p.inReplyToId || p.id === thread.focalId) continue;
		const d = decideFor(p);
		if (d.visibility !== "fold") continue;
		// Folded replies aren't on screen, but their countries feed the bar.
		// Located after what's visible (lower priority).
		if (store.needsAbout(p.authorHandle)) aboutQueue.request(p.authorHandle, d.verdict.score - 5);
		n++;
		const key = d.place?.emoji ?? "❔";
		byPlace.set(key, (byPlace.get(key) ?? 0) + 1);
	}
	if (!n) return null;
	const top = [...byPlace.entries()]
		.sort((x, y) => y[1] - x[1])
		.slice(0, 5)
		.map(([e, c]) => `${e} ${c}`)
		.join(" · ");
	return `${n} low-quality ${n === 1 ? "reply" : "replies"} hidden · ${top}`;
}

let barTimer: ReturnType<typeof setTimeout> | null = null;
function updateThreadBar(): void {
	if (barTimer) return;
	barTimer = setTimeout(() => {
		barTimer = null;
		renderThreadBarNow();
	}, 250);
}

function renderThreadBarNow(): void {
	renderThreadBar(threadSummary(), () => {
		const thread = threadOf();
		if (thread) revealedThreads.add(thread.convId);
		rescanAll();
	});
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
			vote: feedback[handle]?.vote ?? null,
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
	post: Post,
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
			const xAction = (on: boolean): XAction =>
				a.type === "mute" ? (on ? "mute" : "unmute") : on ? "block" : "unblock";
			let mirrored = false;
			let suffix = "";
			if (s.mirrorToX) {
				mirrored = await mirrorToX(xAction(a.on), handle);
				suffix = mirrored ? " here and on X" : " here (X didn’t respond)";
			}
			const verb =
				a.type === "mute" ? (a.on ? "Muted" : "Unmuted") : a.on ? "Blocked" : "Unblocked";
			toast(`${verb} ${at}${suffix}`, () => {
				void setEntry(list, handle, !a.on);
				if (mirrored) void mirrorToX(xAction(!a.on), handle);
			});
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
		case "vote": {
			const prev = feedback[handle] ?? null;
			const verdict = decideFor(post).verdict;
			const basedIn = store.getAbout(handle)?.basedIn;
			feedback = await setVote(
				handle,
				a.vote ? entryFor(a.vote, verdict, basedIn, post.text) : null,
			);
			rescanAll();
			const msg =
				a.vote === "fine"
					? `Got it — ${at} looks fine`
					: a.vote === "spam"
						? `Marked ${at} as spam`
						: "Vote cleared";
			toast(msg, async () => {
				feedback = await setVote(handle, prev);
				rescanAll();
			});
			break;
		}
		case "manage":
			void openManager(importFromX);
			break;
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
		updateThreadBar();
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
	store.mergeFromStorage(changes);
	if (changes[FEEDBACK_KEY]) {
		feedback = (changes[FEEDBACK_KEY].newValue as FeedbackMap) ?? {};
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
	[settings, feedback] = await Promise.all([loadSettings(), loadFeedback(), store.load()]);
	ensureStyles();
	await initFocus();
	// ⌥M (Alt+M) opens the mutes & blocks manager anywhere on X.
	document.addEventListener(
		"keydown",
		(e) => {
			if (e.altKey && e.code === "KeyM" && !e.metaKey && !e.ctrlKey) {
				e.preventDefault();
				void openManager(importFromX);
			}
		},
		true,
	);
	chrome.runtime.onMessage.addListener((msg) => {
		if (msg?.type === "openManager") void openManager(importFromX);
	});
	if (document.body) observeDom();
	else document.addEventListener("DOMContentLoaded", observeDom, { once: true });
}

void boot();
