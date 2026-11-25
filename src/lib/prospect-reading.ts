import { compareOptions } from "./research";

/**
 * Reading a found company's own site (email plan P5.2, D894). Pure.
 *
 * - **What only the site can tell.** The owner's words name things the register cannot filter by (*serves vegan food*, *sells online*):
 *   up to `CRITERIA_MAX` of them, each weighted 1 to 3, kept in the page's address beside the filters. Reading a site, the model scores each
 *   1 to 5 from the page alone; the fit is worked out in code (`compareOptions()`), never said by the model.
 * - **A company's door, never a person's.** The contact route is found in code: an address on the company's own domain whose name is a
 *   role (`post@`, `kontakt@`), never a named person's, never guessed from a pattern. Nothing the model writes may carry an address, a phone
 *   number or a link: `cleanReading()` drops them.
 */

export const CRITERIA_MAX = 4;
export const CRITERION_CHARS = 60;
export const DOES_CHARS = 220;

export type SiteCriterion = { name: string; weight: number };

const clip = (s: string, n: number) => s.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, n);

/** The owner's criteria from anything: named, weighted 1 to 3, none twice, at most `CRITERIA_MAX`. */
export function cleanCriteria(raw: unknown): SiteCriterion[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: SiteCriterion[] = [];
  for (const item of list) {
    const value = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const name = typeof value.name === "string" ? clip(value.name.replace(/[|~]/g, " "), CRITERION_CHARS) : "";
    const weight = Math.min(3, Math.max(1, Math.round(Number(value.weight) || 1)));
    if (name && !out.some((c) => c.name.toLowerCase() === name.toLowerCase())) out.push({ name, weight });
    if (out.length === CRITERIA_MAX) break;
  }
  return out;
}

/** Criteria in the address: `vegan food~3|sells online~2`. */
export const criteriaToQuery = (criteria: readonly SiteCriterion[]): string => criteria.map((c) => `${c.name}~${c.weight}`).join("|");

export const criteriaFromQuery = (value: string): SiteCriterion[] =>
  cleanCriteria(
    value
      .split("|")
      .filter(Boolean)
      .map((part) => {
        const at = part.lastIndexOf("~");
        return at > 0 ? { name: part.slice(0, at), weight: Number(part.slice(at + 1)) } : { name: part, weight: 1 };
      }),
  );

/** The names an address may have to be a company's door rather than a person's. */
export const ROLE_NAMES: readonly string[] = [
  "post", "postmottak", "firmapost", "info", "kontakt", "contact", "hei", "hello", "hallo", "mail", "office", "kontor",
  "salg", "sales", "booking", "bestilling", "order", "ordre", "kundeservice", "service", "support", "resepsjon",
];

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * The company's general addresses in a page's text: on its own domain (or a subdomain of it) and named as a role, folded to lower case,
 * at most two. A named person's address (`ola.nordmann@`) is never returned, whatever the page says about it.
 */
export function generalAddresses(text: string, domain: string): string[] {
  const own = domain.toLowerCase().replace(/^www\./, "");
  const found = new Set<string>();
  for (const match of text.matchAll(EMAIL)) {
    const address = match[0].toLowerCase().replace(/\.$/, "");
    const at = address.lastIndexOf("@");
    const name = address.slice(0, at);
    const host = address.slice(at + 1);
    if ((host === own || host.endsWith(`.${own}`)) && ROLE_NAMES.includes(name)) found.add(address);
    if (found.size === 2) break;
  }
  return [...found];
}

/** What the model may say back, in words: one sentence on what the company does, with nothing in it to write to or follow. */
export function plainSentence(raw: unknown, max = DOES_CHARS): string {
  if (typeof raw !== "string") return "";
  const cleaned = raw
    .replace(EMAIL, "")
    .replace(/\bhttps?:\/\/\S+/gi, "")
    .replace(/\bwww\.\S+/gi, "")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "")
    .replace(/[<>]/g, "");
  return clip(cleaned, max);
}

export type SiteReading = {
  does: string;
  /** Each criterion's score, 1 to 5, as the model gave it from the page. */
  scores: Record<string, number>;
  /** The weighted fit, 0 to 100, worked out in code; null with no criteria. */
  fit: number | null;
};

/** The model's answer made safe and scored: a sentence, a score per criterion (a missing or odd one is 1), and the fit in code. */
export function cleanReading(raw: unknown, criteria: readonly SiteCriterion[]): SiteReading {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const given = (value.scores && typeof value.scores === "object" ? value.scores : {}) as Record<string, unknown>;
  const byName = new Map(Object.entries(given).map(([k, v]) => [k.trim().toLowerCase(), v]));
  const scores: Record<string, number> = {};
  for (const c of criteria) {
    const n = Number(byName.get(c.name.toLowerCase()));
    scores[c.name] = Number.isInteger(n) && n >= 1 && n <= 5 ? n : 1;
  }
  let fit: number | null = null;
  if (criteria.length > 0) {
    const compared = compareOptions({ criteria: [...criteria], options: [{ name: "site", scores, reason: "" }] });
    fit = compared.ok ? compared.comparison.options[0].percent : null;
  }
  return { does: plainSentence(value.does), scores, fit };
}
