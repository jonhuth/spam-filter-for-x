// Everything we paint into X: inline flag/verdict chips, collapsed-post bars,
// the one-tap action menu, and the undo toast.

import type { Place } from "../core/country";
import type { Verdict } from "../core/score";
import { chipAnchor } from "./dom";

// Latest tap handler per chip host, so reused articles never act on stale data.
const tapHandlers = new WeakMap<HTMLElement, (anchor: HTMLElement) => void>();

const STYLE_ID = "sfx-styles";

const CSS = `
.sfx-chips{display:inline-flex!important;align-items:center;gap:2px;margin-left:4px;flex:0 0 auto!important;
  width:max-content!important;white-space:nowrap;vertical-align:middle;line-height:1}
.sfx-chip{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:18px;
  padding:0 3px;border-radius:999px;font:600 12px/1 TwitterChirp,-apple-system,system-ui,sans-serif;cursor:pointer;
  touch-action:manipulation;user-select:none;color:inherit}
.sfx-chip:focus-visible{outline:2px solid #1d9bf0;outline-offset:1px}
.sfx-flag{font-size:14px}
.sfx-flag[data-masked="1"]{opacity:.55}
.sfx-flag--text{font-size:10px;padding:0 6px;border:1px solid rgba(113,118,123,.35);color:#71767b;max-width:9em;overflow:hidden;text-overflow:ellipsis}
.sfx-flag--loading{width:14px;height:10px;background:rgba(113,118,123,.22);animation:sfx-pulse 1.2s ease-in-out infinite}
@keyframes sfx-pulse{50%{opacity:.4}}
.sfx-badge{font-size:10px;padding:0 6px;letter-spacing:.02em}
.sfx-badge[data-label="slop"]{background:rgba(255,173,31,.16);color:#c77c02}
.sfx-badge[data-label="farm"]{background:rgba(244,33,46,.14);color:#e0245e}
.sfx-badge[data-label="muted"]{background:rgba(113,118,123,.16);color:#71767b}
article[data-sfx-state="hide"]:not([data-sfx-reveal]){display:none!important}
article[data-sfx-state="fold"]:not([data-sfx-leader]){display:none!important}
article[data-sfx-state="fold"][data-sfx-leader]>*:not(.sfx-thread-bar){display:none!important}
.sfx-thread-bar{display:none;align-items:center;gap:8px;padding:10px 16px;color:#71767b;
  font:13px/1.3 TwitterChirp,-apple-system,system-ui,sans-serif}
article[data-sfx-state="fold"][data-sfx-leader]>.sfx-thread-bar{display:flex}
.sfx-thread-bar span{flex:1;min-width:0}
.sfx-thread-bar button{all:unset;cursor:pointer;color:#1d9bf0;font-weight:600;padding:4px 2px}
article[data-sfx-state="collapse"]:not([data-sfx-reveal])>*:not(.sfx-bar){display:none!important}
article[data-sfx-state="collapse"]:not([data-sfx-reveal])>.sfx-bar{display:flex}
.sfx-bar{display:none;align-items:center;gap:8px;padding:8px 16px;color:#71767b;
  font:13px/1.3 TwitterChirp,-apple-system,system-ui,sans-serif;cursor:default}
.sfx-bar span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sfx-bar button{all:unset;cursor:pointer;color:#1d9bf0;font-weight:600;padding:4px 2px}
`;

export function ensureStyles(): void {
	if (document.getElementById(STYLE_ID)) return;
	const style = document.createElement("style");
	style.id = STYLE_ID;
	style.textContent = CSS;
	(document.head ?? document.documentElement).appendChild(style);
}

export type ChipKind = "flag" | "badge";

export interface ChipModel {
	handle: string;
	place: Place | null;
	/** About lookup pending. */
	loading: boolean;
	masked: boolean;
	verdict: Verdict | null;
	muted: string | null;
	showFlag: boolean;
	showBadge: boolean;
}

export function renderChips(
	article: HTMLElement,
	model: ChipModel,
	onTap: (anchor: HTMLElement) => void,
): void {
	let host = article.querySelector<HTMLElement>(":scope .sfx-chips");
	if (!host) {
		const anchor = chipAnchor(article);
		if (!anchor) return;
		host = document.createElement("span");
		host.className = "sfx-chips";
		anchor.after(host);
	}
	tapHandlers.set(host, onTap);
	const sig = JSON.stringify([
		model.handle,
		model.place?.name,
		model.loading,
		model.masked,
		model.verdict?.label,
		model.muted,
		model.showFlag,
		model.showBadge,
	]);
	if (host.dataset.sig === sig) return;
	host.dataset.sig = sig;
	host.replaceChildren();

	const make = (cls: string, text: string, label: string) => {
		const b = document.createElement("button");
		b.type = "button";
		b.className = `sfx-chip ${cls}`;
		b.textContent = text;
		b.title = label;
		b.setAttribute("aria-label", label);
		b.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			const h = b.closest<HTMLElement>(".sfx-chips");
			if (h) tapHandlers.get(h)?.(b);
		});
		return b;
	};

	if (model.showFlag) {
		if (model.place) {
			const isText = model.place.emoji === "🌐";
			const label = `${model.place.name}${model.masked ? " (location may be inaccurate)" : ""} — options`;
			const flag = make(
				`sfx-flag${isText ? " sfx-flag--text" : ""}`,
				isText ? model.place.name : model.place.emoji,
				label,
			);
			if (model.masked) flag.dataset.masked = "1";
			host.append(flag);
		} else if (model.loading) {
			const s = document.createElement("span");
			s.className = "sfx-chip sfx-flag--loading";
			s.setAttribute("aria-hidden", "true");
			host.append(s);
		}
	}
	const label = model.muted ? "muted" : model.verdict?.label;
	if (model.showBadge && (label === "slop" || label === "farm" || label === "muted")) {
		const text = label === "farm" ? "Farm" : label === "slop" ? "Slop" : "Muted";
		const badge = make("sfx-badge", text, `${text} — why and options`);
		badge.dataset.label = label;
		host.append(badge);
	}
}

export type { Visibility } from "../core/decide";

import type { Visibility } from "../core/decide";

export function applyVisibility(
	article: HTMLElement,
	vis: Visibility,
	summary: string,
	onShow: () => void,
): void {
	if (vis !== "fold") delete article.dataset.sfxLeader;
	// "Show" reveals only the state it was tapped on; any change re-applies.
	if (article.dataset.sfxReveal && article.dataset.sfxReveal !== vis)
		delete article.dataset.sfxReveal;
	if (vis === "show") {
		delete article.dataset.sfxState;
		return;
	}
	article.dataset.sfxState = vis;
	if (vis !== "collapse") return;
	let bar = article.querySelector<HTMLElement>(":scope > .sfx-bar");
	if (!bar) {
		bar = document.createElement("div");
		bar.className = "sfx-bar";
		const text = document.createElement("span");
		const show = document.createElement("button");
		show.type = "button";
		show.textContent = "Show";
		show.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			article.dataset.sfxReveal = article.dataset.sfxState ?? "collapse";
			onShow();
		});
		bar.append(text, show);
		bar.addEventListener("click", (e) => e.stopPropagation());
		article.prepend(bar);
	}
	const span = bar.querySelector("span");
	if (span && span.textContent !== summary) span.textContent = summary;
}

/**
 * One bar for the whole thread: shown on the first folded reply currently in
 * the DOM (X virtualizes the list, so we can't add our own row).
 */
export function renderThreadBar(text: string | null, onShowAll: () => void): void {
	const folded = [...document.querySelectorAll<HTMLElement>('article[data-sfx-state="fold"]')];
	const leader = text ? folded[0] : undefined;
	for (const el of document.querySelectorAll<HTMLElement>("article[data-sfx-leader]"))
		if (el !== leader) delete el.dataset.sfxLeader;
	if (!leader || !text) return;
	leader.dataset.sfxLeader = "1";
	let bar = leader.querySelector<HTMLElement>(":scope > .sfx-thread-bar");
	if (!bar) {
		bar = document.createElement("div");
		bar.className = "sfx-thread-bar";
		const span = document.createElement("span");
		const show = document.createElement("button");
		show.type = "button";
		show.textContent = "Show all";
		bar.append(span, show);
		bar.addEventListener("click", (e) => e.stopPropagation());
		leader.prepend(bar);
	}
	const btn = bar.querySelector("button")!;
	btn.onclick = (e) => {
		e.preventDefault();
		e.stopPropagation();
		onShowAll();
	};
	const span = bar.querySelector("span")!;
	if (span.textContent !== text) span.textContent = text;
}

export function clearAll(): void {
	for (const el of document.querySelectorAll(".sfx-chips, .sfx-bar, .sfx-thread-bar")) el.remove();
	for (const el of document.querySelectorAll<HTMLElement>("[data-sfx-state]")) {
		delete el.dataset.sfxState;
		delete el.dataset.sfxReveal;
		delete el.dataset.sfxLeader;
	}
}
