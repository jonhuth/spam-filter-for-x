// Normalized records shared by page script, content script, and scoring.

export interface Account {
	id: string;
	/** Lowercased handle; the store key. */
	handle: string;
	displayName?: string;
	followers?: number;
	following?: number;
	posts?: number;
	/** Epoch ms. */
	createdAt?: number;
	defaultAvatar?: boolean;
	blueVerified?: boolean;
	/** Legacy/org/government verification, not paid. */
	verified?: boolean;
	protected?: boolean;
	bio?: string;
	/** Free-text profile location (user-entered, unreliable). */
	profileLocation?: string;
	youFollow?: boolean;
	followsYou?: boolean;
	/** From AboutAccountQuery. */
	about?: AboutAccount;
	/** Epoch ms when the profile fields were last seen. */
	seenAt: number;
}

export interface AboutAccount {
	/** X's "Account based in" label: a country or region name. */
	basedIn: string | null;
	/** False when X flags the location as possibly inaccurate (VPN/proxy). */
	locationAccurate?: boolean;
	/** False when the claimed creation country looks inaccurate. */
	createdCountryAccurate?: boolean;
	/** Where the account connects from, e.g. "United States App Store". */
	source?: string;
	usernameChanges?: number;
	fetchedAt: number;
}

export interface Post {
	id: string;
	authorId: string;
	authorHandle: string;
	text: string;
	lang?: string;
	conversationId?: string;
	inReplyToId?: string;
	inReplyToHandle?: string;
	quotedId?: string;
	createdAt?: number;
	promoted?: boolean;
	likes?: number;
	replies?: number;
	views?: number;
}

export interface ParsedBatch {
	accounts: Account[];
	posts: Post[];
}
