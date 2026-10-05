// All X DOM selectors live here so markup changes are a one-file fix.

export const SEL = {
	tweet: 'article[data-testid="tweet"]',
	userName: '[data-testid="User-Name"], [data-testid="UserName"]',
	tweetText: '[data-testid="tweetText"]',
	cell: '[data-testid="cellInnerDiv"]',
} as const;

const RESERVED = new Set([
	"home",
	"explore",
	"notifications",
	"messages",
	"i",
	"compose",
	"search",
	"settings",
	"bookmarks",
	"lists",
	"communities",
	"hashtag",
	"jobs",
	"premium",
]);

export interface TweetRef {
	el: HTMLElement;
	postId: string | null;
	handle: string | null;
	/** Text as rendered (fallback when the post wasn't intercepted). */
	text: string;
}

/** Status id of the article's own permalink (the one wrapping its <time>). */
export function postIdOf(article: Element): string | null {
	const timeLink = article.querySelector("a[href*='/status/'] time")?.closest("a");
	const href = timeLink?.getAttribute("href") ?? "";
	return href.match(/\/status\/(\d+)/)?.[1] ?? null;
}

export function handleOf(article: Element): string | null {
	const root = article.querySelector(SEL.userName);
	if (!root) return null;
	for (const link of root.querySelectorAll<HTMLAnchorElement>("a[href^='/']")) {
		const m = (link.getAttribute("href") ?? "").match(/^\/(\w{1,20})(?:$|[/?])/);
		const h = m?.[1]?.toLowerCase();
		if (h && !RESERVED.has(h) && (link.textContent ?? "").trim().toLowerCase() === `@${h}`)
			return h;
	}
	for (const link of root.querySelectorAll<HTMLAnchorElement>("a[href^='/']")) {
		const m = (link.getAttribute("href") ?? "").match(/^\/(\w{1,20})$/);
		const h = m?.[1]?.toLowerCase();
		if (h && !RESERVED.has(h)) return h;
	}
	return null;
}

export function readTweet(el: HTMLElement): TweetRef {
	return {
		el,
		postId: postIdOf(el),
		handle: handleOf(el),
		text: el.querySelector(SEL.tweetText)?.textContent ?? "",
	};
}

/** The focal post id on a /<user>/status/<id> page. */
export function focalPostId(path = location.pathname): string | null {
	return path.match(/^\/\w+\/status\/(\d+)/)?.[1] ?? null;
}

/** Where to put inline chips: right after the display-name link. */
export function chipAnchor(article: Element): Element | null {
	const root = article.querySelector(SEL.userName);
	if (!root) return null;
	for (const link of root.querySelectorAll("a[href^='/']")) {
		const text = (link.textContent ?? "").trim();
		if (!text.startsWith("@") && !link.querySelector("time")) return link;
	}
	return root.firstElementChild;
}
