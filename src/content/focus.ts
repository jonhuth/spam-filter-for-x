// Runs the declutter toggles on the page: applies classes, keeps labels fresh
// as X re-renders, forces Following, stops autoplay, and the daily nudge.

import {
	applyDeclutter,
	clickFollowing,
	DECLUTTER_KEY,
	type DeclutterState,
	isHome,
	labelAll,
	loadDeclutter,
	sanitizeDeclutter,
} from "./declutter";
import { toast } from "./menu";

let state: DeclutterState | null = null;

// ── Labels: throttled, X re-renders constantly ──────────────────────────
let labelTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleLabel(): void {
	if (labelTimer) return;
	labelTimer = setTimeout(() => {
		labelTimer = null;
		labelAll();
		if (state?.forceFollowing && isHome()) clickFollowing();
	}, 300);
}

// ── Autoplay: pause any video that starts without a recent tap on it ─────
let lastTap: { target: EventTarget | null; at: number } = { target: null, at: 0 };
function onPointer(e: Event): void {
	lastTap = { target: e.target, at: Date.now() };
}
function onPlay(e: Event): void {
	if (!state?.pauseAutoplay) return;
	const video = e.target as HTMLVideoElement;
	if (!(video instanceof HTMLVideoElement)) return;
	const container = video.closest(
		'article, [data-testid="videoComponent"], [data-testid="videoPlayer"]',
	);
	const tapped =
		Date.now() - lastTap.at < 1500 &&
		lastTap.target instanceof Node &&
		(container?.contains(lastTap.target) || video.contains(lastTap.target));
	if (!tapped) video.pause();
}

// ── Daily time nudge ─────────────────────────────────────────────────────
const TIME_KEY = "time_today_v4";
interface TimeToday {
	day: string;
	seconds: number;
	snoozeUntil: number;
}
const today = () => new Date().toLocaleDateString("en-CA");
let tickTimer: ReturnType<typeof setInterval> | null = null;

async function tick(): Promise<void> {
	if (!state || state.dailyLimitMin <= 0) return;
	if (document.visibilityState !== "visible" || !document.hasFocus()) return;
	let t: TimeToday = { day: today(), seconds: 0, snoozeUntil: 0 };
	try {
		const saved = (await chrome.storage.local.get(TIME_KEY))[TIME_KEY] as TimeToday | undefined;
		if (saved?.day === t.day) t = saved;
		t.seconds += 15;
		await chrome.storage.local.set({ [TIME_KEY]: t });
	} catch {
		return;
	}
	const over = t.seconds >= state.dailyLimitMin * 60;
	if (over && Date.now() > t.snoozeUntil) showNudge(t);
}

function showNudge(t: TimeToday): void {
	if (document.getElementById("sfx-nudge")) return;
	const wrap = document.createElement("div");
	wrap.id = "sfx-nudge";
	wrap.setAttribute("role", "dialog");
	wrap.setAttribute("aria-label", "Time on X today");
	wrap.style.cssText =
		"position:fixed;inset:0;z-index:2147483645;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);font:15px/1.4 -apple-system,system-ui,sans-serif";
	const card = document.createElement("div");
	card.style.cssText =
		"max-width:340px;margin:16px;padding:22px;border-radius:18px;background:#16181c;color:#e7e9ea;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,.4)";
	const mins = Math.round(t.seconds / 60);
	card.innerHTML = `<div style="font-size:28px">⏳</div><div style="font-weight:700;font-size:18px;margin:6px 0">${mins} minutes on X today</div><div style="color:#8b98a5;margin-bottom:16px">You set a ${state?.dailyLimitMin}-minute nudge. Good place to stop?</div>`;
	const row = document.createElement("div");
	row.style.cssText = "display:flex;gap:8px";
	const btn = (label: string, primary: boolean, run: () => void) => {
		const b = document.createElement("button");
		b.textContent = label;
		b.style.cssText = `flex:1;padding:10px;border-radius:999px;border:0;font:600 14px -apple-system,system-ui,sans-serif;cursor:pointer;${primary ? "background:#1d9bf0;color:#fff" : "background:#2f3336;color:#e7e9ea"}`;
		b.addEventListener("click", run);
		row.append(b);
		return b;
	};
	btn("I’m done", true, () => {
		wrap.remove();
		location.href = "about:blank";
	});
	btn("5 more minutes", false, async () => {
		wrap.remove();
		try {
			await chrome.storage.local.set({
				[TIME_KEY]: { ...t, snoozeUntil: Date.now() + 5 * 60_000 },
			});
		} catch {
			/* ignore */
		}
		toast("Snoozed for 5 minutes");
	});
	card.append(row);
	wrap.append(card);
	document.documentElement.append(wrap);
}

// ── Boot ─────────────────────────────────────────────────────────────────
function apply(next: DeclutterState): void {
	state = next;
	applyDeclutter(next);
	scheduleLabel();
	if (next.dailyLimitMin > 0 && !tickTimer) tickTimer = setInterval(() => void tick(), 15_000);
	if (next.dailyLimitMin <= 0 && tickTimer) {
		clearInterval(tickTimer);
		tickTimer = null;
	}
}

export async function initFocus(): Promise<void> {
	apply(await loadDeclutter());
	new MutationObserver(scheduleLabel).observe(document.documentElement, {
		childList: true,
		subtree: true,
	});
	document.addEventListener("pointerdown", onPointer, true);
	document.addEventListener("keydown", onPointer, true);
	document.addEventListener("play", onPlay, true);
	let last = location.href;
	setInterval(() => {
		if (location.href !== last) {
			last = location.href;
			scheduleLabel();
		}
	}, 500);
	chrome.storage.onChanged.addListener((changes, area) => {
		if (area === "local" && changes[DECLUTTER_KEY])
			apply(sanitizeDeclutter(changes[DECLUTTER_KEY].newValue));
	});
}
