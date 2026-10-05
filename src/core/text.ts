// Reply-text features. Each feature is cheap, local, and explainable.
// Short human chat ("lol", "true") is NOT slop on its own — features only add
// weight; the scorer decides.

const URL_RE = /https?:\/\/\S+/g;
const MENTION_RE = /(^|\s)@\w{1,20}/g;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const HASHTAG_RE = /(^|\s)#\w+/g;

export function stripEntities(text: string): string {
	return text.replace(URL_RE, " ").replace(MENTION_RE, " ").replace(/\s+/g, " ").trim();
}

export function words(text: string): string[] {
	return stripEntities(text)
		.toLowerCase()
		.replace(/[^\p{L}\p{N}'\s]/gu, " ")
		.split(/\s+/)
		.filter(Boolean);
}

/** Generic praise / agreement that could be pasted under any post. */
const GENERIC_PRAISE = [
	"great point",
	"great post",
	"great insight",
	"great insights",
	"great thread",
	"well said",
	"so true",
	"couldn't agree more",
	"could not agree more",
	"absolutely right",
	"absolutely spot on",
	"spot on",
	"this is huge",
	"this is so important",
	"this is a game changer",
	"game changer",
	"love this",
	"thanks for sharing",
	"thank you for sharing",
	"interesting perspective",
	"powerful message",
	"powerful reminder",
	"this is a powerful",
	"needed to hear this",
	"keep it up",
	"keep going",
	"amazing work",
	"well put",
	"exactly this",
	"facts",
	"this 👆",
	"big if true",
	"let's go",
	"lfg",
];

/** Patterns typical of LLM-generated engagement replies. */
const AI_STYLE: RegExp[] = [
	/\bit'?s not just\b.{3,60}\bit'?s\b/i,
	/\bthis (?:really )?(?:highlights|underscores|speaks to|captures)\b/i,
	/\b(?:truly|incredibly) (?:inspiring|insightful|fascinating)\b/i,
	/\bwhat a (?:great|fantastic|powerful|fascinating) (?:take|point|insight|perspective|thread)\b/i,
	/\bin today'?s (?:fast-paced|digital|ever-changing)\b/i,
	/\b(?:delve|delving) into\b/i,
	/\bnavigat(?:e|ing) the complexities\b/i,
	/\bthe (?:key|real) takeaway\b/i,
	/\bcurious to (?:see|hear) how\b/i,
	/\bgreat question[!.]/i,
	/—.+—/,
];

/** Spam calls-to-action: off-platform contact, scams, adult bait. */
const SPAM_CTA: RegExp[] = [
	/\b(?:dm|inbox|message) me\b/i,
	/\b(?:check|see) (?:my|the) (?:bio|pinned|profile)\b/i,
	/\blink in (?:my )?bio\b/i,
	/\bt\.me\/|\btelegram\b|\bwhatsapp\b|\bwa\.me\//i,
	/\bairdrop\b|\bpresale\b|\b100x\b|\bclaim (?:your|now)\b|\bfree (?:crypto|usdt|btc|eth)\b/i,
	/\b(?:recover|recovery) (?:your )?(?:funds|account|wallet)\b|\bhacked account\b/i,
	/\b0x[a-fA-F0-9]{40}\b|\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/,
	/\b(?:onlyfans|of link|nudes?|sexy pics?|horny|lonely tonight)\b/i,
	/\bpassive income\b|\bmentor(?:ship)? (?:changed|helped) my life\b|\bforex\b|\binvestment (?:manager|expert)\b/i,
];

export interface TextFeatures {
	length: number;
	wordCount: number;
	emojiOnly: boolean;
	emojiCount: number;
	hashtagCount: number;
	genericPraise: string | null;
	aiStyle: string | null;
	spamCta: string | null;
	/** Jaccard overlap with the parent post's words, 0..1. */
	parentEcho: number;
}

export function textFeatures(text: string, parentText = ""): TextFeatures {
	const clean = stripEntities(text);
	const lower = clean.toLowerCase();
	const ws = words(text);
	const emojiCount = (clean.match(EMOJI_RE) ?? []).length;
	const emojiOnly =
		clean.length > 0 &&
		clean.replace(EMOJI_RE, "").replace(/\s|\p{P}|\u200d|\ufe0f|\p{Emoji_Modifier}/gu, "") === "";
	const genericPraise =
		ws.length <= 14 ? (GENERIC_PRAISE.find((p) => lower.includes(p)) ?? null) : null;
	const ai = AI_STYLE.find((re) => re.test(clean));
	const spam = SPAM_CTA.find((re) => re.test(text));
	return {
		length: clean.length,
		wordCount: ws.length,
		emojiOnly,
		emojiCount,
		hashtagCount: (text.match(HASHTAG_RE) ?? []).length,
		genericPraise,
		aiStyle: ai ? (clean.match(ai)?.[0] ?? "ai-style") : null,
		spamCta: spam ? (text.match(spam)?.[0] ?? "spam") : null,
		parentEcho: parentText ? jaccard(shingles(text, 1), shingles(parentText, 1)) : 0,
	};
}

/** Word n-gram shingles for near-duplicate detection. */
export function shingles(text: string, n = 2): Set<string> {
	const ws = words(text);
	const out = new Set<string>();
	if (ws.length < n) {
		if (ws.length) out.add(ws.join(" "));
		return out;
	}
	for (let i = 0; i + n <= ws.length; i++) out.add(ws.slice(i, i + n).join(" "));
	return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 || b.size === 0) return 0;
	let inter = 0;
	const [small, large] = a.size <= b.size ? [a, b] : [b, a];
	for (const x of small) if (large.has(x)) inter++;
	return inter / (a.size + b.size - inter);
}

export interface ClusterInput {
	id: string;
	authorHandle: string;
	text: string;
}

/**
 * Group near-duplicate replies by different authors. Returns post id → cluster
 * size for posts in clusters of `minSize`+ distinct authors. Tiny replies
 * ("lol") are ignored — identical short chat is not coordination.
 */
export function duplicateClusters(
	items: ClusterInput[],
	{ threshold = 0.6, minSize = 3, minWords = 4 } = {},
): Map<string, number> {
	const eligible = items
		.map((it) => ({ ...it, sh: shingles(it.text, 2), wc: words(it.text).length }))
		.filter((it) => it.wc >= minWords);
	const parent = eligible.map((_, i) => i);
	const find = (i: number): number => {
		while (parent[i] !== i) {
			parent[i] = parent[parent[i]!]!;
			i = parent[i]!;
		}
		return i;
	};
	for (let i = 0; i < eligible.length; i++) {
		for (let j = i + 1; j < eligible.length; j++) {
			const a = eligible[i]!;
			const b = eligible[j]!;
			if (a.authorHandle === b.authorHandle) continue;
			if (jaccard(a.sh, b.sh) >= threshold) parent[find(i)] = find(j);
		}
	}
	const groups = new Map<number, Set<string>>();
	eligible.forEach((it, i) => {
		const root = find(i);
		if (!groups.has(root)) groups.set(root, new Set());
		groups.get(root)!.add(it.authorHandle);
	});
	const out = new Map<string, number>();
	eligible.forEach((it, i) => {
		const authors = groups.get(find(i))!.size;
		if (authors >= minSize) out.set(it.id, authors);
	});
	return out;
}
