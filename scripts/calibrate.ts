// Tune scoring from your own votes.
// Export from the popup (Data → Export feedback), then:
//   bun run calibrate ~/Downloads/spam-filter-feedback.json

import { readFileSync } from "node:fs";
import { calibrate, type FeedbackMap } from "../src/shared/feedback";

const file = process.argv[2];
if (!file) {
	console.error("usage: bun run calibrate <exported-feedback.json>");
	process.exit(1);
}
const raw = JSON.parse(readFileSync(file, "utf8"));
const map: FeedbackMap = raw.feedback ?? raw;
const r = calibrate(map);

console.log(
	`${r.votes} votes · ${r.falsePositives} flagged-but-fine · ${r.missed} spam-not-flagged\n`,
);
console.log("signal                 spam  fine  precision");
for (const s of r.signals) {
	const warn = s.fine >= 2 && s.precision < 0.6 ? "  ← fires on real people; lower weight" : "";
	console.log(
		`${s.id.padEnd(22)} ${String(s.spam).padStart(4)}  ${String(s.fine).padStart(4)}  ${(s.precision * 100).toFixed(0).padStart(8)}%${warn}`,
	);
}
const misses = Object.entries(map).filter(
	([, e]) => e.vote === "spam" && e.label !== "slop" && e.label !== "farm",
);
if (misses.length) {
	console.log("\nSpam the scorer missed (add a signal for these):");
	for (const [h, e] of misses.slice(0, 15))
		console.log(`  @${h} score ${e.score} ${e.basedIn ?? ""} — ${e.text ?? ""}`);
}
const fps = Object.entries(map).filter(
	([, e]) => e.vote === "fine" && (e.label === "slop" || e.label === "farm"),
);
if (fps.length) {
	console.log("\nReal people it flagged:");
	for (const [h, e] of fps.slice(0, 15))
		console.log(
			`  @${h} score ${e.score} [${e.signals.map((s) => s.id).join(", ")}] — ${e.text ?? ""}`,
		);
}
