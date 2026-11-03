import { connection } from "next/server";
import { z } from "zod";

import { DOC_LANGS, DOCS_CHANGELOG_PATH, docPage } from "@/lib/docs-content";
import { sameSite } from "@/lib/same-site";
import { docsIndex } from "@/server/docs";
import { countDocsRead } from "@/server/docs-search";
import { log } from "@/server/log";
import { budgetVisitor, takeBudget } from "@/server/request-budget";

const empty = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });

const body = z.object({ path: z.string().max(200), lang: z.enum(DOC_LANGS) });

/**
 * A docs page read, for the docs' *Most read* order (D443): `{ path, lang }` sent once by the page (`DocsReadCount`, with
 * `navigator.sendBeacon`, never under Global Privacy Control or Do Not Track). From the docs' own pages only (`sameSite()`), budgeted per
 * visitor (`docs_read`), a page the docs have, a reader's same page once an hour. A count per page and day and nothing about the reader:
 * no cookie is set or read. Always an empty 204, counted or not.
 */
export async function POST(request: Request): Promise<Response> {
  await connection();
  if (!sameSite(request)) return empty(403);
  const visitor = budgetVisitor(request.headers);
  if (!(await takeBudget(null, "docs_read", visitor))) return empty(429);
  let read: z.infer<typeof body>;
  try {
    const text = await request.text();
    if (text.length > 1_000) return empty(413);
    const parsed = body.safeParse(JSON.parse(text));
    if (!parsed.success) return empty(400);
    read = parsed.data;
  } catch {
    return empty(400);
  }
  const index = docsIndex();
  const known = read.path === DOCS_CHANGELOG_PATH ? read.lang === "en" && index.changelog !== null : docPage(index, read.path, read.lang) !== null;
  if (!known) return empty(204);
  try {
    await countDocsRead(read.path, read.lang, visitor);
  } catch (error) {
    log("warn", "docs_read.failed", {}, error);
  }
  return empty(204);
}
