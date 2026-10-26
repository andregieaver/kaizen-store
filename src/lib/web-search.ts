/**
 * Web search for the AI's research (D329, `docs/ai-autopilot.md` 13.1): the search APIs by shape, the request each takes and the reader
 * of its answers, pure so a recorded answer can be tested. A new service is an entry of `SEARCH_APIS` with its `request` and `parse`,
 * never a call written elsewhere; its key is the platform's (`commerce.search_settings`), never in code.
 */

export const SEARCH_API_IDS = ["brave"] as const;
export type SearchApiId = (typeof SEARCH_API_IDS)[number];

/** Searches a store's AI may make in 24 hours. */
export const SEARCHES_PER_DAY = 100;
/** Results a search answers with at most. */
export const SEARCH_RESULTS_MAX = 10;
/** The longest a search's words may be. */
export const QUERY_MAX = 300;
/** The model's name a search is recorded under in `ai_usage` (one price per service, `per_thousand_searches`). */
export const SEARCH_MODEL = "web-search";

export const FRESHNESS = ["any", "day", "week", "month", "year"] as const;
export type Freshness = (typeof FRESHNESS)[number];

export type SearchQuery = {
  query: string;
  count: number;
  /** A two-letter country to prefer results from, or none. */
  country?: string | null;
  freshness?: Freshness;
};

export type SearchResult = { title: string; url: string; snippet: string; age: string | null };

export type SearchRequest = { url: string; headers: Record<string, string> };

export type SearchApi = {
  name: string;
  /** Where to get a key, for the settings card. */
  keyUrl: string;
  /** Who it is and where it processes searches, said on the settings card. */
  where: string;
  request: (q: SearchQuery, apiKey: string) => SearchRequest;
  parse: (body: unknown) => SearchResult[] | null;
};

const BRAVE_FRESHNESS: Record<Freshness, string | null> = { any: null, day: "pd", week: "pw", month: "pm", year: "py" };

export const SEARCH_APIS: Record<SearchApiId, SearchApi> = {
  brave: {
    name: "Brave Search",
    keyUrl: "https://api-dashboard.search.brave.com/",
    where: "A US company: a search sends only the words the AI chose, never a customer's data or the store's figures.",
    request: (q, apiKey) => {
      const params = new URLSearchParams({ q: q.query, count: String(q.count), safesearch: "moderate", text_decorations: "false" });
      if (q.country) params.set("country", q.country.toLowerCase());
      const fresh = BRAVE_FRESHNESS[q.freshness ?? "any"];
      if (fresh) params.set("freshness", fresh);
      return {
        url: `https://api.search.brave.com/res/v1/web/search?${params.toString()}`,
        headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
      };
    },
    parse: parseBraveResults,
  },
};

/** The one host each service is reached at: a request elsewhere is refused (`searchHostOk()`). */
export const SEARCH_HOSTS: Record<SearchApiId, string> = { brave: "api.search.brave.com" };

export const searchHostOk = (id: SearchApiId, url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === SEARCH_HOSTS[id];
  } catch {
    return false;
  }
};

const text = (value: unknown, max: number): string =>
  typeof value === "string"
    ? value
        .replace(/<[^>]*>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";

/** Brave's web results as title, address, snippet and age; null when the answer is not one Brave gives. Only http(s) addresses are kept. */
export function parseBraveResults(body: unknown): SearchResult[] | null {
  if (!body || typeof body !== "object") return null;
  const web = (body as { web?: unknown }).web;
  if (web === undefined) return (body as { type?: unknown }).type === "search" ? [] : null;
  const results = (web as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return null;
  const out: SearchResult[] = [];
  for (const r of results) {
    if (!r || typeof r !== "object") continue;
    const row = r as Record<string, unknown>;
    const url = typeof row.url === "string" ? row.url : "";
    if (!/^https?:\/\//i.test(url) || url.length > 2000) continue;
    out.push({ title: text(row.title, 300) || url, url, snippet: text(row.description, 600), age: text(row.age ?? row.page_age, 40) || null });
    if (out.length >= SEARCH_RESULTS_MAX) break;
  }
  return out;
}
