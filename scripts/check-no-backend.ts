// Fail if the built extension references any host other than X's own.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dist = join(import.meta.dir, "..", "dist");
const allowed = /^(?:[\w-]+\.)*(?:x\.com|twitter\.com|twimg\.com)$/;
const bad: string[] = [];
for (const file of readdirSync(dist).filter((f) => /\.(js|html|json)$/.test(f))) {
	const text = readFileSync(join(dist, file), "utf8");
	for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
		const host = m[1]!.toLowerCase();
		if (!allowed.test(host) && host !== "www.w3.org") bad.push(`${file}: ${m[0]}`);
	}
	if (/railway|anthropic|workers\.dev/i.test(text)) bad.push(`${file}: backend keyword`);
}
const manifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
for (const h of manifest.host_permissions ?? [])
	if (!/^https:\/\/(x|twitter)\.com\/\*$/.test(h)) bad.push(`manifest host: ${h}`);
if (bad.length) {
	console.error(`external hosts found:\n${bad.join("\n")}`);
	process.exit(1);
}
console.log("no-backend: dist/ talks only to x.com / twitter.com");
