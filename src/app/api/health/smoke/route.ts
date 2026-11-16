import { connection } from "next/server";

import { challengeSmokePages } from "@/server/challenge-smoke";
import { log } from "@/server/log";

/**
 * The pages a deploy's smoke requests beyond its own list (`docs/100-day-challenge.md` F5, `scripts/await-deploy.mjs`): every store in
 * challenge mode, its front page and its cart. Public, as those pages are; nothing else is said. Answers an empty list when it cannot read.
 */
export async function GET() {
  await connection();
  try {
    const pages = process.env.DATABASE_URL ? await challengeSmokePages() : [];
    return Response.json({ pages }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    log("error", "health.smoke_pages_failed", {}, error);
    return Response.json({ pages: [] }, { headers: { "Cache-Control": "no-store" } });
  }
}
