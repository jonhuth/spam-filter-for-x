// Mutes / blocks / countries manager. One component, two homes: the popup's
// Lists tab and the on-page modal (inside a shadow root). Everything is one
// tap: type or paste (commas/newlines) to add, × to remove, search to find.

import { resolvePlace } from "../core/country";
import {
	type ListName,
	loadSettings,
	normalizeEntry,
	SETTINGS_KEY,
	type Settings,
	sanitize,
	saveSettings,
	toggleEntry,
} from "./settings";

interface ListDef {
	name: ListName;
	tab: string;
	title: string;
	placeholder: string;
	empty: string;
}

export const LIST_DEFS: ListDef[] = [
	{
		name: "mutedWords",
		tab: "Words",
		title: "Muted words",
		placeholder: "word, phrase, emoji…",
		empty: "No muted words. Paste a list — commas or new lines.",
	},
	{
		name: "mutedAccounts",
		tab: "Muted",
		title: "Muted accounts",
		placeholder: "@handle",
		empty: "Tap a flag on any post → Mute.",
	},
	{
		name: "blockedAccounts",
		tab: "Blocked",
		title: "Blocked accounts",
		placeholder: "@handle",
		empty: "Tap a flag on any post → Block.",
	},
	{
		name: "hiddenCountries",
		tab: "Countries",
		title: "Hidden countries",
		placeholder: "India, Nigeria…",
		empty: "Tap a flag → Hide all from that country.",
	},
	{
		name: "watchCountries",
		tab: "Watched",
		title: "Watched countries (stricter scoring)",
		placeholder: "country",
		empty: "Watched countries score stricter but aren’t hidden.",
	},
	{
		name: "trustedAccounts",
		tab: "Trusted",
		title: "Always show",
		placeholder: "@handle",
		empty: "Accounts here are never filtered.",
	},
];

export const LISTS_CSS = `
.lm{display:flex;flex-direction:column;gap:10px;font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:var(--lm-fg)}
.lm-tabs{display:flex;gap:4px;overflow-x:auto;scrollbar-width:none;padding-bottom:2px}
.lm-tabs::-webkit-scrollbar{display:none}
.lm-tab{all:unset;cursor:pointer;padding:6px 10px;border-radius:999px;border:1px solid var(--lm-line);white-space:nowrap;font-weight:600;font-size:12px;color:var(--lm-muted)}
.lm-tab[aria-selected=true]{background:var(--lm-accent);border-color:var(--lm-accent);color:#fff}
.lm-tab .n{opacity:.75;font-weight:500;margin-left:4px}
.lm-add{display:flex;gap:6px}
.lm-add textarea{flex:1;min-width:0;resize:none;height:36px;padding:8px 10px;border-radius:10px;border:1px solid var(--lm-line);background:transparent;color:inherit;font:inherit;box-sizing:border-box}
.lm-add textarea:focus{outline:2px solid var(--lm-accent);outline-offset:-1px}
.lm-add textarea.multi{height:72px}
.lm-btn{all:unset;cursor:pointer;padding:8px 14px;border-radius:999px;background:var(--lm-accent);color:#fff;font-weight:650;white-space:nowrap;align-self:flex-start}
.lm-search{width:100%;box-sizing:border-box;padding:7px 10px;border-radius:10px;border:1px solid var(--lm-line);background:transparent;color:inherit;font:inherit}
.lm-list{display:flex;flex-direction:column;gap:4px;max-height:var(--lm-max,260px);overflow-y:auto}
.lm-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 6px 6px 10px;border-radius:9px;background:var(--lm-row)}
.lm-row span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lm-x{all:unset;cursor:pointer;width:26px;height:26px;border-radius:50%;text-align:center;line-height:26px;font-size:16px;color:var(--lm-muted)}
.lm-x:hover{color:#f4212e;background:rgba(244,33,46,.1)}
.lm-empty{color:var(--lm-muted);font-size:12px;padding:6px 2px}
.lm-foot{display:flex;flex-wrap:wrap;gap:10px;align-items:center;color:var(--lm-muted);font-size:12px}
.lm-link{all:unset;cursor:pointer;text-decoration:underline}
.lm-status{color:var(--lm-muted);font-size:12px;min-height:1em}
`;

export interface ListsUIOptions {
	/** Sync with X now; resolves to a human status line (null → couldn't). */
	syncNow?: () => Promise<string | null>;
	/** Current sync status line, shown under the list. */
	syncStatus?: () => Promise<string>;
	initialTab?: ListName;
}

function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	cls?: string,
	txt?: string,
): HTMLElementTagNameMap[K] {
	const n = document.createElement(tag);
	if (cls) n.className = cls;
	if (txt !== undefined) n.textContent = txt;
	return n;
}

function display(list: ListName, v: string): string {
	if (list === "hiddenCountries" || list === "watchCountries") {
		const p = resolvePlace(v);
		return p ? `${p.emoji} ${p.name}` : v;
	}
	return list === "mutedWords" ? v : `@${v}`;
}

/** Mount the manager into `host`. Re-renders on storage changes; returns an unmount. */
export async function mountListsUI(
	host: HTMLElement,
	opts: ListsUIOptions = {},
): Promise<() => void> {
	let settings: Settings = await loadSettings();
	let current: ListName = opts.initialTab ?? "mutedWords";
	let query = "";

	const root = el("div", "lm");
	const tabs = el("div", "lm-tabs");
	tabs.setAttribute("role", "tablist");
	const add = el("form", "lm-add");
	const input = el("textarea");
	input.rows = 1;
	const addBtn = el("button", "lm-btn", "Add");
	addBtn.type = "submit";
	add.append(input, addBtn);
	const search = el("input", "lm-search");
	search.type = "search";
	search.placeholder = "Search";
	const list = el("div", "lm-list");
	const status = el("div", "lm-status");
	status.setAttribute("aria-live", "polite");
	const foot = el("div", "lm-foot");
	root.append(tabs, add, search, list, status, foot);
	host.replaceChildren(root);

	const save = async (mutate: (s: Settings) => void) => {
		mutate(settings);
		settings = await saveSettings(settings);
		render();
	};

	const addEntries = async (raw: string) => {
		const values = raw
			.split(/[,\n]/)
			.map((v) => v.trim())
			.filter(Boolean);
		const valid = values.filter((v) => normalizeEntry(current, v));
		if (!valid.length) {
			status.textContent = values.length ? "Nothing valid to add." : "";
			return;
		}
		await save((s) => {
			for (const v of valid) toggleEntry(s, current, v, true);
		});
		input.value = "";
		input.classList.remove("multi");
		status.textContent = `Added ${valid.length}${values.length > valid.length ? ` (skipped ${values.length - valid.length} invalid)` : ""}.`;
		input.focus();
	};

	add.addEventListener("submit", (e) => {
		e.preventDefault();
		void addEntries(input.value);
	});
	input.addEventListener("keydown", (e) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			void addEntries(input.value);
		}
	});
	// Grow only for pasted multi-line lists — never on focus (a blur-shrink would
	// move the buttons below mid-tap).
	input.addEventListener("input", () =>
		input.classList.toggle("multi", input.value.includes("\n")),
	);
	search.addEventListener("input", () => {
		query = search.value.trim().toLowerCase();
		renderList();
	});

	function renderTabs(): void {
		tabs.replaceChildren(
			...LIST_DEFS.map((d) => {
				const b = el("button", "lm-tab", d.tab);
				b.type = "button";
				b.setAttribute("role", "tab");
				b.setAttribute("aria-selected", String(d.name === current));
				b.append(el("span", "n", String(settings.lists[d.name].length)));
				b.addEventListener("click", () => {
					current = d.name;
					query = "";
					search.value = "";
					status.textContent = "";
					render();
				});
				return b;
			}),
		);
	}

	function renderList(): void {
		const def = LIST_DEFS.find((d) => d.name === current)!;
		const values = settings.lists[current].filter(
			(v) => !query || display(current, v).toLowerCase().includes(query),
		);
		search.hidden = settings.lists[current].length < 8;
		if (!values.length) {
			list.replaceChildren(el("div", "lm-empty", query ? "No matches." : def.empty));
			return;
		}
		list.replaceChildren(
			...values.map((v) => {
				const row = el("div", "lm-row");
				const x = el("button", "lm-x", "×");
				x.type = "button";
				x.setAttribute("aria-label", `Remove ${display(current, v)}`);
				x.addEventListener("click", () => {
					void save((s) => toggleEntry(s, current, v, false)).then(() => {
						status.textContent = `Removed ${display(current, v)}.`;
					});
				});
				row.append(el("span", undefined, display(current, v)), x);
				return row;
			}),
		);
	}

	function renderFoot(): void {
		foot.replaceChildren();
		const def = LIST_DEFS.find((d) => d.name === current)!;
		const synced =
			current === "mutedWords" || current === "mutedAccounts" || current === "blockedAccounts";
		if (synced && settings.syncWithX && opts.syncStatus) {
			const line = el("span", undefined, "");
			void opts.syncStatus().then((t) => {
				line.textContent = `⇅ ${t}`;
			});
			foot.append(line);
		}
		if (synced && settings.syncWithX && opts.syncNow) {
			const now = el("button", "lm-link", "Sync now");
			now.type = "button";
			now.addEventListener("click", async () => {
				status.textContent = "Syncing with X…";
				const line = await opts.syncNow!().catch(() => null);
				// Success shows in the footer's sync line; only problems go in the status.
				status.textContent =
					line && !line.startsWith("Synced")
						? line
						: line
							? ""
							: "Couldn’t reach X. Open x.com and try again.";
				renderFoot();
			});
			foot.append(now);
		}
		if (synced && !settings.syncWithX)
			foot.append(el("span", undefined, "Local only — sync with X is off"));
		if (settings.lists[current].length) {
			const copy = el("button", "lm-link", "Copy list");
			copy.type = "button";
			copy.addEventListener("click", async () => {
				try {
					await navigator.clipboard.writeText(settings.lists[current].join("\n"));
					status.textContent = `Copied ${settings.lists[current].length} to clipboard.`;
				} catch {
					status.textContent = "Clipboard unavailable.";
				}
			});
			const clear = el("button", "lm-link", "Clear all");
			clear.type = "button";
			clear.addEventListener("click", () => {
				if (clear.dataset.armed) {
					void save((s) => {
						s.lists[current] = [];
					});
					status.textContent = `Cleared ${def.title.toLowerCase()}.`;
				} else {
					clear.dataset.armed = "1";
					clear.textContent = "Tap again to clear";
					setTimeout(() => {
						delete clear.dataset.armed;
						clear.textContent = "Clear all";
					}, 3000);
				}
			});
			foot.append(copy, clear);
		}
	}

	function render(): void {
		const def = LIST_DEFS.find((d) => d.name === current)!;
		input.placeholder = `Add ${def.placeholder}`;
		input.setAttribute("aria-label", `Add to ${def.title}`);
		renderTabs();
		renderList();
		renderFoot();
	}

	const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
		if (area !== "local" || !changes[SETTINGS_KEY]) return;
		const next = sanitize(changes[SETTINGS_KEY].newValue);
		// Our own save already rendered; re-rendering again would swap the
		// buttons out from under a tap.
		if (next.updatedAt === settings.updatedAt) return;
		settings = next;
		render();
	};
	chrome.storage.onChanged.addListener(onChange);
	render();
	return () => chrome.storage.onChanged.removeListener(onChange);
}
