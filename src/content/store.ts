// In-memory account/post store fed by intercepted X traffic, plus a persisted
// About-this-account cache (30d; misses retried after 1d).
//
// The cache is split into small buckets keyed by the handle's first character
// so a new lookup rewrites one bucket, not the whole cache, and tabs merge
// rather than overwrite each other.

import type { AboutAccount, Account, ParsedBatch, Post } from "../core/types";
import { mergeAccount } from "../core/xparse";

export const ABOUT_BUCKET_PREFIX = "about_v4:";
/** Popup writes this to ask every tab to drop its cache. */
export const ABOUT_CLEARED_KEY = "about_cleared_at";
const ABOUT_TTL = 30 * 86_400_000;
const ABOUT_MISS_TTL = 86_400_000;
const MAX_POSTS = 5_000;

export const bucketOf = (handle: string) => `${ABOUT_BUCKET_PREFIX}${handle[0] ?? "_"}`;

export function isFresh(entry: AboutAccount | undefined, now = Date.now()): boolean {
	return Boolean(entry && now - entry.fetchedAt < (entry.basedIn ? ABOUT_TTL : ABOUT_MISS_TTL));
}

/** Read every bucket; used by the popup for country counts too. */
export async function readAboutCache(): Promise<Map<string, AboutAccount>> {
	const out = new Map<string, AboutAccount>();
	const all = await chrome.storage.local.get(null);
	const now = Date.now();
	for (const [key, bucket] of Object.entries(all)) {
		if (!key.startsWith(ABOUT_BUCKET_PREFIX) || !bucket || typeof bucket !== "object") continue;
		for (const [handle, entry] of Object.entries(bucket as Record<string, AboutAccount>))
			if (isFresh(entry, now)) out.set(handle, entry);
	}
	return out;
}

export async function clearAboutCache(): Promise<void> {
	const all = await chrome.storage.local.get(null);
	await chrome.storage.local.remove(
		Object.keys(all).filter((k) => k.startsWith(ABOUT_BUCKET_PREFIX)),
	);
	await chrome.storage.local.set({ [ABOUT_CLEARED_KEY]: Date.now() });
}

export class Store {
	accounts = new Map<string, Account>();
	posts = new Map<string, Post>();
	about = new Map<string, AboutAccount>();
	/** Lookups that failed recently (not cached in storage). */
	private failedAt = new Map<string, number>();
	private dirtyBuckets = new Set<string>();
	private saveTimer: ReturnType<typeof setTimeout> | null = null;
	private listeners = new Set<(handles: Set<string>) => void>();

	async load(): Promise<void> {
		try {
			this.about = await readAboutCache();
		} catch {
			/* start empty */
		}
	}

	onChange(fn: (handles: Set<string>) => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	private emit(handles: Set<string>): void {
		for (const fn of this.listeners) fn(handles);
	}

	ingest(batch: ParsedBatch): void {
		const changed = new Set<string>();
		for (const a of batch.accounts) {
			const prev = this.accounts.get(a.handle);
			const merged = prev ? mergeAccount(prev, a) : a;
			if (a.about) this.setAbout(a.handle, a.about, false);
			else if (!merged.about && this.about.has(a.handle)) merged.about = this.about.get(a.handle);
			this.accounts.set(a.handle, merged);
			changed.add(a.handle);
		}
		for (const p of batch.posts) {
			this.posts.set(p.id, { ...this.posts.get(p.id), ...p });
			changed.add(p.authorHandle);
		}
		if (this.posts.size > MAX_POSTS) {
			const drop = [...this.posts.keys()].slice(0, this.posts.size - MAX_POSTS);
			for (const k of drop) this.posts.delete(k);
		}
		if (changed.size) this.emit(changed);
	}

	/** True when a lookup is worth making now. */
	needsAbout(handle: string, now = Date.now()): boolean {
		if (this.about.has(handle)) return false;
		const failed = this.failedAt.get(handle);
		return !failed || now - failed > 10 * 60_000;
	}

	/** A lookup is outstanding or retryable — show the loading chip. */
	aboutPending(handle: string): boolean {
		return !this.about.has(handle) && !this.failedAt.has(handle);
	}

	getAbout(handle: string): AboutAccount | undefined {
		return this.about.get(handle);
	}

	markFailed(handle: string): void {
		this.failedAt.set(handle, Date.now());
		this.emit(new Set([handle]));
	}

	setAbout(handle: string, about: AboutAccount, emit = true): void {
		this.about.set(handle, about);
		this.failedAt.delete(handle);
		const account = this.accounts.get(handle);
		if (account) account.about = about;
		this.dirtyBuckets.add(bucketOf(handle));
		this.scheduleSave();
		if (emit) this.emit(new Set([handle]));
	}

	account(handle: string): Account | undefined {
		const a = this.accounts.get(handle);
		const about = this.about.get(handle);
		if (a) return about && !a.about ? { ...a, about } : a;
		return about ? { id: "", handle, about, seenAt: 0 } : undefined;
	}

	private scheduleSave(): void {
		if (this.saveTimer) return;
		this.saveTimer = setTimeout(() => {
			this.saveTimer = null;
			void this.save();
		}, 10_000);
	}

	async save(): Promise<void> {
		const buckets = [...this.dirtyBuckets];
		this.dirtyBuckets.clear();
		try {
			if (!chrome.runtime?.id || !buckets.length) return;
			const stored = await chrome.storage.local.get(buckets);
			const now = Date.now();
			const writes: Record<string, Record<string, AboutAccount>> = {};
			for (const key of buckets) {
				const merged: Record<string, AboutAccount> = {};
				for (const [h, e] of Object.entries((stored[key] ?? {}) as Record<string, AboutAccount>))
					if (isFresh(e, now)) merged[h] = e;
				for (const [h, e] of this.about)
					if (bucketOf(h) === key && (!merged[h] || merged[h].fetchedAt < e.fetchedAt))
						merged[h] = e;
				writes[key] = merged;
			}
			await chrome.storage.local.set(writes);
		} catch {
			/* storage full or context invalidated */
		}
	}

	reset(): void {
		this.about.clear();
		this.failedAt.clear();
		this.dirtyBuckets.clear();
		for (const a of this.accounts.values()) delete a.about;
	}
}
