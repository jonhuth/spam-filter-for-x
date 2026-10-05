// Popup: every setting and list one or two taps away. Writes settings to
// storage; content scripts react via storage.onChanged.

import { FocusMode } from "../content/focus.js";
import { ABOUT_BUCKET_PREFIX, clearAboutCache, readAboutCache } from "../content/store";
import { BLOC_LABEL, type Bloc, resolvePlace } from "../core/country";
import {
	type ListName,
	loadSettings,
	normalizeEntry,
	SETTINGS_KEY,
	type Settings,
	sanitize,
	saveSettings,
	toggleEntry,
} from "../shared/settings";

let settings: Settings;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	props: Partial<HTMLElementTagNameMap[K]> & { dataset?: Record<string, string> } = {},
	...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	const { dataset, ...rest } = props;
	Object.assign(node, rest);
	if (dataset) Object.assign(node.dataset, dataset);
	node.append(...children);
	return node;
}

async function save(mutate: (s: Settings) => void): Promise<void> {
	mutate(settings);
	settings = await saveSettings(settings);
	render();
}

// ── Tabs ──────────────────────────────────────────────────────────────────

const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
function activate(tab: HTMLButtonElement): void {
	for (const t of tabs) {
		const on = t === tab;
		t.setAttribute("aria-selected", String(on));
		t.tabIndex = on ? 0 : -1;
		const panel = $(`tab-${t.dataset.tab}`);
		panel.hidden = !on;
		panel.classList.toggle("active", on);
	}
	try {
		localStorage.setItem("sfx-tab", tab.dataset.tab ?? "");
	} catch {
		/* ignore */
	}
}
for (const tab of tabs) {
	tab.addEventListener("click", () => activate(tab));
	tab.addEventListener("keydown", (e) => {
		const i = tabs.indexOf(tab);
		const next =
			e.key === "ArrowRight"
				? (i + 1) % tabs.length
				: e.key === "ArrowLeft"
					? (i - 1 + tabs.length) % tabs.length
					: -1;
		if (next < 0) return;
		e.preventDefault();
		tabs[next]!.focus();
		activate(tabs[next]!);
	});
}

// ── Filter tab ────────────────────────────────────────────────────────────

function setSwitch(id: string, on: boolean): void {
	$(id).setAttribute("aria-checked", String(on));
}

$("enabled-toggle").addEventListener("click", () => void save((s) => (s.enabled = !s.enabled)));
$("flags-toggle").addEventListener("click", () => void save((s) => (s.showFlags = !s.showFlags)));
$("mirror-toggle").addEventListener("click", () => void save((s) => (s.mirrorToX = !s.mirrorToX)));

for (const group of document.querySelectorAll<HTMLElement>(".seg[data-setting]")) {
	const key = group.dataset.setting as "farmAction" | "slopAction" | "sensitivity";
	for (const b of group.querySelectorAll<HTMLButtonElement>("button")) {
		b.addEventListener(
			"click",
			() => void save((s) => Object.assign(s, { [key]: b.dataset.value })),
		);
	}
}

function renderSegments(): void {
	for (const group of document.querySelectorAll<HTMLElement>(".seg[data-setting]")) {
		const value = settings[group.dataset.setting as "farmAction"];
		for (const b of group.querySelectorAll<HTMLButtonElement>("button"))
			b.setAttribute("aria-pressed", String(b.dataset.value === value));
	}
}

function renderHomeBlocs(): void {
	const host = $("home-blocs");
	host.replaceChildren(
		...(Object.keys(BLOC_LABEL) as Bloc[]).map((bloc) => {
			const on = settings.homeBlocs.includes(bloc);
			const chip = el("button", {
				type: "button",
				className: "chip",
				textContent: BLOC_LABEL[bloc],
			});
			chip.setAttribute("aria-pressed", String(on));
			chip.addEventListener(
				"click",
				() =>
					void save((s) => {
						s.homeBlocs = on ? s.homeBlocs.filter((b) => b !== bloc) : [...s.homeBlocs, bloc];
					}),
			);
			return chip;
		}),
	);
}

/** Country label → accounts located, computed from the local About cache. */
let countryStats: Record<string, number> = {};
async function loadCountryStats(): Promise<void> {
	countryStats = {};
	try {
		for (const about of (await readAboutCache()).values())
			if (about.basedIn) countryStats[about.basedIn] = (countryStats[about.basedIn] ?? 0) + 1;
	} catch {
		/* storage unavailable */
	}
}

function renderQuickCountries(): void {
	const hidden = new Set(settings.lists.hiddenCountries.map((c) => c.toLowerCase()));
	const totals = new Map<string, { label: string; n: number }>();
	for (const [raw, n] of Object.entries(countryStats)) {
		const p = resolvePlace(raw);
		if (!p || hidden.has(p.name.toLowerCase())) continue;
		const prev = totals.get(p.name);
		totals.set(p.name, { label: `${p.emoji} ${p.name}`, n: (prev?.n ?? 0) + n });
	}
	const top = [...totals.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 12);
	$("quick-section").hidden = top.length === 0;
	$("quick-countries").replaceChildren(
		...top.map(([name, { label, n }]) => {
			const chip = el("button", {
				type: "button",
				className: "chip",
				textContent: `${label} · ${n}`,
			});
			chip.setAttribute("aria-label", `Hide posts from ${name}`);
			chip.addEventListener(
				"click",
				() => void save((s) => toggleEntry(s, "hiddenCountries", name, true)),
			);
			return chip;
		}),
	);
	const total = Object.values(countryStats).reduce((a, b) => a + b, 0);
	$("footer-stats").textContent = total ? `${total.toLocaleString()} accounts located` : "";
}

// ── Lists tab ─────────────────────────────────────────────────────────────

const LISTS: {
	name: ListName;
	title: string;
	placeholder: string;
	render: (v: string) => string;
}[] = [
	{ name: "mutedWords", title: "Muted words", placeholder: "word or phrase", render: (v) => v },
	{
		name: "mutedAccounts",
		title: "Muted accounts",
		placeholder: "@handle",
		render: (v) => `@${v}`,
	},
	{
		name: "blockedAccounts",
		title: "Blocked accounts",
		placeholder: "@handle",
		render: (v) => `@${v}`,
	},
	{
		name: "hiddenCountries",
		title: "Hidden countries",
		placeholder: "India, Nigeria…",
		render: placeLabel,
	},
	{
		name: "watchCountries",
		title: "Watched countries (stricter scoring)",
		placeholder: "country",
		render: placeLabel,
	},
	{ name: "trustedAccounts", title: "Always show", placeholder: "@handle", render: (v) => `@${v}` },
];

function placeLabel(v: string): string {
	const p = resolvePlace(v);
	return p ? `${p.emoji} ${p.name}` : v;
}

const openGroups = new Set<ListName>(["mutedWords"]);

function renderLists(): void {
	const host = $("lists");
	host.replaceChildren(
		...LISTS.map((def) => {
			const values = settings.lists[def.name];
			const group = el("details", { className: "list-group", open: openGroups.has(def.name) });
			group.addEventListener("toggle", () => {
				if (group.open) openGroups.add(def.name);
				else openGroups.delete(def.name);
			});
			const summary = el(
				"summary",
				{},
				el("span", { textContent: def.title }),
				el("span", { className: "count", textContent: String(values.length) }),
			);
			const input = el("input", {
				className: "input",
				placeholder: def.placeholder,
				autocomplete: "off",
			});
			input.setAttribute("aria-label", `Add to ${def.title}`);
			const form = el(
				"form",
				{ className: "input-row" },
				input,
				el("button", { className: "btn", type: "submit", textContent: "Add" }),
			);
			form.addEventListener("submit", (e) => {
				e.preventDefault();
				const entries = input.value
					.split(/[,\n]/)
					.map((v) => normalizeEntry(def.name, v))
					.filter(Boolean);
				if (!entries.length) return;
				void save((s) => {
					for (const v of entries) toggleEntry(s, def.name, v, true);
				}).then(() =>
					$("lists").querySelector<HTMLInputElement>(`[aria-label="Add to ${def.title}"]`)?.focus(),
				);
			});
			const rows = values.map((v) => {
				const remove = el("button", { className: "icon-btn", type: "button", textContent: "×" });
				remove.setAttribute("aria-label", `Remove ${v}`);
				remove.addEventListener(
					"click",
					() => void save((s) => toggleEntry(s, def.name, v, false)),
				);
				return el(
					"div",
					{ className: "list-row" },
					el("span", { textContent: def.render(v) }),
					remove,
				);
			});
			group.append(summary, el("div", { className: "body" }, form, ...rows));
			return group;
		}),
	);
}

// ── Layout tab ────────────────────────────────────────────────────────────

const FOCUS_ROWS: [string, string][] = [
	["hideForYouTab", "Hide For you"],
	["forceFollowing", "Always Following"],
	["hideNewsExplore", "Hide Explore"],
	["hideTrends", "Hide Trends"],
	["hideWhoToFollow", "Hide Who to follow"],
	["hidePromoted", "Hide ads"],
	["hideGrokNav", "Hide Grok"],
	["hideCommunitiesNav", "Hide Communities"],
	["hidePremiumUpsells", "Hide Premium upsells"],
	["hideTopicsSpaces", "Hide Topics / Spaces"],
];

const CALM = {
	hideForYouTab: true,
	forceFollowing: true,
	hideNewsExplore: true,
	hideTrends: true,
	hideWhoToFollow: true,
	hidePromoted: true,
	hidePremiumUpsells: true,
	hideTopicsSpaces: true,
};

async function renderFocus(state?: Record<string, unknown>): Promise<void> {
	const s: Record<string, unknown> = state ?? (await FocusMode.loadFocusState());
	$("focus-toggles").replaceChildren(
		...FOCUS_ROWS.map(([key, label]) => {
			const id = `focus-${key}`;
			const sw = el("button", { type: "button", className: "switch" });
			sw.setAttribute("role", "switch");
			sw.setAttribute("aria-checked", String(Boolean(s[key])));
			sw.setAttribute("aria-labelledby", id);
			sw.addEventListener("click", async () =>
				renderFocus(await FocusMode.saveFocusState({ [key]: !s[key] })),
			);
			return el(
				"div",
				{ className: "row" },
				el("span", { className: "row-label", id, textContent: label }),
				sw,
			);
		}),
	);
	$("calm-status").textContent = FocusMode.anyFocusEnabled(
		s as ReturnType<typeof FocusMode.DEFAULT_FOCUS>,
	)
		? "Calm home is on."
		: "";
}
$("calm-enable").addEventListener("click", async () =>
	renderFocus(await FocusMode.saveFocusState(CALM)),
);
$("calm-disable").addEventListener("click", async () =>
	renderFocus(await FocusMode.saveFocusState(FocusMode.DEFAULT_FOCUS())),
);

// ── Misc ──────────────────────────────────────────────────────────────────

$("onboarding-dismiss").addEventListener(
	"click",
	() => void save((s) => (s.onboardingDismissed = true)),
);
$("clear-cache").addEventListener("click", async () => {
	await clearAboutCache();
	countryStats = {};
	renderQuickCountries();
});

function render(): void {
	setSwitch("enabled-toggle", settings.enabled);
	setSwitch("flags-toggle", settings.showFlags);
	setSwitch("mirror-toggle", settings.mirrorToX);
	$("onboarding").hidden = settings.onboardingDismissed;
	renderSegments();
	renderHomeBlocs();
	renderQuickCountries();
	renderLists();
}

let statsTimer: ReturnType<typeof setTimeout> | null = null;

chrome.storage.onChanged.addListener((changes, area) => {
	if (area !== "local") return;
	if (changes[SETTINGS_KEY]) {
		settings = sanitize(changes[SETTINGS_KEY].newValue);
		render();
	}
	// Cache writes only refresh the quick-hide chips, never the list inputs.
	if (Object.keys(changes).some((k) => k.startsWith(ABOUT_BUCKET_PREFIX)) && !statsTimer) {
		statsTimer = setTimeout(async () => {
			statsTimer = null;
			await loadCountryStats();
			renderQuickCountries();
		}, 500);
	}
});

async function init(): Promise<void> {
	settings = await loadSettings();
	await loadCountryStats();
	try {
		const saved = localStorage.getItem("sfx-tab");
		const tab = tabs.find((t) => t.dataset.tab === saved);
		if (tab) activate(tab);
	} catch {
		/* ignore */
	}
	render();
	await renderFocus();
}

void init();
