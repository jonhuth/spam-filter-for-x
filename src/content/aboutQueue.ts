// Rate-limited About-this-account lookups.
//
// - Priority: riskiest unknown accounts first (new, tiny, replying), then most
//   recently seen. Established accounts wait their turn.
// - Pacing follows X's own x-rate-limit-remaining / -reset headers: spread the
//   remaining budget over the window instead of a fixed guess. Falls back to
//   `minGapMs` when headers are absent.
// - 429 → exponential backoff (or until the reset X reports).
// - 401/403/404 → pause the whole queue (auth / stale query id).

import type { AboutAccount } from "../core/types";

export interface RateInfo {
	remaining: number;
	/** Epoch ms when the window resets. */
	resetAt: number;
}

export type AboutFetcher = (
	handle: string,
) => Promise<{ about: AboutAccount | null; status: number; rate?: RateInfo }>;

export interface QueueOptions {
	minGapMs?: number;
	/** Never go faster than this, whatever the headers say. */
	floorGapMs?: number;
	maxQueue?: number;
	baseBackoffMs?: number;
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
}

interface Item {
	handle: string;
	priority: number;
	seq: number;
}

export class AboutQueue {
	private items = new Map<string, Item>();
	private inFlight = new Set<string>();
	private running = false;
	private seq = 0;
	private lastAt = Number.NEGATIVE_INFINITY;
	private backoffUntil = 0;
	private consecutive429 = 0;
	private rate: RateInfo | null = null;
	private readonly minGap: number;
	private readonly floorGap: number;
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
		this.minGap = opts.minGapMs ?? 2000;
		this.floorGap = opts.floorGapMs ?? 600;
		this.maxQueue = opts.maxQueue ?? 150;
		this.baseBackoff = opts.baseBackoffMs ?? 5 * 60_000;
		this.now = opts.now ?? Date.now;
		this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
	}

	get size(): number {
		return this.items.size;
	}

	get rateLimitedUntil(): number {
		return this.backoffUntil;
	}

	/** Gap before the next request, from X's reported budget when known. */
	gapMs(): number {
		const r = this.rate;
		if (!r) return this.minGap;
		const windowLeft = r.resetAt - this.now();
		if (windowLeft <= 0) return this.floorGap;
		// Keep a small reserve so X's own page traffic never hits the wall.
		const usable = r.remaining - 3;
		if (usable <= 0) return windowLeft;
		return Math.max(this.floorGap, windowLeft / usable);
	}

	/**
	 * Queue or re-prioritize a lookup. Higher priority goes first; ties go to
	 * the most recently requested. When full, the lowest priority is dropped.
	 */
	request(handle: string, priority = 0): void {
		if (this.inFlight.has(handle)) return;
		const prev = this.items.get(handle);
		this.items.set(handle, {
			handle,
			priority: Math.max(priority, prev?.priority ?? Number.NEGATIVE_INFINITY),
			seq: ++this.seq,
		});
		if (this.items.size > this.maxQueue) {
			const worst = [...this.items.values()].sort(compare).at(-1);
			if (worst) this.items.delete(worst.handle);
		}
		void this.run();
	}

	private next(): Item | undefined {
		let best: Item | undefined;
		for (const it of this.items.values()) if (!best || compare(it, best) < 0) best = it;
		if (best) this.items.delete(best.handle);
		return best;
	}

	private async run(): Promise<void> {
		if (this.running) return;
		this.running = true;
		try {
			while (this.items.size) {
				const wait = Math.max(
					this.backoffUntil - this.now(),
					this.lastAt + this.gapMs() - this.now(),
					0,
				);
				if (wait > 0) await this.sleep(wait);
				const item = this.next();
				if (!item) break;
				const { handle } = item;
				this.inFlight.add(handle);
				this.lastAt = this.now();
				const res = await this.fetcher(handle).catch(() => ({
					about: null,
					status: 0,
					rate: undefined,
				}));
				this.inFlight.delete(handle);
				if (res.rate) this.rate = res.rate;
				if (res.status === 429) {
					this.consecutive429++;
					const backoff = this.baseBackoff * 2 ** Math.min(this.consecutive429 - 1, 4);
					this.backoffUntil = Math.max(
						this.now() + 30_000,
						Math.min(this.now() + backoff, res.rate?.resetAt ?? Number.POSITIVE_INFINITY),
					);
					this.items.set(handle, item);
					continue;
				}
				this.consecutive429 = 0;
				// 200 (even with no label) is cached; failures are reported so the
				// caller stops re-requesting for a while.
				if (res.status === 200 || res.about) {
					this.onResult(handle, res.about);
					continue;
				}
				this.onFailure(handle, res.status);
				if (res.status === 401 || res.status === 403 || res.status === 404) {
					this.backoffUntil = this.now() + this.baseBackoff * 2;
					for (const h of [...this.items.keys()]) this.onFailure(h, res.status);
					this.items.clear();
				}
			}
		} finally {
			this.running = false;
		}
	}
}

function compare(a: Item, b: Item): number {
	return b.priority - a.priority || b.seq - a.seq;
}
