import { connection } from "next/server";

import { docsPageAt } from "@/lib/docs-content";
import { readDocsFeedback } from "@/lib/docs-feedback";
import { fail, sameSite } from "@/server/chat-route";
import { docsIndex } from "@/server/docs";
import { addDocsComment, recordDocsVote } from "@/server/docs-feedback";
import { log } from "@/server/log";
import { budgetVisitor, takeBudget } from "@/server/request-budget";

/**
 * *Was this page helpful?* on the docs (D442): `{ path, lang, helpful }` keeps a yes or a no on a page the docs have and answers its id
 * (201); `{ id, comment }` adds the optional sentence to it within the hour (200; 422 with `over` when too long). From the docs' own pages
 * only (`sameSite()`: the docs' host or Kaizena Flow's, whichever served the page), budgeted per visitor (`docs_feedback`, a daily hash of
 * the address, never kept beyond the counters). Nothing about the reader is stored.
 */
export async function POST(request: Request) {
  await connection();
  if (!sameSite(request)) return fail(403, "Feedback comes from the docs' own pages only.");
  if (!(await takeBudget(null, "docs_feedback", budgetVisitor(request.headers)))) return fail(429, "Too many answers. Try again later.");
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 8_000) return fail(413, "That is too long.");
    body = JSON.parse(text);
  } catch {
    return fail(400, "The answer could not be read.");
  }
  const asked = readDocsFeedback(body);
  if (!asked) return fail(400, "The answer could not be read.");
  try {
    if (asked.kind === "vote") {
      if (!docsPageAt(docsIndex(), asked.path, asked.lang)) return fail(404, "No such page in the docs.");
      const id = await recordDocsVote(asked);
      return Response.json({ id }, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    const added = await addDocsComment(asked.id, asked.comment);
    if (added.ok) return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    if (added.reason === "gone") return fail(404, "That answer can no longer take a sentence.");
    return Response.json({ error: "That is too long.", over: added.over }, { status: 422, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    log("error", "docs_feedback.failed", { kind: asked.kind }, error);
    return fail(500, "The answer could not be kept.");
  }
}
