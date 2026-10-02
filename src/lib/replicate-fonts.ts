/**
 * Which Google Fonts family stands in for a typeface a copied page uses (D150). A page's own family is tried first; then
 * the same name without the words a foundry adds to a file ("Inter var" is Inter); then, for the well-known commercial
 * families, the nearest look-alike. The owner is told which one was used and why, so a stand-in is never taken for the original.
 */

export type FontCandidate = { name: string; kind: "same" | "cleaned" | "lookalike" };

/** Words a font file's name carries that the family's own name does not. */
const FILE_WORDS = /\s+(?:var|variable|vf|pro|std|web|ui|new|regular|text\s+vf)$/i;

/** The nearest Google family to a commercial one, by how the letters look (lowercase keys). */
export const LOOKALIKES: Record<string, string> = {
  "proxima nova": "Montserrat",
  gotham: "Montserrat",
  "gotham rounded": "Nunito",
  avenir: "Nunito Sans",
  "avenir next": "Nunito Sans",
  futura: "Jost",
  "futura pt": "Jost",
  garamond: "EB Garamond",
  "adobe garamond": "EB Garamond",
  "garamond premier": "EB Garamond",
  baskerville: "Libre Baskerville",
  caslon: "Libre Caslon Text",
  "adobe caslon": "Libre Caslon Text",
  "galaxie copernicus": "Source Serif 4",
  copernicus: "Source Serif 4",
  "freight text": "Source Serif 4",
  "freight display": "Newsreader",
  tiempos: "Newsreader",
  "tiempos text": "Newsreader",
  "minion pro": "Crimson Pro",
  minion: "Crimson Pro",
  "myriad pro": "Source Sans 3",
  myriad: "Source Sans 3",
  frutiger: "Open Sans",
  graphik: "Inter",
  akkurat: "Inter",
  "sf pro": "Inter",
  "sf pro text": "Inter",
  "sf pro display": "Inter",
  "helvetica neue": "Inter",
  circular: "DM Sans",
  "circular std": "DM Sans",
  "circular pro": "DM Sans",
  "euclid circular": "DM Sans",
  "sofia pro": "Nunito",
  din: "Barlow",
  "din next": "Barlow",
  "din pro": "Barlow",
  "gt walsheim": "Poppins",
  "brandon grotesque": "Montserrat",
  "museo sans": "Nunito Sans",
  "lato web": "Lato",
};

/** A family's name as a foundry's file words come off it: "Inter var" → "Inter". */
export function cleanedFamily(family: string): string {
  let name = family.trim().replace(/["']/g, "");
  for (let i = 0; i < 3; i++) name = name.replace(FILE_WORDS, "").trim();
  return name.replace(/\s+\d+$/, "").trim();
}

/** The families to try for one a page uses, in order, without repeats. */
export function fontCandidates(family: string): FontCandidate[] {
  const out: FontCandidate[] = [];
  const seen = new Set<string>();
  const add = (name: string | undefined, kind: FontCandidate["kind"]) => {
    if (!name || seen.has(name.toLowerCase())) return;
    seen.add(name.toLowerCase());
    out.push({ name, kind });
  };
  add(family.trim(), "same");
  const cleaned = cleanedFamily(family);
  add(cleaned, "cleaned");
  add(LOOKALIKES[family.trim().toLowerCase()], "lookalike");
  add(LOOKALIKES[cleaned.toLowerCase()], "lookalike");
  return out;
}

/** How an installed family relates to the one the page asked for. */
export function fontRelation(wanted: string, installed: string): FontCandidate["kind"] {
  if (installed.toLowerCase() === wanted.trim().toLowerCase()) return "same";
  if (installed.toLowerCase() === cleanedFamily(wanted).toLowerCase()) return "cleaned";
  return "lookalike";
}

/** A font stack that ends in the kind of face it is, so a missing family falls back to a sans or a serif, not the browser's default serif. */
export function withGeneric(stack: string): string {
  return /\b(sans-serif|serif|monospace|cursive|fantasy|system-ui)\s*$/i.test(stack.trim()) ? stack : `${stack}, ${/serif/i.test(stack) && !/sans/i.test(stack) ? "serif" : "sans-serif"}`;
}

/** The `font-family` value for a typeface that is not installed: the page's own name, then the kind of face it is, so a missing one falls back to a sans or a serif as the original would, not to the browser's default serif. */
export function fallbackStack(stack: string): string {
  const generic = /\b(sans-serif|serif|monospace|cursive|fantasy|system-ui)\b/i.exec(stack.split(",").slice(1).join(","));
  const first = stack.split(",")[0]?.trim() ?? "";
  const kind = generic ? generic[1].toLowerCase() : /serif/i.test(first) && !/sans/i.test(first) ? "serif" : "sans-serif";
  return first ? `${first}, ${kind}` : kind;
}
