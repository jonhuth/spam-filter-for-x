// Bundle src/ into dist/ (load-unpacked in Chrome; input to Safari converter).
// Usage: bun scripts/build.ts [--watch]

import { cpSync, mkdirSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");

const entries = {
	content: "src/content/main.ts",
	page: "src/page/main.ts",
	popup: "src/popup/main.ts",
};

async function build(): Promise<boolean> {
	rmSync(dist, { recursive: true, force: true });
	mkdirSync(dist, { recursive: true });
	for (const [name, entry] of Object.entries(entries)) {
		const result = await Bun.build({
			entrypoints: [join(root, entry)],
			target: "browser",
			format: "iife",
			minify: false,
			sourcemap: "none",
		});
		if (!result.success) {
			for (const log of result.logs) console.error(log);
			return false;
		}
		writeFileSync(join(dist, `${name}.js`), await result.outputs[0]!.text());
	}
	cpSync(join(root, "static"), dist, { recursive: true });
	const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	const manifestPath = join(dist, "manifest.json");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	manifest.version = pkg.version;
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
	console.log(`built dist/ v${pkg.version}`);
	return true;
}

const ok = await build();
if (process.argv.includes("--watch")) {
	let timer: ReturnType<typeof setTimeout> | null = null;
	for (const dir of ["src", "static"]) {
		watch(join(root, dir), { recursive: true }, () => {
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => void build(), 150);
		});
	}
	console.log("watching src/ and static/");
} else if (!ok) process.exit(1);
