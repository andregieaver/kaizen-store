import { normalizeQuery } from "./search";
import { holdsWords } from "./search-synonyms";

/**
 * A store's search merchandising (wave 6 unit F2, D324, `docs/wave-6-catalogue.md` F.2), the parts that need no database: the editor's check
 * (`readRule()`), which rules a search meets (`rulesFor()`), the order they give (`merchandise()`) and where a search is sent (`searchRedirect()`).
 */

export const RULE_ACTIONS = ["pin", "boost", "bury", "redirect"] as const;
export type RuleAction = (typeof RULE_ACTIONS)[number];

export const RULE_MATCHES = ["contains", "exact"] as const;
export type RuleMatch = (typeof RULE_MATCHES)[number];

/** The most rules a store keeps. */
export const RULES_MAX = 200;
/** The most searches one rule is for. */
export const QUERIES_MAX = 20;
/** The longest search a rule names, as a logged search is kept. */
export const QUERY_MAX = 100;

export type SearchRule = {
  id: string;
  action: RuleAction;
  productId: string | null;
  termId: string | null;
  target: string | null;
  queries: string[];
  match: RuleMatch;
  position: number;
};

export type RuleInput = Omit<SearchRule, "id"> & { id: string | null };

export type RuleProblem =
  | { code: "shape" }
  | { code: "query"; query: string }
  | { code: "queries_needed" }
  | { code: "queries_max" }
  | { code: "product_needed" }
  | { code: "subject_needed" }
  | { code: "target_needed" };

/** Whether a rule is for a search: every search when it names none, else one it holds as whole words (`contains`) or is (`exact`). */
export function ruleApplies(rule: Pick<SearchRule, "queries" | "match">, query: string): boolean {
  const text = normalizeQuery(query);
  if (rule.queries.length === 0) return true;
  return rule.queries.some((q) => (rule.match === "exact" ? text === q : holdsWords(text, q)));
}

/** The rules a search meets, in the store's order (position, then as saved). */
export function rulesFor<R extends Pick<SearchRule, "queries" | "match">>(rules: readonly R[], query: string): R[] {
  return rules.filter((rule) => ruleApplies(rule, query));
}

/** Where a search goes instead of its results: the first redirect it meets, an exact match before one it holds, else null. */
export function searchRedirect(rules: readonly SearchRule[], query: string): string | null {
  const met = rulesFor(
    rules.filter((rule) => rule.action === "redirect"),
    query,
  );
  const exact = met.find((rule) => rule.match === "exact");
  return (exact ?? met[0])?.target ?? null;
}

export type MerchandiseFacts = {
  /** Whether a product of the results is in a category or tag (as the catalogue reads it, `inTerms()`). */
  inTerm: (productId: string, termId: string) => boolean;
  /** Whether pinned products the search did not find may be added: only for a search with no filters. */
  addPins: boolean;
};

/**
 * The results in the store's order: the pinned products first in their order (one the search did not find only when `addPins`; the
 * catalogue's read then leaves out what is not offered), then the boosted, then the rest, then the buried, each group keeping the search's own
 * order. A product both boosted and buried stays where it was. `rules` are the ones the search met (`rulesFor()`).
 */
export function merchandise(ids: readonly string[], rules: readonly SearchRule[], facts: MerchandiseFacts): string[] {
  const found = new Set(ids);
  const pinned: string[] = [];
  for (const rule of [...rules].filter((r) => r.action === "pin").sort((a, b) => a.position - b.position)) {
    const id = rule.productId;
    if (!id || pinned.includes(id)) continue;
    if (found.has(id) || facts.addPins) pinned.push(id);
  }
  const touches = (action: "boost" | "bury", id: string) =>
    rules.some((rule) => rule.action === action && (rule.productId === id || (rule.termId !== null && facts.inTerm(id, rule.termId))));
  const up: string[] = [];
  const middle: string[] = [];
  const down: string[] = [];
  for (const id of ids) {
    if (pinned.includes(id)) continue;
    const boosted = touches("boost", id);
    const buried = touches("bury", id);
    if (boosted && !buried) up.push(id);
    else if (buried && !boosted) down.push(id);
    else middle.push(id);
  }
  return [...pinned, ...up, ...middle, ...down];
}

