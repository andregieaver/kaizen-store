import { connection } from "next/server";
import { z } from "zod";

import { cleanHeadingText } from "@/lib/inline-edit";
import { cleanRichText } from "@/lib/page-content";
import { sameSite } from "@/server/chat-route";
import { readPageText, savePageText } from "@/server/page-text-edit";

/**
 * Editing a page's words on the live site (D192): the words of a heading or a text of the page, read for the person who may change
 * them (GET), and what they typed saved (POST). Asked by the "Edit text" mode of the "Edit page" button, which appears only for them
 * (`/api/platform/editor`), so the pages themselves stay the same for everyone and cached. Each call finds out again whose page it is
 * and whether the signed-in person may change its website (`src/server/page-text-edit.ts`); nothing is cached.
 */

const HEADERS = { "Cache-Control": "private, no-store" };
const BODY_MAX = 400_000;

const reply = (body: Record<string, unknown>, status: number) => Response.json(body, { status, headers: HEADERS });
const invalid = (message = "That could not be read. Reload the page and try again.") => reply({ ok: false, code: "invalid", message }, 400);

const where = {
  /** A store's slug, or none for Kaizen's own pages. */
  store: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/).nullable(),
  page: z.uuid(),
  block: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
};
const readInput = z.object(where);
const saveInput = z.object({
  ...where,
  rev: z.string().regex(/^[0-9a-f]{16}$/),
  edit: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("heading"), text: z.string().max(2000) }),
    z.object({ kind: z.literal("richText"), doc: z.unknown() }),
  ]),
});

export async function GET(request: Request) {
  if (!sameSite(request)) return reply({ ok: false, code: "forbidden", message: "You cannot edit this page." }, 403);
  await connection();
  const params = new URL(request.url).searchParams;
  const parsed = readInput.safeParse({ store: params.get("store") || null, page: params.get("page"), block: params.get("block") });
  if (!parsed.success) return invalid();
  const result = await readPageText(parsed.data);
  return result.ok ? reply(result, 200) : reply(result, result.status);
}

export async function POST(request: Request) {
  if (!sameSite(request)) return reply({ ok: false, code: "forbidden", message: "You cannot edit this page." }, 403);
  await connection();
  const raw = await request.text();
  if (raw.length > BODY_MAX) return invalid("That text is too long to save here.");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return invalid();
  }
  const parsed = saveInput.safeParse(json);
  if (!parsed.success) return invalid();
  const { store, page, block, rev, edit } = parsed.data;
  let words: Parameters<typeof savePageText>[0]["edit"];
  if (edit.kind === "heading") {
    words = { kind: "heading", text: cleanHeadingText(edit.text) };
  } else {
    // A text goes through the same cleaning as the page builder's save: only the elements and marks pages know.
    const cleaned = cleanRichText(edit.doc);
    if (!cleaned.ok) return reply({ ok: false, code: "invalid", message: cleaned.problem }, 422);
    words = { kind: "richText", doc: cleaned.doc };
  }
  const result = await savePageText({ store, page, block, rev, edit: words });
  return result.ok ? reply(result, 200) : reply(result, result.status);
}
