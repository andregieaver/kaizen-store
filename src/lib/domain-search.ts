/**
 * The pure parts of domain search (D315, `docs/domains.md` 4.2): which names a search asks about, and the shape of an answer. No zod, so the
 * public *Domain search* component's browser part can use it (D211).
 */

/** The endings a search suggests first when nothing else is said: generic ones Vercel sells today. A store's own country's comes with phase 5. */
export const SUGGESTED_TLDS = ["com", "shop", "store", "net", "online"] as const;

/** At most this many names are asked about in one search. */
export const SEARCH_NAMES_MAX = 12;

export type OfferState = "available" | "taken" | "premium" | "not_sold" | "yours";

/** One name's answer: whether it can be bought, and what it costs a year in minor units (the first year and each renewal), when free. */
export type DomainOffer = { domain: string; state: OfferState; firstYear: number | null; renewal: number | null };

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const TLD = /^[a-z][a-z0-9-]{1,62}(\.[a-z][a-z0-9-]{1,62})?$/;

/** A name as a person types it, made into one label: lower case, spaces and other characters as nothing, Nordic letters spelled out. */
export function labelOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

/**
 * The names to ask about for a search: what was typed (`nordisk butikk`, `nordiskbutikk.shop`, `https://www.nordiskbutikk.no/`), as the
 * exact name when it has an ending, then the same label under each suggested ending. At most `SEARCH_NAMES_MAX`, no repeats.
 */
export function searchNames(query: string, tlds: readonly string[]): string[] {
  const text = query.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#\s]/)[0] ?? "";
  const typed = query.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "");
  const dot = text.indexOf(".");
  const label = labelOf(dot > 0 ? text.slice(0, dot) : typed);
  if (!label || !LABEL.test(label)) return [];
  const names: string[] = [];
  if (dot > 0) {
    const tld = text.slice(dot + 1).replace(/\.$/, "");
    if (TLD.test(tld)) names.push(`${label}.${tld}`);
  }
  for (const tld of tlds) {
    const t = tld.toLowerCase().replace(/^\./, "");
    if (TLD.test(t)) names.push(`${label}.${t}`);
  }
  return [...new Set(names)].slice(0, SEARCH_NAMES_MAX);
}

/** A search's answer: the names and their offers in `currency`, or why there is none. */
export type SearchAnswer =
  | { ok: true; offers: DomainOffer[]; currency: string | null }
  | { ok: false; reason: "limit" | "empty" | "unavailable"; message: string };
