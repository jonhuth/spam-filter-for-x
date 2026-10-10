// Typed messages between the page-world script and the content script.
// Every message carries the per-load nonce the content script hands the page
// script, so unrelated window messages are ignored.

import type { AboutAccount, ParsedBatch } from "../core/types";

export const BRIDGE_TAG = "sfx";

export type XAction = "mute" | "unmute" | "block" | "unblock" | "muteWord";

export type PageToContent =
	| { kind: "batch"; batch: ParsedBatch }
	| {
			kind: "about";
			reqId: number;
			handle: string;
			about: AboutAccount | null;
			status: number;
			/** From X's x-rate-limit-* headers. */
			rate?: { remaining: number; resetAt: number };
	  }
	| { kind: "xActionResult"; reqId: number; ok: boolean; status: number }
	| { kind: "ready" };

export type ContentToPage =
	| { kind: "about"; reqId: number; handle: string }
	| { kind: "xAction"; reqId: number; action: XAction; target: string };

export interface Envelope<T> {
	tag: typeof BRIDGE_TAG;
	nonce: string;
	dir: "toContent" | "toPage";
	msg: T;
}

export function isEnvelope<T>(
	data: unknown,
	nonce: string,
	dir: Envelope<T>["dir"],
): data is Envelope<T> {
	const d = data as Envelope<T> | null;
	return Boolean(d && d.tag === BRIDGE_TAG && d.nonce === nonce && d.dir === dir && d.msg);
}
