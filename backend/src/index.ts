import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { getCacheStats } from "./lib/cache.js";
import classifyRoutes from "./routes/classify.js";
import lookupRoutes from "./routes/lookup.js";
import suggestMutesRoutes from "./routes/suggestMutes.js";

const app = new Hono();

// Middleware
app.use("*", logger());
app.use(
	"*",
	cors({
		origin: (origin) => {
			if (!origin) return "*";
			if (origin.startsWith("chrome-extension://")) return origin;
			if (origin.includes("localhost")) return origin;
			if (origin === "https://x.com" || origin === "https://twitter.com") return origin;
			const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") ?? [];
			if (allowedOrigins.includes(origin)) return origin;
			return origin;
		},
		allowMethods: ["GET", "POST", "OPTIONS"],
		allowHeaders: ["Content-Type"],
	}),
);

// Rate limiting - per IP, per endpoint
interface RateLimitRecord {
	count: number;
	resetAt: number;
}

const rateLimits = {
	classify: new Map<string, RateLimitRecord>(),
	lookup: new Map<string, RateLimitRecord>(),
	suggest: new Map<string, RateLimitRecord>(),
	global: new Map<string, RateLimitRecord>(),
};

const RATE_LIMITS = {
	classify: { limit: 30, windowMs: 60 * 1000 }, // 30 batch requests/min
	lookup: { limit: 20, windowMs: 60 * 1000 }, // 20 lookups/min
	suggest: { limit: 20, windowMs: 60 * 1000 }, // 20 suggest-mutes/min
	global: { limit: 100, windowMs: 60 * 1000 }, // 100 total/min
};

function checkRateLimit(
	store: Map<string, RateLimitRecord>,
	ip: string,
	limit: number,
	windowMs: number,
): { allowed: boolean; remaining: number } {
	const now = Date.now();
	const record = store.get(ip);

	if (!record || record.resetAt < now) {
		store.set(ip, { count: 1, resetAt: now + windowMs });
		return { allowed: true, remaining: limit - 1 };
	}

	if (record.count >= limit) {
		return { allowed: false, remaining: 0 };
	}

	record.count++;
	return { allowed: true, remaining: limit - record.count };
}

function getClientIP(c: { req: { header: (name: string) => string | undefined } }): string {
	return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown";
}

// Global rate limit middleware
app.use("/api/*", async (c, next) => {
	const ip = getClientIP(c);
	const { limit, windowMs } = RATE_LIMITS.global;
	const { allowed, remaining } = checkRateLimit(rateLimits.global, ip, limit, windowMs);

	c.header("X-RateLimit-Remaining", String(remaining));

	if (!allowed) {
		return c.json({ error: "Rate limit exceeded", retryAfter: Math.ceil(windowMs / 1000) }, 429);
	}

	await next();
});

// Endpoint-specific rate limits
app.use("/api/classify", async (c, next) => {
	if (c.req.method !== "POST") return await next();

	const ip = getClientIP(c);
	const { limit, windowMs } = RATE_LIMITS.classify;
	const { allowed, remaining } = checkRateLimit(rateLimits.classify, ip, limit, windowMs);

	c.header("X-RateLimit-Classify-Remaining", String(remaining));

	if (!allowed) {
		return c.json({ error: "Classify rate limit exceeded", retryAfter: Math.ceil(windowMs / 1000) }, 429);
	}

	await next();
});

app.use("/api/lookup/*", async (c, next) => {
	const ip = getClientIP(c);
	const { limit, windowMs } = RATE_LIMITS.lookup;
	const { allowed, remaining } = checkRateLimit(rateLimits.lookup, ip, limit, windowMs);

	c.header("X-RateLimit-Lookup-Remaining", String(remaining));

	if (!allowed) {
		return c.json({ error: "Lookup rate limit exceeded", retryAfter: Math.ceil(windowMs / 1000) }, 429);
	}

	await next();
});

app.use("/api/suggest-mutes", async (c, next) => {
	if (c.req.method !== "POST") return await next();
	const ip = getClientIP(c);
	const { limit, windowMs } = RATE_LIMITS.suggest;
	const { allowed, remaining } = checkRateLimit(rateLimits.suggest, ip, limit, windowMs);
	c.header("X-RateLimit-Suggest-Remaining", String(remaining));
	if (!allowed) {
		return c.json({ error: "Suggest rate limit exceeded", retryAfter: Math.ceil(windowMs / 1000) }, 429);
	}
	await next();
});

// Routes
app.route("/api/classify", classifyRoutes);
app.route("/api/lookup", lookupRoutes);
app.route("/api/suggest-mutes", suggestMutesRoutes);

// Health check
app.get("/api/health", (c) => {
	const cacheStats = getCacheStats();
	return c.json({
		status: "ok",
		timestamp: new Date().toISOString(),
		cache: cacheStats,
	});
});

// Root
app.get("/", (c) => {
	return c.json({
		name: "Spam Filter for X API",
		version: "2.0.0",
		endpoints: {
			classify: "POST /api/classify",
			lookup: "GET /api/lookup/:username",
			suggestMutes: "POST /api/suggest-mutes",
			health: "GET /api/health",
		},
		rateLimits: {
			classify: "30/min per IP",
			lookup: "20/min per IP",
			suggestMutes: "20/min per IP",
			global: "100/min per IP",
		},
	});
});

const port = Number(process.env.PORT) || 3000;
console.log(`Starting Spam Filter for X API on port ${port}`);

export default {
	port,
	fetch: app.fetch,
};
