import { connection } from "next/server";
import { z } from "zod";

import { DOC_LANGS } from "@/lib/docs-content";
import { DOCS_QUERY_MAX } from "@/lib/docs-search";
import { sameSite } from "@/lib/same-site";
import { countDocsMiss } from "@/server/docs-search";
import { log } from "@/server/log";
import { budgetVisitor, takeBudget } from "@/server/request-budget";

const empty = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });

const body = z.object({ q: z.string().max(DOCS_QUERY_MAX * 2), lang: z.enum(DOC_LANGS) });

/**
 * A search of the docs that found nothing, counted for their gap list (D443): `{ q, lang }` from the search dialog once the words have stood
 * a moment with no result. From the docs' own pages only (`sameSite()`), budgeted per visitor (`docs_miss`); the words are kept as a search
 * reads them and only when they look like a search (`missQuery()`: never an email address, a long number or a token), a reader's same search
 * once an hour. Always an empty 204, counted or not, so a script learns nothing from it; nothing about the reader is kept.
 */
export async function POST(request: Request): Promise<Response> {
  await connection();
  if (!sameSite(request)) return empty(403);
  const visitor = budgetVisitor(request.headers);
  if (!(await takeBudget(null, "docs_miss", visitor))) return empty(429);
  let parsed: z.infer<typeof body>;
  try {
    const text = await request.text();
    if (text.length > 2_000) return empty(413);
    const read = body.safeParse(JSON.parse(text));
    if (!read.success) return empty(400);
    parsed = read.data;
  } catch {
    return empty(400);
  }
  try {
    await countDocsMiss(parsed.q, parsed.lang, visitor);
  } catch (error) {
    // Counting is never worth an error in a reader's browser.
    log("warn", "docs_search.miss_failed", {}, error);
  }
  return empty(204);
}
