import { connection } from "next/server";

import { sameSite } from "@/lib/same-site";
import { recordFormSeen } from "@/server/form-views";

/**
 * A saved form seen on the site (email plan M4.3, a popup's own report), sent once by `SiteForm` when the form first comes into view or its
 * popup opens. POST only, from the same site, at most 200 bytes, and always an empty 204 that is never cached, counted or not. No cookie is
 * set or read; `recordFormSeen()` keeps a counter per form and day, nothing about the visitor.
 */

const MAX_BYTES = 200;
const quiet = (status = 204) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  await connection();
  try {
    if (!sameSite(request)) return quiet(403);
    const text = await request.text();
    if (text.length > MAX_BYTES) return quiet(413);
    await recordFormSeen(request.headers, JSON.parse(text));
  } catch {
    // Counting is never worth an error in a visitor's browser.
  }
  return quiet();
}
