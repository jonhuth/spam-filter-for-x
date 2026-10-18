// Build identity baked into the image by scripts/deploy-backend.sh (`--build-arg GIT_SHA=<sha>`).
// The deploy compares /api/health's `sha` with the commit it built: HTTP 200 alone is not proof.
export function buildSha(env: Record<string, string | undefined> = process.env): string {
	const sha = env.GIT_SHA?.trim();
	return sha && /^[0-9a-f]{7,40}$/.test(sha) ? sha : "unknown";
}
