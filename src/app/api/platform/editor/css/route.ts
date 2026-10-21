import { connection } from "next/server";
import { z } from "zod";

import { CSS_MAX } from "@/lib/custom-css";
import { sameSite } from "@/lib/same-site";
import { readPageCss, savePageCss } from "@/server/page-css-edit";

/**
 * Custom CSS on the live site (D306): a published page's own CSS and its site's, read for the person who may change them (GET), and
 * what they typed saved (POST). Asked by the "Custom CSS" button beside "Edit text", which appears only for them, so the pages stay
 * the same for everyone and cached. Each call finds out again whose page it is and whether the person may change it
 * (`src/server/page-css-edit.ts`); on a store's own domain the editing pass answers as for the words (D193); nothing is cached.
 */

const HEADERS = { "Cache-Control": "private, no-store" };

const reply = (body: Record<string, unknown>, status: number) => Response.json(body, { status, headers: HEADERS });
const invalid = (message = "That could not be read. Reload the page and try again.") => reply({ ok: false, code: "invalid", message }, 400);

const where = {
  /** A store's slug, or none for Kaizena Flow's own pages. */
  store: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/).nullable(),
  page: z.uuid(),
};
const saveInput = z.object({
  ...where,
  rev: z.string().regex(/^[0-9a-f]{16}$/),
  pageCss: z.string().max(CSS_MAX),
  siteCss: z.string().max(CSS_MAX),
});

export async function GET(request: Request) {
  if (!sameSite(request)) return reply({ ok: false, code: "forbidden", message: "You cannot edit this page." }, 403);
  await connection();
  const params = new URL(request.url).searchParams;
  const parsed = z.object(where).safeParse({ store: params.get("store") || null, page: params.get("page") });
  if (!parsed.success) return invalid();
  const result = await readPageCss(parsed.data);
  return result.ok ? reply(result, 200) : reply(result, result.status);
}

export async function POST(request: Request) {
  if (!sameSite(request)) return reply({ ok: false, code: "forbidden", message: "You cannot edit this page." }, 403);
  await connection();
  const raw = await request.text();
  if (raw.length > 4 * CSS_MAX) return invalid("That CSS is too long to save here.");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return invalid();
  }
  const parsed = saveInput.safeParse(json);
  if (!parsed.success) return invalid("That CSS is too long, or could not be read.");
  const result = await savePageCss(parsed.data);
  return result.ok ? reply(result, 200) : reply(result, result.status);
}
