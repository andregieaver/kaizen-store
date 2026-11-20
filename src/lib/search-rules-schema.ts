import { z } from "zod";

import { normalizeQuery } from "./search";
import { QUERIES_MAX, QUERY_MAX, RULE_ACTIONS, RULE_MATCHES, type RuleInput, type RuleProblem } from "./search-rules";

/**
 * The schemas of search-rules.ts (bloat review step 2.46), apart from its constants and helpers, so a screen that only reads a constant
 * or a helper loads no zod. Import this file only where a schema runs; search-rules.ts imports it as a type alone.
 */

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
