// Popup: every setting and list one or two taps away. Writes settings to
// storage; content scripts react via storage.onChanged.

import {
	CALM_PRESET,
	DECLUTTER_KEY,
	DEFAULT_DECLUTTER,
	type DeclutterState,
	type Group,
	loadDeclutter,
	saveDeclutter,
	TOGGLES,
} from "../content/declutter";
import { ABOUT_BUCKET_PREFIX, clearAboutCache, readAboutCache } from "../content/store";
import { describeStatus, loadSyncStatus, XSYNC_KEY } from "../content/xsync";
import { BLOC_LABEL, type Bloc, resolvePlace } from "../core/country";
import { FEEDBACK_KEY, loadFeedback } from "../shared/feedback";
import { LISTS_CSS, mountListsUI } from "../shared/listsUI";
import {
	loadSettings,
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
$("sync-toggle").addEventListener("click", () => void save((s) => (s.syncWithX = !s.syncWithX)));
$("sync-now").addEventListener("click", async () => {
	$("sync-status").textContent = "Syncing with X…";
	try {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		const res = tab?.id ? await chrome.tabs.sendMessage(tab.id, { type: "syncNow" }) : null;
		$("sync-status").textContent = res?.status
			? describeStatus(res.status)
			: "Open x.com in this tab to sync.";
	} catch {
		$("sync-status").textContent = "Open x.com in this tab to sync.";
	}
});
async function renderSyncStatus(): Promise<void> {
	$("sync-status").textContent = settings.syncWithX
		? describeStatus(await loadSyncStatus())
		: "Local only.";
}

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

$("open-manager").addEventListener("click", async () => {
	try {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: "openManager" });
		window.close();
	} catch {
		$("manager-status").textContent = "Open x.com first, then try again.";
	}
});

// ── Layout tab ────────────────────────────────────────────────────────────

const GROUPS: Group[] = ["Feed", "Posts", "Sidebar", "Navigation"];

async function renderFocus(state?: DeclutterState): Promise<void> {
	const s = state ?? (await loadDeclutter());
	const host = $("focus-toggles");
	host.replaceChildren(
		...GROUPS.map((g) => {
			const section = el("section", {});
			section.append(el("h2", { className: "section-label", textContent: g }));
			const rows = TOGGLES.filter((t) => t.group === g).map((t) => {
				const id = `focus-${t.key}`;
				const sw = el("button", { type: "button", className: "switch" });
				sw.setAttribute("role", "switch");
				sw.setAttribute("aria-checked", String(s[t.key] === true));
				sw.setAttribute("aria-labelledby", id);
				sw.addEventListener("click", async () =>
					renderFocus(await saveDeclutter({ [t.key]: !(s[t.key] === true) })),
				);
				const copy = el(
					"div",
					{ className: "row-copy" },
					el("div", { className: "row-label", id, textContent: t.label }),
				);
				if (t.hint) copy.append(el("div", { className: "meta", textContent: t.hint }));
				return el("div", { className: "row" }, copy, sw);
			});
			section.append(el("div", { className: "toggles" }, ...rows));
			return section;
		}),
	);
	// Time
	const time = el("section", {});
	time.append(el("h2", { className: "section-label", textContent: "Time" }));
	const seg = el("div", { className: "seg" });
	seg.setAttribute("role", "group");
	seg.setAttribute("aria-label", "Daily time nudge");
	for (const m of [0, 15, 30, 60, 90]) {
		const b = el("button", { type: "button", textContent: m ? `${m}m` : "Off" });
		b.setAttribute("aria-pressed", String(s.dailyLimitMin === m));
		b.addEventListener("click", async () => renderFocus(await saveDeclutter({ dailyLimitMin: m })));
		seg.append(b);
	}
	time.append(
		el(
			"div",
			{ className: "field" },
			el(
				"div",
				{ className: "field-head" },
				el("span", { className: "row-label", textContent: "Daily time nudge" }),
				el("span", { className: "meta", textContent: "gentle stop per day" }),
			),
			seg,
		),
	);
	host.append(time);
	const on = TOGGLES.filter((t) => s[t.key] === true).length;
	$("calm-status").textContent = on ? `${on} distraction${on === 1 ? "" : "s"} hidden.` : "";
}
$("calm-enable").addEventListener("click", async () =>
	renderFocus(await saveDeclutter(CALM_PRESET())),
);
$("calm-disable").addEventListener("click", async () =>
	renderFocus(await saveDeclutter(DEFAULT_DECLUTTER())),
);

// ── Misc ──────────────────────────────────────────────────────────────────

$("onboarding-dismiss").addEventListener(
	"click",
	() => void save((s) => (s.onboardingDismissed = true)),
);
$("export-feedback").addEventListener("click", async () => {
	const fb = await loadFeedback();
	const blob = new Blob(
		[JSON.stringify({ exportedAt: new Date().toISOString(), feedback: fb }, null, 2)],
		{
			type: "application/json",
		},
	);
	const a = document.createElement("a");
	a.href = URL.createObjectURL(blob);
	a.download = "spam-filter-feedback.json";
	a.click();
	setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});

async function renderFeedbackCount(): Promise<void> {
	const n = Object.keys(await loadFeedback()).length;
	$("export-feedback").textContent = n ? `Export feedback (${n})` : "Export feedback";
}

$("clear-cache").addEventListener("click", async () => {
	await clearAboutCache();
	countryStats = {};
	renderQuickCountries();
});

function render(): void {
	setSwitch("enabled-toggle", settings.enabled);
	setSwitch("flags-toggle", settings.showFlags);
	setSwitch("sync-toggle", settings.syncWithX);
	void renderSyncStatus();
	$("onboarding").hidden = settings.onboardingDismissed;
	renderSegments();
	renderHomeBlocs();
	renderQuickCountries();
}

let statsTimer: ReturnType<typeof setTimeout> | null = null;

chrome.storage.onChanged.addListener((changes, area) => {
	if (area !== "local") return;
	if (changes[FEEDBACK_KEY]) void renderFeedbackCount();
	if (changes[XSYNC_KEY]) void renderSyncStatus();
	if (changes[DECLUTTER_KEY]) void renderFocus();
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
	void renderFeedbackCount();
	await renderFocus();
	const css = document.createElement("style");
	css.textContent = LISTS_CSS;
	document.head.append(css);
	await mountListsUI($("lists"));
}

void init();
