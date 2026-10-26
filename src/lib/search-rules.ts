import { z } from "zod";

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

/** The shape a rule arrives in, before it is checked (`readRule()`); the target is read against the store by the server. */
export const searchRuleInput = z.object({
  id: z.uuid().nullable().default(null),
  action: z.enum(RULE_ACTIONS),
  productId: z.uuid().nullable().default(null),
  termId: z.uuid().nullable().default(null),
  target: z.string().max(2_100).nullable().default(null),
  queries: z.array(z.string().max(200)).max(QUERIES_MAX * 2).default([]),
  match: z.enum(RULE_MATCHES).default("contains"),
  position: z.number().int().min(0).max(1000).default(0),
});

export type RuleInput = Omit<SearchRule, "id"> & { id: string | null };

export type RuleProblem =
  | { code: "shape" }
  | { code: "query"; query: string }
  | { code: "queries_needed" }
  | { code: "queries_max" }
  | { code: "product_needed" }
  | { code: "subject_needed" }
  | { code: "target_needed" };

/**
 * A rule as typed, checked: searches kept as a search reads them, once each, at most `QUERIES_MAX`; a pin names a product and at least one
 * search, a boost or bury a product or a category or tag (one of them), a redirect a target and at least one search. What does not belong to
 * the action is dropped.
 */
export function readRule(raw: unknown): { ok: true; value: RuleInput } | { ok: false; problems: RuleProblem[] } {
  const parsed = searchRuleInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: [{ code: "shape" }] };
  const input = parsed.data;
  const problems: RuleProblem[] = [];
  const queries: string[] = [];
  for (const typed of input.queries) {
    if (typed.trim() === "") continue;
    const query = normalizeQuery(typed);
    // A search is cut to `QUERY_MAX` when read, so a longer one could never be met.
    if (query === "" || typed.replace(/\s+/g, " ").trim().length > QUERY_MAX) problems.push({ code: "query", query: typed.trim().slice(0, 40) });
    else if (!queries.includes(query)) queries.push(query);
  }
  if (queries.length > QUERIES_MAX) problems.push({ code: "queries_max" });
  const { action } = input;
  const target = input.target?.trim() || null;
  if ((action === "pin" || action === "redirect") && queries.length === 0) problems.push({ code: "queries_needed" });
  if (action === "pin" && !input.productId) problems.push({ code: "product_needed" });
  if ((action === "boost" || action === "bury") && !input.productId && !input.termId) problems.push({ code: "subject_needed" });
  if (action === "redirect" && !target) problems.push({ code: "target_needed" });
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    value: {
      id: input.id,
      action,
      // A pin is a product's; a boost or bury names a product, else its category or tag; a redirect neither.
      productId: action === "redirect" ? null : input.productId,
      termId: action === "boost" || action === "bury" ? (input.productId ? null : input.termId) : null,
      target: action === "redirect" ? target : null,
      queries,
      match: input.match,
      position: action === "pin" ? input.position : 0,
    },
  };
}

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

/** Whether any rule a search met changes its order (so the catalogue's read is asked for the merchandised order). */
export const changesOrder = (rules: readonly SearchRule[]) => rules.some((rule) => rule.action !== "redirect");
