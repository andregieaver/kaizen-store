import { connection } from "next/server";

import { sameSite } from "@/lib/same-site";
import { recordFormSeen } from "@/server/form-views";

/**
 * A saved form seen on the site (email plan M4.3, D871): the lazy one-pixel image `FormSection` draws beside a saved form, which the
 * browser fetches only as the form comes near view (and not while its popup is closed). GET, from the same site; always the same
 * transparent pixel, never cached, counted or not. No cookie is set or read; `recordFormSeen()` keeps a counter per form and day,
 * nothing about the visitor.
 */

const PIXEL = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (c) => c.charCodeAt(0));
const pixel = () => new Response(PIXEL, { headers: { "Content-Type": "image/gif", "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  await connection();
  try {
    if (sameSite(request)) {
      const query = new URL(request.url).searchParams;
      await recordFormSeen(request.headers, { store: query.get("store") || null, form: query.get("form") ?? "" });
    }
  } catch {
    // Counting is never worth an error in a visitor's browser.
  }
  return pixel();
}
