// On-page manager modal for mutes / blocks / countries. Opens from the post
// menu, the popup, or ⌥M. Lives in its own shadow root.

import { LISTS_CSS, mountListsUI } from "../shared/listsUI";
import type { ListName } from "../shared/settings";

const CSS = `
:host{all:initial}
.scrim{position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.45);display:flex;align-items:flex-start;justify-content:center;padding:8vh 12px 12px;box-sizing:border-box}
.modal{width:min(440px,100%);max-height:84vh;display:flex;flex-direction:column;border-radius:18px;background:var(--lm-bg);
  box-shadow:0 12px 40px rgba(0,0,0,.35),0 0 0 1px var(--lm-line);overflow:hidden}
.head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px 8px;font:700 16px/1.2 -apple-system,system-ui,sans-serif;color:var(--lm-fg)}
.close{all:unset;cursor:pointer;width:32px;height:32px;border-radius:50%;text-align:center;line-height:32px;font-size:20px;color:var(--lm-muted)}
.close:hover{background:var(--lm-row)}
.body{padding:4px 16px 16px;overflow:auto;--lm-max:52vh}
.hint{color:var(--lm-muted);font:12px -apple-system,system-ui,sans-serif;padding:0 16px 12px}
${LISTS_CSS}
`;

function themeVars(): string {
	const m = getComputedStyle(document.body).backgroundColor.match(/\d+/g)?.map(Number);
	const dark =
		m && m.length >= 3
			? (m[0]! + m[1]! + m[2]!) / 3 < 128
			: matchMedia("(prefers-color-scheme: dark)").matches;
	return dark
		? "--lm-bg:#16181c;--lm-fg:#e7e9ea;--lm-muted:#8b98a5;--lm-line:#2f3336;--lm-row:#202327;--lm-accent:#1d9bf0"
		: "--lm-bg:#fff;--lm-fg:#0f1419;--lm-muted:#536471;--lm-line:#e1e8ed;--lm-row:#f7f9f9;--lm-accent:#1d9bf0";
}

let open: { host: HTMLElement; unmount: () => void } | null = null;

// Escape closes the manager wherever focus is (e.g. after a row was removed).
function onEscape(e: KeyboardEvent): void {
	if (e.key === "Escape" && open) {
		e.stopPropagation();
		closeManager();
	}
}

export function closeManager(): void {
	if (!open) return;
	open.unmount();
	open.host.remove();
	open = null;
	document.removeEventListener("keydown", onEscape, true);
}

export async function openManager(
	importFromX: () => Promise<{ words: string[]; muted: string[]; blocked: string[] } | null>,
	initialTab?: ListName,
): Promise<void> {
	closeManager();
	const host = document.createElement("sfx-manager");
	const root = host.attachShadow({ mode: "open" });
	const style = document.createElement("style");
	style.textContent = CSS;
	const scrim = document.createElement("div");
	scrim.className = "scrim";
	scrim.setAttribute("style", themeVars());
	const modal = document.createElement("div");
	modal.className = "modal";
	modal.setAttribute("role", "dialog");
	modal.setAttribute("aria-modal", "true");
	modal.setAttribute("aria-label", "Mutes and blocks");
	const head = document.createElement("div");
	head.className = "head";
	head.textContent = "Mutes & blocks";
	const close = document.createElement("button");
	close.className = "close";
	close.type = "button";
	close.textContent = "×";
	close.setAttribute("aria-label", "Close");
	close.addEventListener("click", closeManager);
	head.append(close);
	const body = document.createElement("div");
	body.className = "body";
	const hint = document.createElement("div");
	hint.className = "hint";
	hint.textContent = "Applies instantly on this device. ⌥M opens this anywhere on X.";
	modal.append(head, body, hint);
	scrim.append(modal);
	scrim.addEventListener("click", (e) => {
		if (e.target === scrim) closeManager();
	});
	scrim.addEventListener("keydown", (e) => {
		if (e.key === "Escape") closeManager();
		e.stopPropagation(); // keep X's keyboard shortcuts out while typing
	});
	root.append(style, scrim);
	document.documentElement.append(host);
	const unmount = await mountListsUI(body, { importFromX, initialTab });
	open = { host, unmount };
	document.addEventListener("keydown", onEscape, true);
	(root.querySelector("textarea") as HTMLTextAreaElement | null)?.focus();
}
