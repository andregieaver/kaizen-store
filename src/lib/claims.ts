/**
 * The claims filter (Phase 2, S4, D76): phrases AI-written product copy
 * must not carry, in the stores' languages. Pure and shared with the
 * browser, so a suggestion is checked again as staff edit it.
 *
 * - `green`: generic environmental claims ("miljøvennlig", "sustainable",
 *   "klimanøytral"), which the Empowering Consumers Directive (ECGT, from
 *   27 September 2026) bans unless backed by recognised excellent
 *   environmental performance, which a text model cannot know.
 * - `urgency`: false urgency and scarcity ("kun i dag", "only 3 left").
 * - `bestPrice`: best- or lowest-price claims ("beste pris", "cheapest").
 * - `price` and `stock`: amounts of money and stock levels, which only the
 *   catalogue may state (grounding: the model is never given them).
 *
 * Words are matched whole, with their endings ("miljøvennlige"), so
 * "grønnsaker" is not "grønn". A list, not a judgement: staff remove what
 * it finds before a suggestion can be used.
 */

export type ClaimKind = "green" | "urgency" | "bestPrice" | "price" | "stock";

export type ClaimFinding = { kind: ClaimKind; phrase: string; index: number };

export const CLAIM_LABELS: Record<ClaimKind, string> = {
  green: "Generic environmental claim",
  urgency: "Urgency or scarcity",
  bestPrice: "Best or lowest price claim",
  price: "An amount of money",
  stock: "Stock level",
};

/** Stems whose endings may vary (`\p{L}*` after them), per kind. */
const STEMS: Record<Exclude<ClaimKind, "price">, string[]> = {
  green: [
    // Norwegian, Swedish, Danish
    "miljøvennlig", "miljövänlig", "miljøvenlig", "miljøbevisst", "miljömedveten", "miljøbevidst",
    "bærekraftig", "hållbar", "bæredygtig", "klimanøytral", "klimatneutral", "klimaneutral",
    "klimavennlig", "klimatsmart", "klimavenlig", "co2-nøytral", "co2-neutral", "karbonnøytral", "kolneutral",
    "naturvennlig", "naturvänlig", "økovennlig", "ekovänlig",
    // English, German
    "eco-friendly", "ecofriendly", "eco friendly", "environmentally friendly", "environment-friendly",
    "sustainable", "sustainably", "climate neutral", "climate-neutral", "carbon neutral", "carbon-neutral",
    "planet-friendly", "planet friendly", "earth-friendly", "umweltfreundlich", "nachhaltig", "klimafreundlich",
  ],
  urgency: [
    "kun i dag", "bare i dag", "endast idag", "endast i dag", "kun i dag", "kun få igjen", "bare få igjen", "få igjen",
    "begrenset antall", "begränsat antal", "begrænset antal", "skynd deg", "skynda dig", "skynd dig",
    "siste sjanse", "sista chansen", "sidste chance", "før det er for sent", "innan det är för sent",
    "only today", "today only", "limited stock", "limited time", "hurry", "last chance", "selling fast",
    "while stocks last", "don't miss out", "act now", "nur heute", "solange der vorrat reicht",
  ],
  bestPrice: [
    "beste pris", "bästa pris", "bedste pris", "laveste pris", "lägsta pris", "lavest pris", "laveste pris",
    "billigste", "billigaste", "billigst", "prisgaranti", "prisgarantie", "ingen slår", "slår alle",
    "best price", "lowest price", "cheapest", "unbeatable price", "price match", "bester preis", "günstigste",
  ],
  stock: [
    "på lager", "i lager", "på lager nå", "utsolgt", "slutsåld", "udsolgt", "in stock", "sold out",
    "out of stock", "auf lager", "ausverkauft",
  ],
};

/**
 * Short words matched with only their own inflections, not as the start of
 * longer words: "grønn" is a claim (and a colour, which staff judge), but
 * "grønnsaker" and "Greenland" are not.
 */
const WORDS: { kind: ClaimKind; words: string[] }[] = [
  { kind: "green", words: ["grønne?", "grønt", "grön(?:a|t)?", "grøn(?:ne|t)?", "green(?:er)?", "grün(?:e|er|es)?"] },
];

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");

/** Whole words: no letter or digit just before; the stem's own endings allowed after. */
const PATTERNS: { kind: ClaimKind; pattern: RegExp; colour?: true }[] = [
  ...(Object.entries(STEMS) as [Exclude<ClaimKind, "price">, string[]][]).map(([kind, stems]) => ({
    kind,
    pattern: new RegExp(`(?<![\\p{L}\\p{N}])(?:${[...new Set(stems)].map(escape).join("|")})\\p{L}*`, "giu"),
  })),
  ...WORDS.map(({ kind, words }) => ({
    kind,
    pattern: new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.join("|")})(?![\\p{L}\\p{N}])`, "giu"),
    colour: true as const,
  })),
  // "Only 3 left", "bare 2 igjen", "endast 5 kvar", "kun 4 tilbage".
  { kind: "urgency", pattern: /(?<![\p{L}\p{N}])(?:only|bare|kun|endast|nur)\s+\d+\s+(?:left|igjen|kvar|tilbage|übrig)(?![\p{L}\p{N}])/giu },
  // Money: 299 kr, kr 299, NOK 1 299,-, €45, 45 EUR, 12,95 €.
  {
    kind: "price",
    pattern: /(?:(?<![\p{L}\p{N}])(?:kr|nok|sek|dkk|eur|€|\$|£)\.?\s?\d[\d\s.]*(?:,\d+)?(?:,-)?|\d[\d\s.]*(?:,\d+)?\s?(?:kr|kroner|kronor|nok|sek|dkk|eur|euro|€|\$|£)(?![\p{L}\p{N}]))/giu,
  },
];

/** Every phrase the filter finds, in the order they come. */
export function findClaims(text: string, options: { colours?: boolean } = {}): ClaimFinding[] {
  const found: ClaimFinding[] = [];
  for (const { kind, pattern, colour } of PATTERNS) {
    // A picture's alt text (D89) names its colours: "a green lamp" says what it looks like.
    if (colour && options.colours === false) continue;
    for (const match of text.matchAll(pattern)) {
      found.push({ kind, phrase: match[0].trim(), index: match.index ?? 0 });
    }
  }
  // One finding per place: a longer phrase wins over a shorter one inside it.
  return found
    .sort((a, b) => a.index - b.index || b.phrase.length - a.phrase.length)
    .filter((f, i, all) => !all.slice(0, i).some((g) => f.index >= g.index && f.index < g.index + g.phrase.length));
}
