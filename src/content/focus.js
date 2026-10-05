// @ts-nocheck — ported verbatim from v3; typed rewrite later.
// Focus / declutter — hide noisy X chrome, optional force Following
// Settings: chrome.storage.local focus_declutter
// Applied via CSS classes on <html> + light JS (tab labeling, force Following)

const FOCUS_KEY = "focus_declutter";

const DEFAULT_FOCUS = () => ({
	/** Hide the "For you" home tab */
	hideForYouTab: false,
	/** Auto-switch to Following on home / when For you is selected */
	forceFollowing: false,
	/** Hide Explore / News entry points in primary nav */
	hideNewsExplore: false,
	/** Hide "What's happening" / trends in right rail */
	hideTrends: false,
	/** Hide "Who to follow" modules */
	hideWhoToFollow: false,
	/** Hide promoted posts in the timeline */
	hidePromoted: false,
	/** Hide Grok entry in left nav */
	hideGrokNav: false,
	/** Hide Communities nav item */
	hideCommunitiesNav: false,
	/** Hide Premium / Super Follows upsells in rail & nav */
	hidePremiumUpsells: false,
	/** Hide Topics / Spaces promo modules when present */
	hideTopicsSpaces: false,
	updatedAt: 0,
});

let focusState = DEFAULT_FOCUS();
let forceFollowingTimer = null;
let tabLabelObserver = null;

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

async function loadFocusState() {
	const base = DEFAULT_FOCUS();
	try {
		const result = await chrome.storage.local.get(FOCUS_KEY);
		const data = result[FOCUS_KEY];
		if (!data || typeof data !== "object") {
			focusState = base;
			return focusState;
		}
		focusState = { ...base, ...data, updatedAt: Number(data.updatedAt) || 0 };
		return focusState;
	} catch {
		focusState = base;
		return focusState;
	}
}

async function saveFocusState(patch) {
	focusState = {
		...DEFAULT_FOCUS(),
		...focusState,
		...(patch || {}),
		updatedAt: Date.now(),
	};
	try {
		await chrome.storage.local.set({ [FOCUS_KEY]: focusState });
	} catch {
		/* Safari storage */
	}
	return focusState;
}

function getFocusState() {
	return focusState;
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

const STYLE_ID = "xat-focus-styles";

function buildFocusCss(s) {
	const rules = [];

	// Structural helpers labeled by JS
	if (s.hideForYouTab) {
		rules.push(`
html.xat-focus [data-xat-for-you="1"] {
  display: none !important;
}`);
	}

	if (s.hideNewsExplore) {
		rules.push(`
html.xat-focus a[href="/explore"],
html.xat-focus a[href^="/explore?"],
html.xat-focus a[href="/i/news"],
html.xat-focus a[href^="/i/news"],
html.xat-focus [data-xat-nav="explore"],
html.xat-focus [data-xat-nav="news"] {
  display: none !important;
}`);
	}

	if (s.hideTrends) {
		rules.push(`
html.xat-focus [aria-label="Timeline: Trending now"],
html.xat-focus [aria-label="Trending"],
html.xat-focus [data-testid="sidebarColumn"] section:has([href*="/i/trends"]),
html.xat-focus [data-testid="sidebarColumn"] div:has(> div > [href="/explore/tabs/for-you"]),
html.xat-focus [data-xat-module="trends"] {
  display: none !important;
}`);
	}

	if (s.hideWhoToFollow) {
		rules.push(`
html.xat-focus [aria-label="Who to follow"],
html.xat-focus [data-testid="UserCell"],
html.xat-focus aside [href="/i/connect_people"],
html.xat-focus [data-xat-module="who-to-follow"] {
  /* UserCell is broad — scope to sidebar modules only via labeled wrappers */
}
html.xat-focus [data-xat-module="who-to-follow"],
html.xat-focus [aria-label="Who to follow"] {
  display: none !important;
}
html.xat-focus [data-testid="sidebarColumn"] [href="/i/connect_people"] {
  display: none !important;
}
/* Collapse "Who to follow" section by heading text via labeled node */
html.xat-focus [data-xat-who-to-follow="1"] {
  display: none !important;
}`);
	}

	if (s.hidePromoted) {
		rules.push(`
html.xat-focus [data-testid="placementTracking"],
html.xat-focus article:has([data-testid="placementTracking"]),
html.xat-focus div[data-testid="cellInnerDiv"]:has([data-testid="placementTracking"]),
html.xat-focus [data-xat-promoted="1"] {
  display: none !important;
}`);
	}

	if (s.hideGrokNav) {
		rules.push(`
html.xat-focus a[href="/i/grok"],
html.xat-focus a[href^="/i/grok"],
html.xat-focus [data-xat-nav="grok"] {
  display: none !important;
}`);
	}

	if (s.hideCommunitiesNav) {
		rules.push(`
html.xat-focus a[href="/i/communities"],
html.xat-focus a[href^="/i/communities"],
html.xat-focus [data-xat-nav="communities"] {
  display: none !important;
}`);
	}

	if (s.hidePremiumUpsells) {
		rules.push(`
html.xat-focus a[href="/i/premium_sign_up"],
html.xat-focus a[href^="/i/premium"],
html.xat-focus a[href="/i/verified-get-verified"],
html.xat-focus [data-xat-module="premium"],
html.xat-focus [aria-label*="Premium" i][role="complementary"] {
  display: none !important;
}`);
	}

	if (s.hideTopicsSpaces) {
		rules.push(`
html.xat-focus a[href="/i/topics"],
html.xat-focus a[href^="/i/spaces"],
html.xat-focus [data-xat-module="spaces"],
html.xat-focus [data-xat-module="topics"] {
  display: none !important;
}`);
	}

	return rules.join("\n");
}

function injectFocusStyles() {
	let el = document.getElementById(STYLE_ID);
	if (!el) {
		el = document.createElement("style");
		el.id = STYLE_ID;
		(document.head || document.documentElement).appendChild(el);
	}
	el.textContent = buildFocusCss(focusState);
	document.documentElement.classList.add("xat-focus");
}

function removeFocusStyles() {
	document.getElementById(STYLE_ID)?.remove();
	document.documentElement.classList.remove("xat-focus");
}

// ---------------------------------------------------------------------------
// Label noisy nodes (X DOM drifts; labels keep CSS stable)
// ---------------------------------------------------------------------------

function labelHomeTabs() {
	document.querySelectorAll('[role="tab"]').forEach((tab) => {
		const t = String(tab.textContent || "")
			.trim()
			.toLowerCase()
			.replace(/\s+/g, " ");
		if (t === "for you" || t.startsWith("for you")) {
			tab.setAttribute("data-xat-for-you", "1");
			tab.removeAttribute("data-xat-following");
		} else if (t === "following" || t.startsWith("following")) {
			tab.setAttribute("data-xat-following", "1");
			tab.removeAttribute("data-xat-for-you");
		}
	});
}

function labelNavItems() {
	document.querySelectorAll('nav a[href], header a[href]').forEach((a) => {
		const href = a.getAttribute("href") || "";
		const label = String(a.getAttribute("aria-label") || a.textContent || "")
			.trim()
			.toLowerCase();
		if (href.startsWith("/explore") || label.includes("explore")) {
			a.setAttribute("data-xat-nav", "explore");
		} else if (href.includes("/i/news") || label === "news" || label.includes("news")) {
			a.setAttribute("data-xat-nav", "news");
		} else if (href.includes("/i/grok") || label.includes("grok")) {
			a.setAttribute("data-xat-nav", "grok");
		} else if (href.includes("/i/communities") || label.includes("communities")) {
			a.setAttribute("data-xat-nav", "communities");
		}
	});
}

function labelSidebarModules() {
	// Trends / What's happening
	document
		.querySelectorAll('[aria-label="Timeline: Trending now"], [aria-label="Trending"]')
		.forEach((n) => n.setAttribute("data-xat-module", "trends"));

	// Who to follow — walk sections in sidebar
	const side = document.querySelector('[data-testid="sidebarColumn"]');
	if (side) {
		side.querySelectorAll("section, div").forEach((block) => {
			const text = String(block.textContent || "").slice(0, 80).toLowerCase();
			if (
				text.includes("who to follow") ||
				text.includes("suggested for you") ||
				text.includes("you might like")
			) {
				// Prefer a reasonably sized container
				const target =
					block.closest("section") ||
					block.closest('[data-testid="sidebarColumn"] > div > div') ||
					block;
				if (target && target !== side) {
					target.setAttribute("data-xat-who-to-follow", "1");
					target.setAttribute("data-xat-module", "who-to-follow");
				}
			}
			if (text.includes("what's happening") || text.includes("trending")) {
				const target = block.closest("section") || block;
				if (target && target !== side) target.setAttribute("data-xat-module", "trends");
			}
			if (text.includes("premium") || text.includes("get verified")) {
				const target = block.closest("section") || block;
				if (target && target !== side) target.setAttribute("data-xat-module", "premium");
			}
		});
	}

	// Promoted cells
	document.querySelectorAll('[data-testid="placementTracking"]').forEach((n) => {
		const cell =
			n.closest('[data-testid="cellInnerDiv"]') ||
			n.closest("article") ||
			n;
		cell.setAttribute("data-xat-promoted", "1");
	});
}

function labelAll() {
	try {
		labelHomeTabs();
		labelNavItems();
		labelSidebarModules();
	} catch {
		/* ignore */
	}
}

// ---------------------------------------------------------------------------
// Force Following
// ---------------------------------------------------------------------------

function clickFollowingTab() {
	labelHomeTabs();
	const following =
		document.querySelector('[data-xat-following="1"]') ||
		[...document.querySelectorAll('[role="tab"]')].find((tab) => {
			const t = String(tab.textContent || "")
				.trim()
				.toLowerCase();
			return t === "following" || t.startsWith("following");
		});
	if (!following) return false;
	if (following.getAttribute("aria-selected") === "true") return true;
	try {
		following.click();
		return true;
	} catch {
		return false;
	}
}

function isOnHome() {
	const path = location.pathname || "";
	return path === "/home" || path === "/" || path === "/home/";
}

function scheduleForceFollowing() {
	if (!focusState.forceFollowing) return;
	if (forceFollowingTimer) clearTimeout(forceFollowingTimer);
	// Retry a few times — tabs hydrate async
	let tries = 0;
	const tick = () => {
		tries++;
		labelHomeTabs();
		if (!isOnHome()) return;
		const forYou = document.querySelector('[data-xat-for-you="1"][aria-selected="true"]');
		const need =
			Boolean(forYou) ||
			![...document.querySelectorAll('[role="tab"]')].some(
				(t) =>
					t.getAttribute("aria-selected") === "true" &&
					String(t.textContent || "")
						.toLowerCase()
						.includes("following"),
			);
		if (need) clickFollowingTab();
		if (tries < 8) {
			forceFollowingTimer = setTimeout(tick, 400 + tries * 200);
		}
	};
	forceFollowingTimer = setTimeout(tick, 300);
}

// ---------------------------------------------------------------------------
// Apply / lifecycle
// ---------------------------------------------------------------------------

function anyFocusEnabled(s = focusState) {
	return Boolean(
		s.hideForYouTab ||
			s.forceFollowing ||
			s.hideNewsExplore ||
			s.hideTrends ||
			s.hideWhoToFollow ||
			s.hidePromoted ||
			s.hideGrokNav ||
			s.hideCommunitiesNav ||
			s.hidePremiumUpsells ||
			s.hideTopicsSpaces,
	);
}

function applyFocusMode() {
	if (!anyFocusEnabled()) {
		removeFocusStyles();
		return;
	}
	injectFocusStyles();
	labelAll();
	if (focusState.forceFollowing) scheduleForceFollowing();
}

function startFocusObservers() {
	if (tabLabelObserver) return;
	let t = null;
	tabLabelObserver = new MutationObserver(() => {
		if (t) return;
		t = setTimeout(() => {
			t = null;
			if (!anyFocusEnabled()) return;
			labelAll();
			if (focusState.forceFollowing && isOnHome()) {
				const forYou = document.querySelector(
					'[data-xat-for-you="1"][aria-selected="true"]',
				);
				if (forYou) clickFollowingTab();
			}
		}, 200);
	});
	tabLabelObserver.observe(document.documentElement, {
		childList: true,
		subtree: true,
	});

	// SPA navigations
	let last = location.href;
	setInterval(() => {
		if (location.href !== last) {
			last = location.href;
			if (anyFocusEnabled()) {
				labelAll();
				if (focusState.forceFollowing) scheduleForceFollowing();
			}
		}
	}, 500);
}

async function initFocusMode() {
	await loadFocusState();
	applyFocusMode();
	if (anyFocusEnabled()) startFocusObservers();

	try {
		chrome.storage.onChanged.addListener((changes, area) => {
			if (area !== "local" || !changes[FOCUS_KEY]) return;
			const next = changes[FOCUS_KEY].newValue;
			focusState = { ...DEFAULT_FOCUS(), ...(next || {}) };
			applyFocusMode();
			if (anyFocusEnabled()) startFocusObservers();
		});
	} catch {
		/* ignore */
	}
}

export const FocusMode = {
	FOCUS_KEY,
	DEFAULT_FOCUS,
	loadFocusState,
	saveFocusState,
	getFocusState,
	applyFocusMode,
	initFocusMode,
	anyFocusEnabled,
};

