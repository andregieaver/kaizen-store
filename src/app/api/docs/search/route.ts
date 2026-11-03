import { connection } from "next/server";

import { readDocsSearch } from "@/lib/docs-search-rules";
import { searchDocs } from "@/server/docs-search";
import { log } from "@/server/log";
import { budgetVisitor, takeBudget } from "@/server/request-budget";

const answer = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

/**
 * The docs' search (wave 14 unit E3, D443): `GET ?q=&track=&kind=&area=&lang=&section=&sort=&cursor=`, answering a page of 20 documents with
 * their snippets, every filter's counts and the next page's cursor (`DocsSearchAnswer`). Filters take comma-separated values; an unknown value
 * or order is left out, a cursor that is not one is a 400. Public, as the docs are, and the same on every host (the dialog asks it on
 * whichever host serves the page).
 *
 * No same-site rule: it is a read that changes nothing, as the neighbouring public reads are (the domain search, D315; *Show more reviews*;
 * the storefront and shopping agents' APIs), and the docs are meant to be searched by tools too (the guide of unit E5, an AI tool reading
 * `llms.txt`). A search that found nothing is counted for the gap list by its own POST (`/api/docs/search/miss`), which is same-site. Budgeted
 * per visitor (a daily hash of the address) and for the whole site (`docs_search`); a count that fails refuses, as each search may ask the
 * platform's AI for its words' vector.
 */
export async function GET(request: Request): Promise<Response> {
  await connection();
  if (!(await takeBudget(null, "docs_search", budgetVisitor(request.headers)))) {
    return answer(429, { error: "Too many searches. Try again in a minute." }, { "Retry-After": String(60 - new Date().getUTCSeconds()) });
  }
  const read = readDocsSearch(new URL(request.url).searchParams);
  if (!read.ok) return answer(400, { error: "That cursor is not one this search gave." });
  try {
    const result = await searchDocs(read.query);
    if (!result.ok) return answer(400, { error: "That cursor is not one this search gave." });
    return answer(200, result.answer);
  } catch (error) {
    log("error", "docs_search.failed", { words: read.query.q.length > 0, sort: read.query.sort }, error);
    return answer(500, { error: "The search could not answer. Try again in a moment." });
  }
}
