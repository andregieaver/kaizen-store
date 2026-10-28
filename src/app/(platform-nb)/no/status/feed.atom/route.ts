import { connection } from "next/server";

import { statusFeed } from "@/server/status";

/** The status page's incidents as an Atom feed (D360), read each time (incidents are few). */
export async function GET() {
  await connection();
  return new Response(await statusFeed("nb"), {
    headers: { "Content-Type": "application/atom+xml; charset=utf-8", "Cache-Control": "public, max-age=60" },
  });
}
