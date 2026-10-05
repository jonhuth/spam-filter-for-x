// Conversation context: which region a thread "belongs" to, and whether it is
// political/civic. Used to weigh off-region repliers — a Nigerian account in a
// Lagos thread is normal; the same account flooding a US election thread is not.

import { type Bloc, resolvePlace } from "./country";

const TOPIC_LEXICON: { bloc: Bloc; political: RegExp; regional: RegExp }[] = [
	{
		bloc: "north-america",
		political:
			/\b(?:trump|biden|harris|vance|maga|gop|republicans?|democrats?|dnc|rnc|congress|senate|scotus|supreme court|white house|potus|midterms?|swing states?|electoral college|filibuster|ice raids?|second amendment|2a|roe|governor|attorney general|doj|fbi|cia)\b/i,
		regional:
			/\b(?:america|americans|u\.?s\.?a?|united states|canada|canadian|trudeau|poilievre|carney|new york|california|texas|florida)\b/i,
	},
	{
		bloc: "europe",
		political:
			/\b(?:starmer|sunak|farage|reform uk|tories|labour|brexit|westminster|parliament|macron|le pen|afd|merz|scholz|bundestag|meloni|orb[aá]n|von der leyen|eu commission|european commission|mep|nato)\b/i,
		regional:
			/\b(?:uk|britain|british|england|london|europe|european|eu|germany|german|france|french|italy|italian|spain|poland|ireland|sweden|netherlands|dutch)\b/i,
	},
];

export interface ThreadContext {
	/** Region the thread is about or rooted in, if determinable. */
	bloc?: Bloc;
	/** Thread touches politics/civic topics — off-region replies weigh more. */
	political: boolean;
	/** Why: for explanations. */
	basis?: string;
}

/**
 * Infer context from the root post's text and its author's country.
 * The author's country wins for bloc; text decides `political`.
 */
export function threadContext(rootText: string, rootAuthorBasedIn?: string | null): ThreadContext {
	let political = false;
	let textBloc: Bloc | undefined;
	for (const entry of TOPIC_LEXICON) {
		const isPolitical = entry.political.test(rootText);
		if (isPolitical || entry.regional.test(rootText)) {
			textBloc ??= entry.bloc;
			political ||= isPolitical;
		}
	}
	const authorBloc = resolvePlace(rootAuthorBasedIn)?.bloc;
	if (textBloc) return { bloc: textBloc, political, basis: "topic" };
	if (authorBloc) return { bloc: authorBloc, political, basis: "author" };
	return { political };
}
