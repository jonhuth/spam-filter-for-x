// In-memory account/post store fed by intercepted X traffic, plus a persisted
// About-this-account cache (30d; misses retried after 1d).

import type { AboutAccount, Account, ParsedBatch, Post } from "../core/types";
import { mergeAccount } from "../core/xparse";

const ABOUT_KEY = "about_cache_v4";
const STATS_KEY = "country_stats_v4";
const ABOUT_TTL = 30 * 86_400_000;
const ABOUT_MISS_TTL = 86_400_000;
const MAX_ABOUT = 20_000;
const MAX_POSTS = 5_000;

export interface AboutEntry extends AboutAccount {}

export class Store {
	accounts = new Map<string, Account>();
	posts = new Map<string, Post>();
	about = new Map<string, AboutEntry>();
	/** Country name → distinct accounts seen, for popup quick-hide chips. */
	countryStats: Record<string, number> = {};
	private saveTimer: ReturnType<typeof setTimeout> | null = null;
	private listeners = new Set<(handles: Set<string>) => void>();

	async load(): Promise<void> {
		try {
			const got = await chrome.storage.local.get([ABOUT_KEY, STATS_KEY]);
			const now = Date.now();
			for (const [handle, entry] of Object.entries(
				(got[ABOUT_KEY] ?? {}) as Record<string, AboutEntry>,
			)) {
				if (entry && now - entry.fetchedAt < (entry.basedIn ? ABOUT_TTL : ABOUT_MISS_TTL))
					this.about.set(handle, entry);
			}
			this.countryStats = (got[STATS_KEY] as Record<string, number>) ?? {};
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
			const about = this.about.get(a.handle);
			if (about && !merged.about) merged.about = about;
			if (a.about) this.setAbout(a.handle, a.about, false);
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

	needsAbout(handle: string): boolean {
		return !this.about.has(handle);
	}

	getAbout(handle: string): AboutEntry | undefined {
		return this.about.get(handle);
	}

	setAbout(handle: string, about: AboutAccount, emit = true): void {
		const isNew = !this.about.get(handle)?.basedIn;
		this.about.set(handle, about);
		const account = this.accounts.get(handle);
		if (account) account.about = about;
		if (isNew && about.basedIn)
			this.countryStats[about.basedIn] = (this.countryStats[about.basedIn] ?? 0) + 1;
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
		}, 3000);
	}

	async save(): Promise<void> {
		try {
			if (!chrome.runtime?.id) return;
			let entries = [...this.about.entries()];
			if (entries.length > MAX_ABOUT) {
				entries = entries.sort((a, b) => b[1].fetchedAt - a[1].fetchedAt).slice(0, MAX_ABOUT);
				this.about = new Map(entries);
			}
			await chrome.storage.local.set({
				[ABOUT_KEY]: Object.fromEntries(entries),
				[STATS_KEY]: this.countryStats,
			});
		} catch {
			/* storage full or context invalidated */
		}
	}

	async clear(): Promise<void> {
		this.about.clear();
		this.countryStats = {};
		try {
			await chrome.storage.local.remove([ABOUT_KEY, STATS_KEY]);
		} catch {
			/* ignore */
		}
	}
}

export const ABOUT_STORAGE_KEYS = [ABOUT_KEY, STATS_KEY];
