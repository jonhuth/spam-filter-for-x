// Rate-limited About-this-account lookups. One request at a time, newest
// (most recently seen on screen) first, exponential backoff on 429.

import type { AboutAccount } from "../core/types";

export type AboutFetcher = (
	handle: string,
) => Promise<{ about: AboutAccount | null; status: number }>;

export interface QueueOptions {
	minGapMs?: number;
	maxQueue?: number;
	baseBackoffMs?: number;
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
}

export class AboutQueue {
	private queue: string[] = [];
	private inFlight = new Set<string>();
	private running = false;
	private lastAt = Number.NEGATIVE_INFINITY;
	private backoffUntil = 0;
	private consecutive429 = 0;
	private readonly minGap: number;
	private readonly maxQueue: number;
	private readonly baseBackoff: number;
	private readonly now: () => number;
	private readonly sleep: (ms: number) => Promise<void>;

	constructor(
		private fetcher: AboutFetcher,
		private onResult: (handle: string, about: AboutAccount | null) => void,
		opts: QueueOptions = {},
		private onFailure: (handle: string, status: number) => void = () => {},
	) {
		this.minGap = opts.minGapMs ?? 2500;
		this.maxQueue = opts.maxQueue ?? 60;
		this.baseBackoff = opts.baseBackoffMs ?? 5 * 60_000;
		this.now = opts.now ?? Date.now;
		this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
	}

	get size(): number {
		return this.queue.length;
	}

	get rateLimitedUntil(): number {
		return this.backoffUntil;
	}

	/** Move to the front (most urgent). Drops the stalest when full. */
	request(handle: string): void {
		if (this.inFlight.has(handle)) return;
		this.queue = [handle, ...this.queue.filter((h) => h !== handle)].slice(0, this.maxQueue);
		void this.run();
	}

	private async run(): Promise<void> {
		if (this.running) return;
		this.running = true;
		try {
			while (this.queue.length) {
				const wait = Math.max(
					this.backoffUntil - this.now(),
					this.lastAt + this.minGap - this.now(),
					0,
				);
				if (wait > 0) await this.sleep(wait);
				const handle = this.queue.shift();
				if (!handle) break;
				this.inFlight.add(handle);
				this.lastAt = this.now();
				const { about, status } = await this.fetcher(handle).catch(() => ({
					about: null,
					status: 0,
				}));
				this.inFlight.delete(handle);
				if (status === 429) {
					this.consecutive429++;
					this.backoffUntil =
						this.now() + this.baseBackoff * 2 ** Math.min(this.consecutive429 - 1, 4);
					this.queue.unshift(handle);
					continue;
				}
				this.consecutive429 = 0;
				// 200 (even with no label) is cached; failures are not, but are
				// reported so the caller stops re-requesting for a while.
				if (status === 200 || about) {
					this.onResult(handle, about);
					continue;
				}
				this.onFailure(handle, status);
				// Auth / unknown query id: the next request will fail the same way.
				if (status === 401 || status === 403 || status === 404) {
					this.backoffUntil = this.now() + this.baseBackoff * 2;
					for (const h of this.queue.splice(0)) this.onFailure(h, status);
				}
			}
		} finally {
			this.running = false;
		}
	}
}
