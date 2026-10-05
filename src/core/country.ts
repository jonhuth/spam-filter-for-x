// Country / region canonicalization, flag emoji, and macro-region blocs.
// X's "About this account" returns either a country name ("India") or a region
// ("South Asia") when the account owner chose region-level display.

export type Bloc =
	| "north-america"
	| "europe"
	| "latin-america"
	| "mena"
	| "sub-saharan-africa"
	| "south-asia"
	| "east-asia-pacific"
	| "cis";

export interface Place {
	/** Canonical display name, e.g. "United States" or "South Asia". */
	name: string;
	/** ISO 3166-1 alpha-2 code for countries; absent for regions. */
	code?: string;
	/** Flag for countries, globe/bloc emoji for regions. */
	emoji: string;
	bloc?: Bloc;
	kind: "country" | "region";
}

const BLOC_CODES: Record<Bloc, string> = {
	"north-america": "US CA",
	europe:
		"GB IE FR DE NL BE LU AT CH LI IT ES PT AD MC SM VA MT DK NO SE FI IS EE LV LT PL CZ SK HU SI HR BA RS ME MK AL XK GR CY BG RO MD UA GI FO GL IM JE GG",
	"latin-america":
		"MX GT BZ SV HN NI CR PA CU DO HT JM BS BB TT PR AG DM GD KN LC VC CO VE EC PE BO CL AR UY PY BR GY SR AW CW",
	mena: "MA DZ TN LY EG SD SA AE QA BH KW OM YE IQ IR SY LB JO IL PS TR",
	"sub-saharan-africa":
		"NG GH KE ET TZ UG RW BI ZA ZW ZM MW MZ AO NA BW LS SZ MG MU SC CM CD CG GA GQ CF TD NE ML BF SN GM GN GW SL LR CI TG BJ MR CV ER DJ SO SS KM",
	"south-asia": "IN PK BD LK NP BT MV AF",
	"east-asia-pacific":
		"CN HK MO TW JP KR KP MN VN LA KH TH MM MY SG ID PH BN TL AU NZ PG FJ SB VU WS TO KI FM MH PW NR TV NC PF GU",
	cis: "RU BY KZ UZ KG TJ TM AZ AM GE",
};

const CODE_TO_BLOC = new Map<string, Bloc>();
for (const [bloc, codes] of Object.entries(BLOC_CODES) as [Bloc, string][]) {
	for (const code of codes.split(" ")) CODE_TO_BLOC.set(code, bloc);
}

/** Region labels X uses (and common variants) → bloc + emoji. */
const REGIONS: { name: string; aliases: string[]; bloc: Bloc; emoji: string }[] = [
	{ name: "North America", aliases: [], bloc: "north-america", emoji: "🌎" },
	{
		name: "Europe",
		aliases: ["european union", "eu", "europe & central asia"],
		bloc: "europe",
		emoji: "🇪🇺",
	},
	{
		name: "Latin America & Caribbean",
		aliases: ["latin america", "latin america and the caribbean", "south america", "caribbean"],
		bloc: "latin-america",
		emoji: "🌎",
	},
	{
		name: "Middle East & North Africa",
		aliases: ["middle east", "west asia", "north africa", "middle east and north africa"],
		bloc: "mena",
		emoji: "🌍",
	},
	{
		name: "Africa",
		aliases: ["sub-saharan africa", "sub saharan africa"],
		bloc: "sub-saharan-africa",
		emoji: "🌍",
	},
	{ name: "South Asia", aliases: [], bloc: "south-asia", emoji: "🌏" },
	{
		name: "East Asia & Pacific",
		aliases: ["east asia and pacific", "east asia", "southeast asia", "asia pacific", "oceania"],
		bloc: "east-asia-pacific",
		emoji: "🌏",
	},
	{ name: "Central Asia", aliases: [], bloc: "cis", emoji: "🌏" },
];

/** Names X or users commonly use that Intl.DisplayNames won't produce. */
const COUNTRY_ALIASES: Record<string, string> = {
	usa: "US",
	"u.s.": "US",
	"u.s.a.": "US",
	us: "US",
	america: "US",
	"united states of america": "US",
	uk: "GB",
	"great britain": "GB",
	britain: "GB",
	england: "GB",
	scotland: "GB",
	wales: "GB",
	"northern ireland": "GB",
	uae: "AE",
	russia: "RU",
	"russian federation": "RU",
	"south korea": "KR",
	korea: "KR",
	"republic of korea": "KR",
	"north korea": "KP",
	turkey: "TR",
	türkiye: "TR",
	turkiye: "TR",
	czech: "CZ",
	"czech republic": "CZ",
	macedonia: "MK",
	"viet nam": "VN",
	"ivory coast": "CI",
	"côte d’ivoire": "CI",
	"cote d'ivoire": "CI",
	"dr congo": "CD",
	"democratic republic of the congo": "CD",
	"congo - kinshasa": "CD",
	"congo - brazzaville": "CG",
	palestine: "PS",
	"palestinian territories": "PS",
	"hong kong sar china": "HK",
	"macao sar china": "MO",
	macau: "MO",
	burma: "MM",
	"myanmar (burma)": "MM",
	eswatini: "SZ",
	swaziland: "SZ",
	"bosnia & herzegovina": "BA",
	"trinidad & tobago": "TT",
	"st. lucia": "LC",
	"st. kitts & nevis": "KN",
	"st. vincent & grenadines": "VC",
	"antigua & barbuda": "AG",
};

const ALL_CODES = [
	...new Set(
		Object.values(BLOC_CODES)
			.join(" ")
			.split(" ")
			.concat("AQ", "BM", "KY", "VG", "VI", "TC", "AI", "MS", "FK", "RE", "YT", "GP", "MQ", "GF"),
	),
];

function displayName(code: string): string {
	try {
		return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
	} catch {
		return code;
	}
}

/** Flag emoji from an ISO alpha-2 code via regional indicator symbols. */
export function flagForCode(code: string): string {
	if (code === "XK") return "🇽🇰";
	const upper = code.toUpperCase();
	if (!/^[A-Z]{2}$/.test(upper)) return "";
	return String.fromCodePoint(...[...upper].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** Canonical English names we display, overriding verbose Intl names. */
const PREFERRED_NAME: Record<string, string> = {
	XK: "Kosovo",
	HK: "Hong Kong",
	MO: "Macau",
	PS: "Palestine",
	CD: "DR Congo",
	CG: "Congo",
	MM: "Myanmar",
	BA: "Bosnia and Herzegovina",
	TT: "Trinidad and Tobago",
};

let index: Map<string, Place> | null = null;

function buildIndex(): Map<string, Place> {
	const map = new Map<string, Place>();
	const countryPlace = (code: string): Place => ({
		name: PREFERRED_NAME[code] ?? displayName(code),
		code,
		emoji: flagForCode(code),
		bloc: CODE_TO_BLOC.get(code),
		kind: "country",
	});
	for (const code of ALL_CODES) {
		const place = countryPlace(code);
		map.set(place.name.toLowerCase(), place);
		map.set(displayName(code).toLowerCase(), place);
		map.set(code.toLowerCase(), place);
	}
	for (const [alias, code] of Object.entries(COUNTRY_ALIASES)) {
		map.set(alias, countryPlace(code));
	}
	for (const region of REGIONS) {
		const place: Place = {
			name: region.name,
			emoji: region.emoji,
			bloc: region.bloc,
			kind: "region",
		};
		map.set(region.name.toLowerCase(), place);
		for (const alias of region.aliases) map.set(alias, place);
	}
	return map;
}

function lookup(key: string): Place | undefined {
	index ??= buildIndex();
	return index.get(key);
}

/**
 * Resolve a raw location label ("India", "Lagos, Nigeria", "South Asia") to a
 * Place. Unknown labels become a region-kind place with a neutral globe so they
 * can still be displayed and hidden by exact name.
 */
export function resolvePlace(raw: string | null | undefined): Place | null {
	const text = String(raw ?? "")
		.trim()
		.replace(/\s+/g, " ");
	if (!text) return null;
	const lower = text.toLowerCase();
	const direct = lookup(lower);
	if (direct) return direct;
	const last = lower.split(",").pop()?.trim() ?? "";
	// Two-letter tails like "Austin, TX" are US states, not ISO codes.
	if (last.length > 2) {
		const tail = lookup(last);
		if (tail) return tail;
	}
	return { name: text, emoji: "🌐", kind: "region" };
}

export function placeKey(place: Place | null): string {
	return place ? place.name.toLowerCase() : "";
}

export const BLOC_LABEL: Record<Bloc, string> = {
	"north-america": "North America",
	europe: "Europe",
	"latin-america": "Latin America",
	mena: "Middle East & North Africa",
	"sub-saharan-africa": "Africa",
	"south-asia": "South Asia",
	"east-asia-pacific": "East Asia & Pacific",
	cis: "Russia & Central Asia",
};
