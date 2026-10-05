// One typed settings object in chrome.storage.local, shared by content + popup.
// Migrates v3 keys (extension_enabled, hidden_countries, bot_detection_enabled).

import type { Bloc } from "../core/country";
import { resolvePlace } from "../core/country";
import type { Sensitivity } from "../core/score";

export const SETTINGS_KEY = "settings_v4";

/** What to do with a post at a given label. */
export type Action = "off" | "label" | "collapse" | "hide";

export interface Lists {
	mutedWords: string[];
	mutedAccounts: string[];
	blockedAccounts: string[];
	trustedAccounts: string[];
	hiddenCountries: string[];
	watchCountries: string[];
}

export type ListName = keyof Lists;

export interface Settings {
	enabled: boolean;
	showFlags: boolean;
	farmAction: Action;
	slopAction: Action;
	sensitivity: Sensitivity;
	/** Repliers from these blocs never count as off-region. */
	homeBlocs: Bloc[];
	/** Also apply mute/block on X itself when used from the post menu. */
	mirrorToX: boolean;
	lists: Lists;
	onboardingDismissed: boolean;
	updatedAt: number;
}

export const DEFAULT_SETTINGS = (): Settings => ({
	enabled: true,
	showFlags: true,
	farmAction: "hide",
	slopAction: "collapse",
	sensitivity: "balanced",
	homeBlocs: [],
	mirrorToX: false,
	lists: {
		mutedWords: [],
		mutedAccounts: [],
		blockedAccounts: [],
		trustedAccounts: [],
		hiddenCountries: [],
		watchCountries: [],
	},
	onboardingDismissed: false,
	updatedAt: 0,
});

const LIST_NAMES: ListName[] = [
	"mutedWords",
	"mutedAccounts",
	"blockedAccounts",
	"trustedAccounts",
	"hiddenCountries",
	"watchCountries",
];

/** Normalize one list entry; returns "" when invalid. */
export function normalizeEntry(list: ListName, raw: string): string {
	const v = String(raw ?? "").trim();
	if (!v) return "";
	switch (list) {
		case "mutedAccounts":
		case "blockedAccounts":
		case "trustedAccounts": {
			const handle = v.replace(/^@/, "").toLowerCase();
			return /^\w{1,20}$/.test(handle) ? handle : "";
		}
		case "hiddenCountries":
		case "watchCountries":
			return resolvePlace(v)?.name ?? "";
		case "mutedWords":
			return v.toLowerCase().slice(0, 80);
	}
}

function cleanList(list: ListName, values: unknown): string[] {
	const seen = new Set<string>();
	for (const v of Array.isArray(values) ? values : []) {
		const entry = normalizeEntry(list, String(v));
		if (entry) seen.add(entry);
	}
	return [...seen].sort((a, b) => a.localeCompare(b));
}

export function sanitize(raw: unknown): Settings {
	const base = DEFAULT_SETTINGS();
	if (!raw || typeof raw !== "object") return base;
	const r = raw as Partial<Settings>;
	const actions: Action[] = ["off", "label", "collapse", "hide"];
	const lists = (r.lists ?? {}) as Partial<Lists>;
	return {
		...base,
		enabled: r.enabled ?? base.enabled,
		showFlags: r.showFlags ?? base.showFlags,
		farmAction: actions.includes(r.farmAction as Action)
			? (r.farmAction as Action)
			: base.farmAction,
		slopAction: actions.includes(r.slopAction as Action)
			? (r.slopAction as Action)
			: base.slopAction,
		sensitivity: (["relaxed", "balanced", "strict"] as const).includes(r.sensitivity as Sensitivity)
			? (r.sensitivity as Sensitivity)
			: base.sensitivity,
		homeBlocs: Array.isArray(r.homeBlocs) ? r.homeBlocs : base.homeBlocs,
		mirrorToX: r.mirrorToX ?? base.mirrorToX,
		lists: Object.fromEntries(
			LIST_NAMES.map((n) => [n, cleanList(n, lists[n])]),
		) as unknown as Lists,
		onboardingDismissed: r.onboardingDismissed ?? base.onboardingDismissed,
		updatedAt: Number(r.updatedAt) || 0,
	};
}

/** Build v4 settings from v3 storage keys (flags, country hide, mute/block lists, trust). */
export function migrateV3(old: Record<string, unknown>): Settings {
	const s = DEFAULT_SETTINGS();
	if (typeof old.extension_enabled === "boolean") s.showFlags = old.extension_enabled;
	if (old.bot_detection_enabled === false || old.hide_bots_enabled === false)
		s.farmAction = "label";
	const sens = Number(old.bot_sensitivity);
	if (sens >= 1 && sens <= 5)
		s.sensitivity = sens <= 2 ? "relaxed" : sens >= 4 ? "strict" : "balanced";
	const hidden = (old.hidden_countries as { countries?: unknown } | undefined)?.countries;
	s.lists.hiddenCountries = cleanList("hiddenCountries", hidden);

	const mb = (old.mute_block_lists ?? {}) as {
		muteWords?: { term?: unknown }[];
		muteAccounts?: { username?: unknown }[];
		blockAccounts?: { username?: unknown }[];
	};
	const pick = <T>(arr: T[] | undefined, f: (x: T) => unknown) =>
		(Array.isArray(arr) ? arr : []).map((x) => String(f(x) ?? ""));
	s.lists.mutedWords = cleanList(
		"mutedWords",
		pick(mb.muteWords, (w) => w?.term),
	);
	s.lists.mutedAccounts = cleanList(
		"mutedAccounts",
		pick(mb.muteAccounts, (a) => a?.username),
	);
	s.lists.blockedAccounts = cleanList(
		"blockedAccounts",
		pick(mb.blockAccounts, (a) => a?.username),
	);

	const overrides = (old.bot_overrides ?? {}) as Record<string, { forceHuman?: boolean }>;
	const humanMarks = Object.entries(overrides)
		.filter(([, v]) => v?.forceHuman)
		.map(([k]) => k);
	const whitelist = Array.isArray(old.bot_whitelist)
		? (old.bot_whitelist as unknown[]).map(String)
		: [];
	const taken = new Set([...s.lists.mutedAccounts, ...s.lists.blockedAccounts]);
	s.lists.trustedAccounts = cleanList("trustedAccounts", [...whitelist, ...humanMarks]).filter(
		(h) => !taken.has(h),
	);
	if (old.onboarding_dismissed === true) s.onboardingDismissed = true;
	return s;
}

const V3_KEYS = [
	"extension_enabled",
	"bot_detection_enabled",
	"hide_bots_enabled",
	"bot_sensitivity",
	"hidden_countries",
	"mute_block_lists",
	"bot_whitelist",
	"bot_overrides",
	"onboarding_dismissed",
];

function extensionAlive(): boolean {
	try {
		return Boolean(chrome.runtime?.id);
	} catch {
		return false;
	}
}

export async function loadSettings(): Promise<Settings> {
	if (!extensionAlive()) return DEFAULT_SETTINGS();
	try {
		const got = await chrome.storage.local.get([SETTINGS_KEY, ...V3_KEYS]);
		if (got[SETTINGS_KEY]) return sanitize(got[SETTINGS_KEY]);
		const migrated = migrateV3(got);
		await chrome.storage.local.set({ [SETTINGS_KEY]: migrated });
		return migrated;
	} catch {
		return DEFAULT_SETTINGS();
	}
}

export async function saveSettings(next: Settings): Promise<Settings> {
	const clean = sanitize({ ...next, updatedAt: Date.now() });
	if (!extensionAlive()) return clean;
	try {
		await chrome.storage.local.set({ [SETTINGS_KEY]: clean });
	} catch {
		/* Safari storage can throw in invalidated contexts */
	}
	return clean;
}

export async function updateSettings(fn: (s: Settings) => void): Promise<Settings> {
	const s = await loadSettings();
	fn(s);
	return saveSettings(s);
}

export function hasEntry(s: Settings, list: ListName, raw: string): boolean {
	const e = normalizeEntry(list, raw);
	return Boolean(e) && s.lists[list].includes(e);
}

export function toggleEntry(s: Settings, list: ListName, raw: string, on?: boolean): void {
	const e = normalizeEntry(list, raw);
	if (!e) return;
	const has = s.lists[list].includes(e);
	const want = on ?? !has;
	if (want && !has) s.lists[list] = [...s.lists[list], e].sort((a, b) => a.localeCompare(b));
	if (!want && has) s.lists[list] = s.lists[list].filter((x) => x !== e);
	// An account can only be in one of trusted / muted / blocked.
	if (
		want &&
		(list === "trustedAccounts" || list === "mutedAccounts" || list === "blockedAccounts")
	) {
		for (const other of ["trustedAccounts", "mutedAccounts", "blockedAccounts"] as const) {
			if (other !== list) s.lists[other] = s.lists[other].filter((x) => x !== e);
		}
	}
}

/** Muted word match: whole-word for plain words, substring for phrases/emoji. */
export function matchesMutedWord(text: string, words: string[]): string | null {
	const lower = text.toLowerCase();
	for (const w of words) {
		// Scripts without word spaces (CJK, Thai) can only match as substrings.
		const spaceless =
			/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Hangul}]/u.test(
				w,
			);
		if (!spaceless && /^[\p{L}\p{N}_]+$/u.test(w)) {
			if (new RegExp(`(^|[^\\p{L}\\p{N}_])${w}($|[^\\p{L}\\p{N}_])`, "u").test(lower)) return w;
		} else if (lower.includes(w)) return w;
	}
	return null;
}
