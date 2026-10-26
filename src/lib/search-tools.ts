import type { RuleProblem, SearchRule } from "./search-rules";
import type { SynonymProblem } from "./search-synonyms";

/**
 * What the AI manager's search tools (wave 6 unit F3, D324, `docs/wave-6-catalogue.md` F.3) say that needs no database: a rule as a sentence,
 * the writers' refusals in words, and the words of a change kept for the owner's yes. Written in code from the rule, never by the model.
 */

export const SEARCH_TOOLS = ["search_merchandising", "save_search_synonym", "save_search_rule", "delete_search_merchandising"] as const;

type Named = Pick<SearchRule, "action" | "target" | "queries" | "match"> & { productTitle: string | null; termName: string | null; termKind: string | null };

const quoted = (queries: readonly string[]) => queries.map((q) => `"${q}"`).join(", ");

/** For which searches: every one, those holding one of the phrases, or exactly one of them. */
export function searchesWords(queries: readonly string[], match: SearchRule["match"]): string {
  if (queries.length === 0) return "in every search";
  return match === "exact" ? `for exactly ${quoted(queries)}` : `for searches containing ${quoted(queries)}`;
}

/** The searches a redirect sends on: "the search "sale"" or "searches containing "sale"". */
const sentSearches = (queries: readonly string[], match: SearchRule["match"]) =>
  match === "exact" ? `the search${queries.length > 1 ? "es" : ""} ${quoted(queries)}` : `searches containing ${quoted(queries)}`;

/** A rule in a sentence: "Put "Oak table" first for searches containing "table"". */
export function ruleSentence(rule: Named): string {
  const subject = rule.productTitle !== null ? `"${rule.productTitle}"` : rule.termName !== null ? `the ${rule.termKind ?? "category"} "${rule.termName}"` : "something no longer in the store";
  const searches = searchesWords(rule.queries, rule.match);
  switch (rule.action) {
    case "pin":
      return `Put ${subject} first ${searches}.`;
    case "boost":
      return `Move ${subject} up ${searches}.`;
    case "bury":
      return `Move ${subject} down ${searches}.`;
    case "redirect":
      return `Send ${sentSearches(rule.queries, rule.match)} to ${rule.target ?? "a page"}.`;
  }
}

const SYNONYM_PROBLEMS: Record<Exclude<SynonymProblem["code"], "word"> | "locale" | "gone" | "max", string> = {
  shape: "The synonyms could not be read.",
  both_count: "A two-way group has 2 to 20 words.",
  one_way_words: "A one-way group has 1 to 20 words.",
  one_way_means: "A one-way group finds 1 to 20 other words (`means`).",
  self: "A word cannot also find itself.",
  locale: "That is not one of the store's languages: use one of `languages` from search_merchandising.",
  gone: "That synonym is gone: read search_merchandising again.",
  max: "The store has the most synonyms it can keep (500): remove one first.",
};

/** A synonym writer's refusals in a sentence for the model to repeat. */
export function synonymProblemWords(problems: readonly (SynonymProblem | { code: "locale" | "gone" | "max" })[]): string {
  return problems
    .map((problem) => (problem.code === "word" ? `"${(problem as { word: string }).word}" cannot be a synonym: letters, digits, spaces, hyphens and apostrophes only, at most 60 characters.` : SYNONYM_PROBLEMS[problem.code]))
    .filter((line, i, all) => all.indexOf(line) === i)
    .join(" ");
}

type RuleRefusal = RuleProblem | { code: "product" | "term" | "gone" | "max" } | { code: "target"; reason: string };

const RULE_PROBLEMS: Record<Exclude<RuleRefusal["code"], "query">, string> = {
  shape: "The rule could not be read.",
  queries_needed: "Name at least one search the rule is for.",
  queries_max: "A rule is for at most 20 searches.",
  product_needed: "Name the product to put first (its handle).",
  subject_needed: "Name a product (its handle), or a category or tag (its slug).",
  target_needed: "Name the page to send the search to.",
  product: "That product is not the store's.",
  term: "That category or tag is not the store's.",
  target: "That address cannot be a page of the store: give a path on the store such as /category/sofas.",
  gone: "That rule is gone: read search_merchandising again.",
  max: "The store has the most search rules it can keep (200): remove one first.",
};

/** A rule writer's refusals in a sentence for the model to repeat. */
export function ruleProblemWords(problems: readonly RuleRefusal[]): string {
  return problems
    .map((problem) => (problem.code === "query" ? `"${problem.query}" is too long for a search (at most 100 characters).` : RULE_PROBLEMS[problem.code]))
    .filter((line, i, all) => all.indexOf(line) === i)
    .join(" ");
}

/** What a kept search change will do, from its arguments, for the owner's yes. */
export function searchApprovalSummary(name: string, input: Record<string, unknown>): string {
  const list = (key: string) => (Array.isArray(input[key]) ? (input[key] as unknown[]).map(String) : []);
  const text = (key: string) => String(input[key] ?? "");
  if (name === "save_search_synonym") {
    const words = list("words");
    const what = input.kind === "one_way" ? `${quoted(words)} also find ${quoted(list("means"))}` : `${quoted(words)} find each other`;
    return `${input.id ? "Change synonyms" : "Add synonyms"} in ${text("language")}: searches for ${what}.`;
  }
  if (name === "save_search_rule") {
    const subject = input.product ? `the product ${text("product")}` : input.category ? `the category ${text("category")}` : input.tag ? `the tag ${text("tag")}` : "";
    const searches = searchesWords(list("searches"), input.match === "exact" ? "exact" : "contains");
    const what =
      input.action === "pin"
        ? `put ${subject} first ${searches}`
        : input.action === "redirect"
          ? `send ${sentSearches(list("searches"), input.match === "exact" ? "exact" : "contains")} to ${text("page")}`
          : `move ${subject} ${input.action === "bury" ? "down" : "up"} ${searches}`;
    return `${input.id ? "Change a search rule" : "Add a search rule"}: ${what}.`;
  }
  if (name === "delete_search_merchandising") return input.synonym ? `Remove the synonyms ${text("synonym")} from the store's search.` : `Remove the search rule ${text("rule")}.`;
  return "";
}
