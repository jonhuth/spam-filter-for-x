import { expect, test } from "bun:test";
import { buildSha } from "./build";

test("health sha comes from GIT_SHA baked at build time", () => {
	const sha = "e0e6c69a1b2c3d4e5f60718293a4b5c6d7e8f901";
	expect(buildSha({ GIT_SHA: sha })).toBe(sha);
});

test("health sha falls back to unknown when missing or malformed", () => {
	expect(buildSha({})).toBe("unknown");
	expect(buildSha({ GIT_SHA: "" })).toBe("unknown");
	expect(buildSha({ GIT_SHA: "not-a-sha; rm -rf" })).toBe("unknown");
});
