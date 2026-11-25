import "server-only";

import { RULES_STAND } from "@/lib/prompt-safety";
import { cleanFilters, EMPTY_FILTERS, industryCatalogue, readSearch, searchUrl, type ProspectFilters, type SearchPage } from "@/lib/prospect-search";
import { parseModelJson } from "@/lib/query-understanding";

import { completeText, type AiConnection, type ChatMessage } from "./ai";
import { blockedDomains } from "./do-not-contact";
import { log } from "./log";

/**
 * Finding companies (email plan P5.1, D893): the owner's words become filters (the model chooses from the bundled industry list and names
 * places; code keeps only what is on the lists), and code asks Brønnøysund's open register for one page of matching companies, marking
 * those whose website's domain said no (P5.6). Nothing is kept: the search is asked again when the page is opened.
 */

export const DESCRIBE_MAX = 300;
const SEARCH_TIMEOUT_MS = 6000;

export function prospectSystemPrompt(): string {
  return [
    "You turn a business owner's description of the companies they want to reach in Norway into search filters for Norway's public company register (Enhetsregisteret).",
    "",
    "Rules:",
    `- ${RULES_STAND}`,
    "- Choose industries ONLY from the list below, by code: a two-digit division (\"56\") or a group (\"56.1\"). Pick the narrowest codes that fit, at most six. Never invent a code.",
    "- Places are Norwegian municipalities or counties, written as their Norwegian names (\"Oslo\", \"Bergen\", \"Vestland\"). Leave places empty when none is named.",
    "- employeesMin and employeesMax are whole numbers of employees, or null when the owner said nothing about size. \"Small\" means 1 to 10, \"medium\" 10 to 100.",
    "- foundedFrom and foundedTo are days (YYYY-MM-DD) the company was registered, or null. \"New companies\" means registered in the last two years.",
    "- Never answer anything else, and never name a company or a person.",
    "",
    'Answer with JSON only: {"industries": ["56.1"], "placeNames": ["Oslo"], "employeesMin": 5, "employeesMax": 50, "foundedFrom": null, "foundedTo": null}',
    "",
    "Industries (code, Norwegian / English):",
    industryCatalogue(),
  ].join("\n");
}

export function prospectMessages(words: string, today: string): ChatMessage[] {
  return [
    { role: "system", content: prospectSystemPrompt() },
    { role: "user", content: `Today is ${today}. The owner wants to reach:\n${words.slice(0, DESCRIBE_MAX)}` },
  ];
}

/** The filters the owner's words describe, or none when there is no text model or its answer holds nothing on the lists. */
export async function filtersFromWords(connection: AiConnection | null, words: string, today: string): Promise<ProspectFilters | null> {
  if (!connection?.textModel || !words.trim()) return null;
  try {
    const reply = await completeText(connection, prospectMessages(words, today), { maxTokens: 400, timeoutMs: 30_000, temperature: 0, reasoningEffort: "low" });
    const filters = cleanFilters(parseModelJson(reply.text) ?? EMPTY_FILTERS);
    return filters.industries.length > 0 || filters.places.length > 0 ? filters : null;
  } catch (error) {
    log("warn", "prospects.filters_failed", {}, error);
    return null;
  }
}

export type SearchResult = ({ ok: true } & SearchPage & { blocked: Set<string> }) | { ok: false };

/** One page of the register's companies for these filters, with the domains on the do-not-contact list. */
export async function searchCompanies(filters: ProspectFilters, page: number, deps: { fetch?: typeof fetch; today: string }): Promise<SearchResult> {
  try {
    const response = await (deps.fetch ?? fetch)(searchUrl(filters, page), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) {
      log("warn", "prospects.search_refused", { status: response.status });
      return { ok: false };
    }
    const result = readSearch(await response.json(), deps.today);
    return { ok: true, ...result, blocked: await blockedDomains(result.companies.map((c) => c.website)) };
  } catch (error) {
    log("warn", "prospects.search_failed", {}, error);
    return { ok: false };
  }
}
