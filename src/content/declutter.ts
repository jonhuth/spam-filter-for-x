// Declutter: every distracting or low-value part of X as a named toggle.
//
// One stylesheet holds all rules, each gated by a class on <html>
// (`sfx-t-<key>`), so flipping a toggle is a class change. X's markup is
// unlabeled in places, so a small labeler tags nodes by href / heading text
// (`data-sfx-*`) and the CSS targets those tags. All selectors live here.

export const DECLUTTER_KEY = "focus_declutter"; // v3 key; values migrate as-is

export type Group = "Feed" | "Posts" | "Sidebar" | "Navigation" | "Time";

export interface Toggle {
	key: string;
	label: string;
	group: Group;
	hint?: string;
	/** Part of the Calm preset. */
	calm?: boolean;
	css?: string;
}

const H = (key: string, sel: string) =>
	`${sel
		.split(",")
		.map((s) => `html.sfx-t-${key} ${s.trim()}`)
		.join(",\n")}{display:none!important}`;

export const TOGGLES: Toggle[] = [
	// Feed
	{
		key: "hideForYouTab",
		label: "Hide For you",
		group: "Feed",
		calm: true,
		css: H("hideForYouTab", '[data-sfx-tab="for-you"]'),
	},
	{ key: "forceFollowing", label: "Always open Following", group: "Feed", calm: true },
	{
		key: "hidePromoted",
		label: "Hide ads",
		group: "Feed",
		calm: true,
		css: H(
			"hidePromoted",
			'[data-sfx-promoted], [data-testid="cellInnerDiv"]:has([data-testid="placementTracking"])',
		),
	},
	{
		key: "hideWhoToFollow",
		label: "Hide Who to follow",
		group: "Feed",
		calm: true,
		css: H("hideWhoToFollow", "[data-sfx-wtf]"),
	},
	{
		key: "hideReposts",
		label: "Hide reposts",
		group: "Feed",
		hint: "Only original posts",
		css: H("hideReposts", "[data-sfx-repost]"),
	},
	{
		key: "hideDiscoverMore",
		label: "Hide “Discover more” under threads",
		group: "Feed",
		calm: true,
		css: H("hideDiscoverMore", "[data-sfx-discover]"),
	},
	{
		key: "pauseAutoplay",
		label: "Stop video autoplay",
		group: "Feed",
		calm: true,
		hint: "Videos play when you tap",
	},
	{
		key: "hideTopicsSpaces",
		label: "Hide Topics / Spaces / Live",
		group: "Feed",
		calm: true,
		css: H(
			"hideTopicsSpaces",
			'[data-sfx-module="live"], a[href="/i/topics"], a[href^="/i/spaces"]',
		),
	},

	// Posts
	{
		key: "hideMetrics",
		label: "Hide like / repost / view counts",
		group: "Posts",
		hint: "Read posts, not scores",
		css: `html.sfx-t-hideMetrics article [role="group"] [data-testid="app-text-transition-container"]{visibility:hidden!important}
${H("hideMetrics", 'article a[href$="/analytics"], article a[href$="/likes"], article a[href$="/retweets"], article a[href$="/quotes"]')}`,
	},
	{
		key: "hideGrokOnPosts",
		label: "Hide Grok buttons on posts",
		group: "Posts",
		calm: true,
		css: H("hideGrokOnPosts", 'article button[aria-label*="Grok" i], article [data-sfx-grok]'),
	},
	{
		key: "hideSubscribe",
		label: "Hide Subscribe buttons",
		group: "Posts",
		calm: true,
		css: H("hideSubscribe", "[data-sfx-subscribe]"),
	},

	// Sidebar
	{
		key: "hideSidebar",
		label: "Hide the whole right sidebar",
		group: "Sidebar",
		hint: "Keeps search",
		css: H("hideSidebar", "[data-sfx-side]"),
	},
	{
		key: "hideTrends",
		label: "Hide What’s happening / News",
		group: "Sidebar",
		calm: true,
		css: H("hideTrends", '[data-sfx-module="trends"], [data-sfx-module="news"]'),
	},
	{
		key: "hideSidebarFollow",
		label: "Hide You might like",
		group: "Sidebar",
		calm: true,
		css: H("hideSidebarFollow", '[data-sfx-module="wtf"]'),
	},
	{
		key: "hideSidebarOther",
		label: "Hide sports, Premium, footer",
		group: "Sidebar",
		calm: true,
		css: H(
			"hideSidebarOther",
			'[data-sfx-module="other"], [data-sfx-module="premium"], [data-testid="sidebarColumn"] nav[aria-label="Footer"]',
		),
	},

	// Navigation
	{
		key: "hideNewsExplore",
		label: "Hide Explore",
		group: "Navigation",
		calm: true,
		css: H("hideNewsExplore", '[data-sfx-nav="explore"]'),
	},
	{
		key: "hideGrokNav",
		label: "Hide Grok (nav + floating button)",
		group: "Navigation",
		calm: true,
		css: H("hideGrokNav", '[data-sfx-nav="grok"], [data-sfx-floating="grok"]'),
	},
	{
		key: "hideChatFloat",
		label: "Hide floating Chat bubble",
		group: "Navigation",
		calm: true,
		css: H("hideChatFloat", '[data-sfx-floating="chat"]'),
	},
	{
		key: "hidePremiumUpsells",
		label: "Hide Premium / Verified / Business",
		group: "Navigation",
		calm: true,
		css: H("hidePremiumUpsells", '[data-sfx-nav="premium"]'),
	},
	{
		key: "hideCommunitiesNav",
		label: "Hide Follow, Calls, Communities, Jobs…",
		group: "Navigation",
		css: H("hideCommunitiesNav", '[data-sfx-nav="extra"]'),
	},
	{
		key: "hideBadges",
		label: "Hide notification counts",
		group: "Navigation",
		hint: "No red dots pulling you in",
		css: H("hideBadges", '[data-sfx-badge], nav [aria-label*="unread" i]:not(a)'),
	},

	// Time
	{
		key: "dailyLimit",
		label: "Daily time nudge",
		group: "Time",
		hint: "A gentle stop after N minutes a day",
	},
];

export type DeclutterState = Record<string, boolean | number> & {
	dailyLimitMin: number;
	updatedAt: number;
};

export const DEFAULT_DECLUTTER = (): DeclutterState => ({
	...Object.fromEntries(TOGGLES.map((t) => [t.key, false])),
	dailyLimitMin: 0,
	updatedAt: 0,
});

export const CALM_PRESET = (): Partial<DeclutterState> =>
	Object.fromEntries(TOGGLES.filter((t) => t.calm).map((t) => [t.key, true]));

export function sanitizeDeclutter(raw: unknown): DeclutterState {
	const base = DEFAULT_DECLUTTER();
	if (!raw || typeof raw !== "object") return base;
	const r = raw as Record<string, unknown>;
	for (const t of TOGGLES) if (typeof r[t.key] === "boolean") base[t.key] = r[t.key] as boolean;
	// v3 "hideWhoToFollow" covered both feed and sidebar.
	if (r.hideWhoToFollow === true && r.hideSidebarFollow === undefined)
		base.hideSidebarFollow = true;
	const limit = Number(r.dailyLimitMin);
	base.dailyLimitMin = [0, 15, 30, 45, 60, 90, 120].includes(limit) ? limit : 0;
	base.dailyLimit = base.dailyLimitMin > 0;
	base.updatedAt = Number(r.updatedAt) || 0;
	return base;
}

export async function loadDeclutter(): Promise<DeclutterState> {
	try {
		return sanitizeDeclutter((await chrome.storage.local.get(DECLUTTER_KEY))[DECLUTTER_KEY]);
	} catch {
		return DEFAULT_DECLUTTER();
	}
}

export async function saveDeclutter(patch: Partial<DeclutterState>): Promise<DeclutterState> {
	const next = sanitizeDeclutter({ ...(await loadDeclutter()), ...patch, updatedAt: Date.now() });
	try {
		await chrome.storage.local.set({ [DECLUTTER_KEY]: next });
	} catch {
		/* storage unavailable */
	}
	return next;
}

export function anyEnabled(s: DeclutterState): boolean {
	return TOGGLES.some((t) => s[t.key] === true) || s.dailyLimitMin > 0;
}

// ── Labeling ────────────────────────────────────────────────────────────

const NAV_BY_TEXT: Record<string, string> = {
	explore: "explore",
	grok: "grok",
	premium: "premium",
	"verified orgs": "premium",
	business: "premium",
	monetization: "premium",
	"creator studio": "premium",
	follow: "extra",
	calls: "extra",
	communities: "extra",
	jobs: "extra",
	lists: "extra",
	articles: "extra",
	spaces: "extra",
};

const NAV_BY_HREF: [RegExp, string][] = [
	[/^\/explore/, "explore"],
	[/^\/i\/grok/, "grok"],
	[/^\/i\/(premium|verified|monetization|business)/, "premium"],
	[/^\/i\/(communities|connect_people|calls|jobs|spaces)|^\/jobs|\/communities$|\/lists$/, "extra"],
];

function text(el: Element | null | undefined): string {
	return String(el?.textContent ?? "")
		.trim()
		.toLowerCase()
		.replace(/\s+/g, " ");
}

function labelTabs(): void {
	for (const tab of document.querySelectorAll<HTMLElement>('[role="tab"]')) {
		const t = text(tab);
		if (t.startsWith("for you")) tab.dataset.sfxTab = "for-you";
		else if (t.startsWith("following")) tab.dataset.sfxTab = "following";
	}
}

function labelNav(): void {
	const nav =
		document.querySelector('header nav, nav[aria-label="Primary"]') ??
		document.querySelector("header");
	if (!nav) return;
	for (const a of nav.querySelectorAll<HTMLAnchorElement>("a[href]")) {
		const href = a.getAttribute("href") ?? "";
		const label = text(a) || String(a.getAttribute("aria-label") ?? "").toLowerCase();
		const kind = NAV_BY_TEXT[label] ?? NAV_BY_HREF.find(([re]) => re.test(href))?.[1];
		if (kind) a.dataset.sfxNav = kind;
		// Unread count bubble inside nav links
		for (const b of a.querySelectorAll<HTMLElement>('[aria-label*="unread" i]'))
			b.dataset.sfxBadge = "1";
	}
}

/** Sidebar modules (direct children of the module list), classified by heading. */
function labelSidebar(): void {
	const side = document.querySelector('[data-testid="sidebarColumn"]');
	if (!side) return;
	const blocks = [
		...side.querySelectorAll<HTMLElement>("section, aside, nav[aria-label='Footer']"),
	];
	if (!blocks.length) return;
	// The module list is the nearest ancestor holding 2+ modules (or the only one's parent).
	let list: HTMLElement | null = blocks[0]!.parentElement;
	while (
		list &&
		list !== side &&
		blocks.filter((b) => list!.contains(b)).length < Math.min(2, blocks.length)
	)
		list = list.parentElement;
	if (!list) return;
	const search = side.querySelector('[data-testid="SearchBox_Search_Input"], form[role="search"]');
	for (const child of list.children as HTMLCollectionOf<HTMLElement>) {
		if (search && child.contains(search)) continue;
		if (!child.textContent?.trim()) continue;
		child.dataset.sfxSide = "1";
		const head = text(child.querySelector("h2, [role='heading']")) || text(child).slice(0, 40);
		child.dataset.sfxModule = /who to follow|you might like|relevant people|suggested/.test(head)
			? "wtf"
			: /what.s happening|trending|trends for you/.test(head)
				? "trends"
				: /news|today.s/.test(head)
					? "news"
					: /premium|subscribe|verified/.test(head)
						? "premium"
						: /live on x|spaces/.test(head)
							? "live"
							: "other";
		for (const item of child.querySelectorAll<HTMLElement>('[data-testid="trend"]'))
			if (text(item).includes("promoted by")) item.dataset.sfxPromoted = "1";
	}
}

/** X virtualizes lists: cells are absolutely placed with translateY. */
function cellY(cell: HTMLElement): number {
	const m =
		cell.parentElement?.style.transform.match(/translateY\((-?[\d.]+)px\)/) ??
		cell.style.transform.match(/translateY\((-?[\d.]+)px\)/);
	return m ? Number(m[1]) : Number.NaN;
}
/** Per page: where X's "Discover more" tail starts, so recycled cells below it stay marked. */
const discoverStart = new Map<string, number>();

/** Feed cells: promoted, who-to-follow runs, reposts, "Discover more" tails. */
function labelCells(): void {
	const cells = [...document.querySelectorAll<HTMLElement>('[data-testid="cellInnerDiv"]')];
	const path = location.pathname;
	// Where X's "Discover more" tail starts. Follow the heading's *current*
	// position (more replies can load above it); remember it only for when the
	// heading itself has been recycled out of the DOM.
	const heading = cells.find((c) =>
		/^(discover more|more posts|posts you might like)/.test(
			text(c.querySelector("h2, [role='heading']")),
		),
	);
	if (heading) {
		const y = cellY(heading);
		if (!Number.isNaN(y)) discoverStart.set(path, y);
	}
	const start = discoverStart.get(path);
	let inWtf = false;
	const mark = (cell: HTMLElement, key: string, on: boolean) => {
		if (on) cell.dataset[key] = "1";
		else delete cell.dataset[key];
	};
	for (const cell of cells) {
		const h = text(cell.querySelector("h2, [role='heading']"));
		const hasArticle = Boolean(cell.querySelector("article"));
		if (/^(who to follow|you might like)/.test(h)) inWtf = true;
		else if (hasArticle) inWtf = false;
		mark(cell, "sfxWtf", inWtf);
		const y = cellY(cell);
		mark(
			cell,
			"sfxDiscover",
			cell === heading || (start !== undefined && !Number.isNaN(y) && y >= start),
		);
		mark(cell, "sfxPromoted", Boolean(cell.querySelector('[data-testid="placementTracking"]')));
		mark(
			cell,
			"sfxRepost",
			/reposted|retweeted/.test(text(cell.querySelector('[data-testid="socialContext"]'))),
		);
	}
}

/** Fixed-position Grok / Chat bubbles in the bottom corner. */
function labelFloating(): void {
	const drawers = document.querySelectorAll<HTMLElement>(
		'[data-testid="GrokDrawer"], [data-testid="DMDrawer"], [data-testid^="chat-drawer"], [aria-label*="Grok" i], [aria-label*="Chat" i], [aria-label*="Messages" i]',
	);
	for (const el of drawers) {
		if (el.closest("header, nav, article, [data-testid='primaryColumn']")) continue;
		let node: HTMLElement | null = el;
		while (node && node !== document.body && getComputedStyle(node).position !== "fixed")
			node = node.parentElement;
		if (!node || node === document.body) continue;
		const kind = /grok/i.test(`${el.getAttribute("aria-label")} ${el.dataset.testid ?? ""}`)
			? "grok"
			: "chat";
		node.dataset.sfxFloating = kind;
	}
}

function labelButtons(): void {
	for (const b of document.querySelectorAll<HTMLElement>(
		'button, a[role="link"], [role="button"]',
	)) {
		const t = text(b);
		if (t === "subscribe" || t === "subscribed") b.dataset.sfxSubscribe = "1";
	}
}

export function labelAll(): void {
	try {
		labelTabs();
		labelNav();
		labelSidebar();
		labelCells();
		labelFloating();
		labelButtons();
	} catch {
		/* never break X */
	}
}

// ── Apply ────────────────────────────────────────────────────────────────

const STYLE_ID = "sfx-declutter";

export function applyDeclutter(s: DeclutterState): void {
	let style = document.getElementById(STYLE_ID);
	if (!style) {
		style = document.createElement("style");
		style.id = STYLE_ID;
		style.textContent = TOGGLES.map((t) => t.css ?? "").join("\n");
		(document.head ?? document.documentElement).appendChild(style);
	}
	const root = document.documentElement;
	for (const t of TOGGLES) root.classList.toggle(`sfx-t-${t.key}`, s[t.key] === true);
}

export function clickFollowing(): boolean {
	labelTabs();
	const tab = document.querySelector<HTMLElement>('[data-sfx-tab="following"]');
	if (!tab) return false;
	if (tab.getAttribute("aria-selected") !== "true") tab.click();
	return true;
}

export const isHome = (path = location.pathname) => path === "/home" || path === "/";
