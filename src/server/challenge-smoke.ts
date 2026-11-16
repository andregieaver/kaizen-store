import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { challengeOn, readChallenge, utcDay } from "@/lib/autopilot-challenge";
import { marketHome, marketOrigin, marketPath } from "@/lib/paths";

import { getStore } from "./stores";
import { col, typedRows } from "./typed-rows";

/**
 * The challenge stores' pages a deploy's smoke requests (`docs/100-day-challenge.md` F5, `/api/health/smoke`, `scripts/await-deploy.mjs`). A
 * module of its own so the public route reaches nothing of the AI (`public-model-paths.scan.test.ts`).
 */

/** The pages of every store with challenge mode on that a deploy's smoke requests: its main market's front page and its cart. */
export async function challengeSmokePages(now: Date = new Date()): Promise<string[]> {
  const rows = await typedRows(
    z.object({ slug: col.text, challenge: z.unknown() }),
    sql`select s.slug, a.challenge from commerce.autopilot_settings a join commerce.stores s on s.id = a.store_id where a.challenge is not null`,
  );
  const pages: string[] = [];
  for (const row of rows) {
    if (!challengeOn(readChallenge(row.challenge), utcDay(now))) continue;
    const store = await getStore(row.slug);
    const market = store?.markets[0];
    if (!store || !market) continue;
    const origin = marketOrigin(store.slug, market.slug);
    pages.push(`${origin}${marketHome(store.slug, market.slug)}`, `${origin}${marketPath(store.slug, market.slug, "/cart")}`);
  }
  return pages;
}
