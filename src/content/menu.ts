// One-tap action menu (opened from any flag/badge) and an undo toast.
// Rendered in a shadow root so X's CSS can't leak in or out.

import type { Place } from "../core/country";
import type { Verdict } from "../core/score";

export interface MenuModel {
	handle: string;
	place: Place | null;
	masked: boolean;
	verdict: Verdict | null;
	mutedBy: string | null;
	isMuted: boolean;
	isBlocked: boolean;
	isTrusted: boolean;
	isCountryHidden: boolean;
	isCountryWatched: boolean;
	mirrorToX: boolean;
	selectedText: string;
}

export type MenuAction =
	| { type: "mute" | "block" | "trust"; on: boolean }
	| { type: "hideCountry" | "watchCountry"; on: boolean }
	| { type: "muteWord"; word: string }
	| { type: "mirrorToX"; on: boolean };

const CSS = `
:host{all:initial}
.scrim{position:fixed;inset:0;z-index:2147483646}
.menu{position:fixed;z-index:2147483647;width:min(300px,calc(100vw - 24px));max-height:min(70vh,520px);overflow:auto;
  box-sizing:border-box;padding:6px;border-radius:14px;background:var(--bg);color:var(--fg);
  box-shadow:0 8px 28px rgba(0,0,0,.28),0 0 0 1px var(--line);font:14px/1.35 -apple-system,system-ui,sans-serif}
.head{padding:8px 10px 6px}
.title{font-weight:700}
.sub{color:var(--muted);font-size:12px;margin-top:2px}
.why{margin:4px 10px 6px;padding:0;list-style:none;font-size:12px;color:var(--muted)}
.why li{display:flex;justify-content:space-between;gap:8px;padding:1px 0}
.why b{font-weight:600;color:var(--fg)}
.sep{height:1px;background:var(--line);margin:4px 2px}
button.item{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;min-height:40px;
  padding:8px 10px;border-radius:10px;cursor:pointer}
button.item:hover,button.item:focus-visible{background:var(--hover)}
.ico{width:20px;text-align:center}
.on{margin-left:auto;color:#1d9bf0;font-weight:700}
.word{display:flex;gap:6px;padding:6px 10px}
.word input{flex:1;min-width:0;padding:7px 9px;border-radius:9px;border:1px solid var(--line);background:transparent;color:inherit;font:inherit}
.word button{all:unset;padding:7px 12px;border-radius:999px;background:#1d9bf0;color:#fff;font-weight:650;cursor:pointer}
.mirror{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;font-size:12px;color:var(--muted)}
.switch{all:unset;width:34px;height:20px;border-radius:10px;background:var(--line);position:relative;cursor:pointer}
.switch[aria-checked=true]{background:#1d9bf0}
.switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s}
.switch[aria-checked=true]::after{transform:translateX(14px)}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;display:flex;gap:14px;align-items:center;
  padding:10px 16px;border-radius:999px;background:#1d9bf0;color:#fff;font:600 14px/1 -apple-system,system-ui,sans-serif;
  box-shadow:0 6px 20px rgba(0,0,0,.25);max-width:calc(100vw - 32px)}
.toast button{all:unset;cursor:pointer;text-decoration:underline}
`;

function themeVars(): string {
	const bg = getComputedStyle(document.body).backgroundColor;
	const dark = (() => {
		const m = bg.match(/\d+/g)?.map(Number);
		return m && m.length >= 3
			? (m[0]! + m[1]! + m[2]!) / 3 < 128
			: matchMedia("(prefers-color-scheme: dark)").matches;
	})();
	return dark
		? `--bg:#16181c;--fg:#e7e9ea;--muted:#8b98a5;--line:#2f3336;--hover:rgba(231,233,234,.08)`
		: `--bg:#fff;--fg:#0f1419;--muted:#536471;--line:#eff3f4;--hover:rgba(15,20,25,.06)`;
}

let host: HTMLElement | null = null;
let root: ShadowRoot | null = null;

function shadow(): ShadowRoot {
	if (root && host?.isConnected) return root;
	host = document.createElement("sfx-overlay");
	root = host.attachShadow({ mode: "open" });
	const style = document.createElement("style");
	style.textContent = CSS;
	root.append(style);
	document.documentElement.append(host);
	return root;
}

export function closeMenu(): void {
	root?.querySelectorAll(".scrim, .menu").forEach((n) => {
		n.remove();
	});
}

export function openMenu(anchor: HTMLElement, m: MenuModel, act: (a: MenuAction) => void): void {
	closeMenu();
	const r = shadow();
	const scrim = document.createElement("div");
	scrim.className = "scrim";
	scrim.addEventListener("click", closeMenu);
	const menu = document.createElement("div");
	menu.className = "menu";
	menu.setAttribute("role", "menu");
	menu.setAttribute("style", themeVars());
	menu.addEventListener("keydown", (e) => {
		if (e.key === "Escape") closeMenu();
		if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
		e.preventDefault();
		const items = [...menu.querySelectorAll<HTMLElement>("button.item")];
		const i = items.indexOf(r.activeElement as HTMLElement);
		const next =
			e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
		items[next]?.focus();
	});

	const head = document.createElement("div");
	head.className = "head";
	const title = document.createElement("div");
	title.className = "title";
	title.textContent = `@${m.handle}`;
	const sub = document.createElement("div");
	sub.className = "sub";
	const parts: string[] = [];
	if (m.place)
		parts.push(`${m.place.emoji} ${m.place.name}${m.masked ? " · may be inaccurate" : ""}`);
	if (m.mutedBy) parts.push(`Muted: “${m.mutedBy}”`);
	else if (m.verdict && m.verdict.label !== "ok")
		parts.push(
			`${m.verdict.label === "trusted" ? "Trusted" : m.verdict.label === "farm" ? "Farm" : "Slop"} · score ${m.verdict.score}`,
		);
	sub.textContent = parts.join(" · ") || "No signals";
	head.append(title, sub);
	menu.append(head);

	const reasons = (m.verdict?.signals ?? []).filter((s) => s.weight !== 0).slice(0, 5);
	if (reasons.length) {
		const why = document.createElement("ul");
		why.className = "why";
		for (const s of reasons) {
			const li = document.createElement("li");
			const t = document.createElement("span");
			t.textContent = s.reason;
			const w = document.createElement("b");
			w.textContent = `${s.weight > 0 ? "+" : ""}${s.weight}`;
			li.append(t, w);
			why.append(li);
		}
		menu.append(why);
	}
	const sep = () => {
		const d = document.createElement("div");
		d.className = "sep";
		return d;
	};
	menu.append(sep());

	const item = (icon: string, label: string, on: boolean, run: () => void) => {
		const b = document.createElement("button");
		b.className = "item";
		b.setAttribute("role", "menuitem");
		const i = document.createElement("span");
		i.className = "ico";
		i.textContent = icon;
		const l = document.createElement("span");
		l.textContent = label;
		b.append(i, l);
		if (on) {
			const c = document.createElement("span");
			c.className = "on";
			c.textContent = "✓";
			b.append(c);
		}
		b.addEventListener("click", () => {
			closeMenu();
			run();
		});
		menu.append(b);
		return b;
	};

	item("🔇", m.isMuted ? `Unmute @${m.handle}` : `Mute @${m.handle}`, m.isMuted, () =>
		act({ type: "mute", on: !m.isMuted }),
	);
	item("⛔", m.isBlocked ? `Unblock @${m.handle}` : `Block @${m.handle}`, m.isBlocked, () =>
		act({ type: "block", on: !m.isBlocked }),
	);
	item("✅", m.isTrusted ? "Stop trusting" : "Always show (trust)", m.isTrusted, () =>
		act({ type: "trust", on: !m.isTrusted }),
	);
	if (m.place) {
		item(
			m.place.emoji,
			m.isCountryHidden ? `Show ${m.place.name}` : `Hide all from ${m.place.name}`,
			m.isCountryHidden,
			() => act({ type: "hideCountry", on: !m.isCountryHidden }),
		);
		item(
			"👀",
			m.isCountryWatched ? `Unwatch ${m.place.name}` : `Watch ${m.place.name} (score stricter)`,
			m.isCountryWatched,
			() => act({ type: "watchCountry", on: !m.isCountryWatched }),
		);
	}

	const word = document.createElement("form");
	word.className = "word";
	const input = document.createElement("input");
	input.placeholder = "Mute a word or phrase";
	input.value = m.selectedText.slice(0, 60);
	input.setAttribute("aria-label", "Word or phrase to mute");
	const add = document.createElement("button");
	add.type = "submit";
	add.textContent = "Mute";
	word.append(input, add);
	word.addEventListener("submit", (e) => {
		e.preventDefault();
		const w = input.value.trim();
		if (!w) return;
		closeMenu();
		act({ type: "muteWord", word: w });
	});
	menu.append(sep(), word);

	const mirror = document.createElement("div");
	mirror.className = "mirror";
	const ml = document.createElement("span");
	ml.textContent = "Also mute/block on X";
	const sw = document.createElement("button");
	sw.className = "switch";
	sw.setAttribute("role", "switch");
	sw.setAttribute("aria-checked", String(m.mirrorToX));
	sw.setAttribute("aria-label", "Also mute or block on X");
	sw.addEventListener("click", () => {
		const next = sw.getAttribute("aria-checked") !== "true";
		sw.setAttribute("aria-checked", String(next));
		act({ type: "mirrorToX", on: next });
	});
	mirror.append(ml, sw);
	menu.append(mirror);

	r.append(scrim, menu);
	const rect = anchor.getBoundingClientRect();
	const w = menu.offsetWidth;
	const h = menu.offsetHeight;
	const left = Math.min(Math.max(12, rect.left), window.innerWidth - w - 12);
	const below = rect.bottom + 6;
	const top = below + h > window.innerHeight - 12 ? Math.max(12, rect.top - h - 6) : below;
	menu.style.left = `${left}px`;
	menu.style.top = `${top}px`;
	(menu.querySelector("button.item") as HTMLElement | null)?.focus();
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function toast(text: string, undo?: () => void): void {
	const r = shadow();
	r.querySelector(".toast")?.remove();
	if (toastTimer) clearTimeout(toastTimer);
	const t = document.createElement("div");
	t.className = "toast";
	t.setAttribute("role", "status");
	const s = document.createElement("span");
	s.textContent = text;
	t.append(s);
	if (undo) {
		const b = document.createElement("button");
		b.textContent = "Undo";
		b.addEventListener("click", () => {
			t.remove();
			undo();
		});
		t.append(b);
	}
	r.append(t);
	toastTimer = setTimeout(() => t.remove(), 5000);
}
