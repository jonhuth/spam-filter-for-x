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

await ctx.route("https://x.com/**", async (route) => {
	const url = new URL(route.request().url());
	if (url.pathname.endsWith("/TweetDetail")) return route.fulfill({ json: tweetDetail() });
	if (url.pathname.endsWith("/AboutAccountQuery")) {
		const vars = JSON.parse(url.searchParams.get("variables") ?? "{}");
		return route.fulfill({ json: aboutAccount(vars.screenName) });
	}
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

// Wait until every visible account has been located (queue is rate-limited by
// design; hidden farm posts are never looked up).
await tab.waitForFunction(
	() => {
		const visible = [...document.querySelectorAll("article")].filter((a) => !(a as HTMLElement).dataset.sfxState?.includes("hide"));
		return visible.length >= 5 && visible.every((a) => a.querySelector(".sfx-flag:not(.sfx-flag--loading)"));
	},
	null,
	{ timeout: 60_000 },
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
for (const u of [users.farm1!, users.farm2!, users.farm3!])
	check((await state(u.handle)) === "hide", `farm @${u.handle} hidden`);
check((await state("growth_mindset_ai")) === "collapse", "off-region AI-style slop collapsed");
check((await state("texas_truth_news")) === "collapse", "VPN + app-store mismatch generic reply collapsed");
check((await state("policy_nerd")) === null, "substantive off-region human reply shown");
check((await state("my_friend")) === null, "followed account shown despite generic text");
check((await state("senate_watch")) === null, "focal post shown");

const bar = await art("growth_mindset_ai").locator(".sfx-bar span").textContent();
check(Boolean(bar?.includes("🇮🇳") && bar.includes("Low-quality")), `collapsed bar explains: “${bar}”`);

await tab.screenshot({ path: join(out, "thread-desktop.png"), fullPage: true });

// One-tap mute from the flag menu, then undo.
await art("policy_nerd").locator(".sfx-flag").click();
await tab.waitForTimeout(150);
await tab.screenshot({ path: join(out, "menu-desktop.png") });
await tab.locator("sfx-overlay").evaluate(() => 0); // overlay exists
await tab.keyboard.press("Enter"); // first item (Mute) is focused
await tab.waitForTimeout(400);
check((await state("policy_nerd")) === "collapse", "mute from menu collapses the post in one tap");
await tab.screenshot({ path: join(out, "muted-toast-desktop.png") });

// Show on a collapsed post reveals just that post.
await art("growth_mindset_ai").locator(".sfx-bar button").click();
check((await art("growth_mindset_ai").getAttribute("data-sfx-reveal")) === "collapse", "Show reveals a collapsed post");

// Blocking a revealed post must hide it again.
await art("growth_mindset_ai").locator(".sfx-flag").click();
await tab.waitForTimeout(150);
await tab.getByRole("menuitem", { name: /Block @growth_mindset_ai/ }).click();
await tab.waitForTimeout(400);
check(!(await art("growth_mindset_ai").isVisible()), "blocking a revealed post hides it");

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
await popup.locator("#tab-btn-lists").click();
await popup.waitForTimeout(100);
const mutedCount = await popup.locator("details.list-group").nth(1).locator(".count").textContent();
check(mutedCount === "1", "popup Lists shows the muted account");
await popup.locator('input[aria-label="Add to Muted words"]').fill("god bless, airdrop");
await popup.locator('input[aria-label="Add to Muted words"]').press("Enter");
await popup.waitForTimeout(150);
check((await popup.locator("details.list-group").first().locator(".list-row").count()) === 2, "comma-separated muted words added in one step");
await popup.screenshot({ path: join(out, "popup-lists.png"), fullPage: true });
await popup.locator("#tab-btn-layout").click();
await popup.screenshot({ path: join(out, "popup-layout.png"), fullPage: true });

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
await ctx.close();
if (failures.length) {
	console.error(`\n${failures.length} check(s) failed`);
	process.exit(1);
}
console.log(`\nall checks passed — screenshots in ${out}`);
