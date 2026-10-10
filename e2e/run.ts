// End-to-end: load dist/ into Chromium, serve a mock x.com, assert behavior,
// and save desktop + mobile screenshots to e2e/out/.
// Usage: bun run build && bun e2e/run.ts

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { aboutAccount, page as mockPage, ROOT_ID, tweetDetail, users } from "./mockx";

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");
const out = join(import.meta.dir, "out");
mkdirSync(out, { recursive: true });

const failures: string[] = [];
const check = (ok: boolean, msg: string) => {
	console.log(`${ok ? "✓" : "✗"} ${msg}`);
	if (!ok) failures.push(msg);
};

const ctx = await chromium.launchPersistentContext("", {
	channel: "chromium",
	headless: true,
	viewport: { width: 1280, height: 1000 },
	args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});

const aboutHits: Record<string, number> = {};
await ctx.route("https://x.com/**", async (route) => {
	const url = new URL(route.request().url());
	if (url.pathname.endsWith("/TweetDetail")) return route.fulfill({ json: tweetDetail() });
	if (url.pathname.endsWith("/AboutAccountQuery")) {
		const vars = JSON.parse(url.searchParams.get("variables") ?? "{}");
		aboutHits[vars.screenName] = (aboutHits[vars.screenName] ?? 0) + 1;
		return route.fulfill({
			json: aboutAccount(vars.screenName),
			headers: {
				"x-rate-limit-remaining": "150",
				"x-rate-limit-reset": String(Math.floor(Date.now() / 1000) + 900),
			},
		});
	}
	if (url.pathname === "/i/api/1.1/mutes/keywords/list.json")
		return route.fulfill({ json: { muted_keywords: [{ keyword: "crypto giveaway" }, { keyword: "gm" }] } });
	if (url.pathname === "/i/api/1.1/mutes/users/list.json")
		return route.fulfill({ json: { users: [{ screen_name: "Spam_Lord" }], next_cursor_str: "0" } });
	if (url.pathname === "/i/api/1.1/blocks/list.json")
		return route.fulfill({ json: { users: [{ screen_name: "scammer1" }, { screen_name: "scammer2" }], next_cursor_str: "0" } });
	if (url.pathname.startsWith("/i/api/")) return route.fulfill({ status: 200, json: {} });
	return route.fulfill({ contentType: "text/html", body: mockPage() });
});

const sw = ctx.serviceWorkers()[0];
const extId = await (async () => {
	// MV3 without a background worker: read the id from chrome://extensions internals.
	const p = await ctx.newPage();
	await p.goto("chrome://extensions");
	const id = await p.evaluate(async () => {
		const all = await chrome.management.getAll();
		return all.find((e: { name: string }) => e.name === "Spam Filter for X")?.id as string | undefined;
	});
	await p.close();
	return id ?? sw?.url().split("/")[2];
})();
check(Boolean(extId), `extension loaded (${extId})`);

const tab = await ctx.newPage();
const errors: string[] = [];
tab.on("pageerror", (e) => errors.push(String(e)));

await tab.goto(`https://x.com/senate_watch/status/${ROOT_ID}`);
const art = (handle: string) => tab.locator(`article:has(a[href="/${handle}"])`).first();
const state = (handle: string) => art(handle).getAttribute("data-sfx-state");

const totalHits = () => Object.values(aboutHits).reduce((x, y) => x + y, 0);
const barText = () => tab.locator(".sfx-thread-bar span").first().textContent();

// Wait until visible accounts are located and the thread bar has every country.
await tab.waitForFunction(
	() => {
		const shown = [...document.querySelectorAll("article")].filter(
			(a) => !(a as HTMLElement).dataset.sfxState,
		);
		const bar = document.querySelector(".sfx-thread-bar span")?.textContent ?? "";
		return (
			shown.length >= 3 &&
			shown.every((a) => a.querySelector(".sfx-flag:not(.sfx-flag--loading)")) &&
			bar.includes("5 low-quality") &&
			!bar.includes("❔")
		);
	},
	null,
	{ timeout: 90_000 },
);
await tab.waitForTimeout(300);

const flagText = async (handle: string) => (await art(handle).locator(".sfx-flag").textContent())?.trim();
check((await flagText("senate_watch")) === "🇺🇸", "focal post shows 🇺🇸 flag");
check((await flagText("policy_nerd")) === "🇩🇪", "German reply shows 🇩🇪");
for (const h of ["senate_watch", "policy_nerd", "my_friend"]) {
	const [name, flag, handle] = await Promise.all([
		art(h).locator('[data-testid="User-Name"] a[href^="/"] span').first().boundingBox(),
		art(h).locator(".sfx-flag").boundingBox(),
		art(h).locator(`a:text-is("@${h}")`).boundingBox(),
	]);
	const inline =
		name && flag && handle &&
		Math.abs(flag.y + flag.height / 2 - (name.y + name.height / 2)) < 6 &&
		flag.x > name.x + name.width && flag.x + flag.width <= handle.x;
	check(Boolean(inline), `@${h} flag sits inline between name and @handle`);
}

// Thread cleanup: every low-quality reply folds into ONE bar with country counts.
for (const h of [users.farm1!, users.farm2!, users.farm3!, users.slop!, users.vpn!].map((u) => u.handle))
	check((await state(h)) === "fold", `@${h} folded into the thread bar`);
check((await tab.locator("article[data-sfx-leader]").count()) === 1, "exactly one thread summary bar");
check((await tab.locator(".sfx-bar:visible").count()) === 0, "no per-post collapsed bars in a thread");
const bar = await barText();
check(Boolean(bar?.includes("5 low-quality replies hidden") && bar.includes("🇳🇬 1") && bar.includes("🇮🇳 1")), `thread bar: “${bar}”`);
check((await state("policy_nerd")) === null, "substantive off-region human reply shown");
check((await state("my_friend")) === null, "followed account shown despite generic text");
check((await state("senate_watch")) === null, "focal post shown");
await tab.screenshot({ path: join(out, "thread-desktop.png"), fullPage: true });

// Cache: a second tab on the same thread re-uses every lookup — zero new requests.
await tab.waitForTimeout(2_500); // cache save debounce
const hitsBefore = totalHits();
check(Object.values(aboutHits).every((n) => n === 1), `each account looked up once (${hitsBefore} lookups)`);
const tab2 = await ctx.newPage();
await tab2.goto(`https://x.com/senate_watch/status/${ROOT_ID}`);
await tab2.waitForFunction(() => document.querySelectorAll("article .sfx-flag:not(.sfx-flag--loading)").length >= 3, null, { timeout: 15_000 });
await tab2.waitForTimeout(1_500);
check(totalHits() === hitsBefore, `second tab flagged everything from cache (new lookups: ${totalHits() - hitsBefore})`);
await tab2.close();

// 👎 from the menu: applied immediately (the reply folds into the bar).
await art("policy_nerd").locator(".sfx-flag").click();
await tab.waitForTimeout(150);
await tab.screenshot({ path: join(out, "menu-desktop.png") });
await tab.getByRole("button", { name: /Spam \/ slop/ }).click();
await tab.waitForTimeout(600);
check((await state("policy_nerd")) === "fold", "👎 folds the reply right away");
check(Boolean((await barText())?.includes("6 low-quality")), "thread bar count includes your vote");
// 👍 rescues it.
await tab.locator(".sfx-thread-bar button").click(); // Show all
await tab.waitForTimeout(400);
check((await state("growth_mindset_ai")) === null && (await state("maga_eagle84721")) === null, "Show all reveals the folded replies");
check((await art("growth_mindset_ai").locator(".sfx-badge").count()) === 1, "revealed replies keep their Slop/Farm badge");
await art("policy_nerd").locator(".sfx-flag").click();
await tab.waitForTimeout(150);
await tab.getByRole("button", { name: /Looks fine/ }).click();
await tab.waitForTimeout(400);
check((await art("policy_nerd").locator(".sfx-badge").count()) === 0, "👍 clears the flag on that account");
await tab.screenshot({ path: join(out, "thread-revealed-desktop.png"), fullPage: true });

// One-tap mute from the menu (list-based → its own collapsed bar), Show, then block.
await art("my_friend").locator(".sfx-flag").click();
await tab.waitForTimeout(150);
await tab.keyboard.press("Enter"); // first item (Mute) is focused
await tab.waitForTimeout(400);
check((await state("my_friend")) === "collapse", "mute from menu collapses the post in one tap");
await tab.screenshot({ path: join(out, "muted-toast-desktop.png") });
await art("my_friend").locator(".sfx-bar button").click();
check((await art("my_friend").getAttribute("data-sfx-reveal")) === "collapse", "Show reveals a collapsed post");
await art("my_friend").locator(".sfx-flag").click();
await tab.waitForTimeout(150);
await tab.getByRole("menuitem", { name: /Block @my_friend/ }).click();
await tab.waitForTimeout(400);
check(!(await art("my_friend").isVisible()), "blocking a revealed post hides it");

// Mobile viewport
await tab.setViewportSize({ width: 390, height: 844 });
await tab.reload();
await tab.waitForFunction(() => document.querySelectorAll("article .sfx-flag").length >= 3, null, { timeout: 30_000 });
await tab.waitForTimeout(500);
await tab.screenshot({ path: join(out, "thread-mobile.png"), fullPage: true });
await art("senate_watch").locator(".sfx-flag").click();
await tab.waitForTimeout(150);
await tab.screenshot({ path: join(out, "menu-mobile.png") });
const menuBox = await tab.evaluate(() => {
	const host = document.querySelector("sfx-overlay");
	return host ? { w: window.innerWidth, scroll: document.documentElement.scrollWidth } : null;
});
check(Boolean(menuBox && menuBox.scroll <= menuBox.w), "no horizontal overflow on mobile");

// Popup
const popup = await ctx.newPage();
await popup.setViewportSize({ width: 360, height: 640 });
await popup.goto(`chrome-extension://${extId}/popup.html`);
await popup.waitForTimeout(300);
await popup.screenshot({ path: join(out, "popup-filter.png"), fullPage: true });
check(((await popup.locator("#export-feedback").textContent()) ?? "").includes("(1)"), "popup shows 1 vote ready to export");
await popup.locator("#tab-btn-lists").click();
await popup.waitForTimeout(100);
const tabCount = async (name: string) =>
	(await popup.getByRole("tab", { name: new RegExp(`^${name}`) }).locator(".n").textContent())?.trim();
check((await tabCount("Muted")) === "0" && (await tabCount("Blocked")) === "1", "block moved the account from Muted to Blocked");
await popup.locator('textarea[aria-label="Add to Muted words"]').fill("god bless, airdrop");
await popup.locator('textarea[aria-label="Add to Muted words"]').press("Enter");
await popup.waitForTimeout(200);
check((await popup.locator(".lm-row").count()) === 2, "comma-separated muted words added in one step");
await popup.screenshot({ path: join(out, "popup-lists.png"), fullPage: true });

// ── Declutter: Calm preset + counts, then check each distraction on the page ──
await tab.setViewportSize({ width: 1280, height: 1000 });
await tab.goto(`https://x.com/senate_watch/status/${ROOT_ID}`);
await tab.waitForSelector("article .sfx-flag", { timeout: 30_000 });
await tab.waitForTimeout(3_000);
const vis = (sel: string) => tab.locator(sel).first().isVisible();
check(await vis('nav a[href="/i/grok"]'), "before Calm: Grok nav visible");
check(!(await tab.evaluate(() => (document.getElementById("vid") as HTMLVideoElement).paused)), "before: page can autoplay a video");
await tab.evaluate(() => (document.getElementById("vid") as HTMLVideoElement).pause());

await popup.locator("#tab-btn-layout").click();
await popup.locator("#calm-enable").click();
await popup.getByRole("switch", { name: "Hide like / repost / view counts" }).click();
await popup.waitForTimeout(300);
await popup.screenshot({ path: join(out, "popup-layout.png"), fullPage: true });
await tab.waitForTimeout(800);

const hidden: [string, string][] = [
	['nav a[href="/i/grok"]', "Grok nav"],
	['nav a[href="/explore"]', "Explore nav"],
	['nav a[href="/i/premium_sign_up"]', "Premium nav"],
	['[aria-label="Grok"]', "floating Grok button"],
	['[aria-label="Chat"]', "floating Chat bubble"],
	['article button[aria-label="Grok actions"]', "Grok button on posts"],
	['article a[href$="/analytics"]', "view counts"],
	["text=You might like", "sidebar You might like"],
	["text=Cashtags with IBKR", "sidebar What’s happening + promoted trend"],
	["text=Falcons 1-2", "sidebar sports widget"],
	["text=Engagement bait from across X", "“Discover more” under the thread"],
];
for (const [sel, name] of hidden) check(!(await vis(sel)), `Calm hides ${name}`);
check(await vis('[data-testid="SearchBox_Search_Input"]'), "search box kept");
check(await vis('nav a[href="/notifications"]'), "Notifications nav kept");
check(await vis('article a[href="/policy_nerd"]'), "thread replies above “Discover more” stay visible");
check(await vis('article a[href="/senate_watch"]'), "the post itself stays visible");
check(await vis('nav a[href="/i/chat"]'), "Chat nav kept (only the floating bubble hides)");
const likeCount = await tab.locator('article [data-testid="like"] [data-testid="app-text-transition-container"]').first().evaluate((e) => getComputedStyle(e).visibility);
check(likeCount === "hidden", "like counts hidden, buttons still usable");
await tab.evaluate(() => {
	const v = document.getElementById("vid") as HTMLVideoElement;
	v.play().catch(() => {});
});
await tab.waitForTimeout(300);
check(await tab.evaluate(() => (document.getElementById("vid") as HTMLVideoElement).paused), "autoplay without a tap is paused");
await tab.screenshot({ path: join(out, "declutter-desktop.png"), fullPage: true });
await popup.locator("#calm-disable").click();
await tab.waitForTimeout(500);
check(await vis('nav a[href="/i/grok"]'), "Reset brings everything back");

// ── On-page manager: ⌥M, bulk add, import from X, remove ──
await tab.keyboard.press("Alt+KeyM");
await tab.waitForTimeout(400);
const mgr = tab.locator("sfx-manager");
check(await mgr.getByRole("dialog", { name: "Mutes and blocks" }).isVisible(), "⌥M opens the mutes & blocks manager");
await mgr.locator("textarea").fill("airdrop\nfree usdt, 100x");
await mgr.locator("textarea").press("Enter");
await tab.waitForTimeout(300);
// popup already added "god bless" + "airdrop"; the paste adds 2 new (airdrop is a duplicate)
await mgr.locator("textarea").blur();
check((await mgr.locator(".lm-row").count()) === 4, "pasting a list adds every word in one go, no duplicates");
await mgr.getByRole("button", { name: /Import my mutes & blocks from X/ }).click();

await mgr.locator(".lm-status", { hasText: /Imported|Couldn/ }).waitFor({ timeout: 15_000 }).catch(() => {});
const status = await mgr.locator(".lm-status").textContent();
check(Boolean(status?.includes("Imported 2 words, 1 muted, 2 blocked")), `import from X: “${status}”`);
await mgr.getByRole("tab", { name: /Blocked/ }).click();
check(Boolean(await mgr.getByText("@scammer1").isVisible()), "imported blocks listed");
await tab.screenshot({ path: join(out, "manager-desktop.png") });
await mgr.getByRole("button", { name: "Remove @scammer1" }).click();
await tab.waitForTimeout(300);
check((await mgr.locator(".lm-row", { hasText: "@scammer1" }).count()) === 0, "× removes in one tap");
await tab.keyboard.press("Escape");
await tab.waitForTimeout(200);
check((await tab.locator("sfx-manager").count()) === 0, "Escape closes the manager");
await tab.setViewportSize({ width: 390, height: 844 });
await tab.keyboard.press("Alt+KeyM");
await tab.waitForTimeout(400);
await tab.screenshot({ path: join(out, "manager-mobile.png") });
const fit = await tab.evaluate(() => {
	const m = document.querySelector("sfx-manager")?.shadowRoot?.querySelector(".modal")?.getBoundingClientRect();
	return { w: window.innerWidth, doc: document.documentElement.scrollWidth, left: m?.left, right: m?.right };
});
check(Boolean(fit.right !== undefined && fit.left! >= 0 && fit.right! <= fit.w), "manager fits on mobile");
await tab.keyboard.press("Escape");

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
await ctx.close();
if (failures.length) {
	console.error(`\n${failures.length} check(s) failed`);
	process.exit(1);
}
console.log(`\nall checks passed — screenshots in ${out}`);
