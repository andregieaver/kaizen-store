import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { addDays, todayIn } from "@/lib/analytics-period";
import { HOUSE_SLUG } from "@/lib/house-routing";

import { currentStore, type Store } from "./stores";
import { col, typedRow } from "./typed-rows";

/**
 * Kaizena Flow's own store's sign-ups per visit (ecosystem plan E5.3, D757): a sign-up is its sign-up form sent (a request whose terms were
 * accepted, never a sandbox kept, D457, nor a drill, D406), counted on the day of the store's own time zone, against the visits its site
 * counted (D152) over the same days. Its A/B tests count a sign-up as their goal (D712): the autopilot sizes its tests of the site's pages
 * from this rate (`experimentTraffic()`), and its goals measure it (`signup_rate_30d`).
 */

type Range = { from: string; to: string };

/** The sign-ups sent from `from` up to, not including, `to` (days in the store's time zone). Only Kaizena Flow's own store has any. */
export async function houseSignups(store: Pick<Store, "house" | "timeZone">, range: Range): Promise<number> {
  if (!store.house) return 0;
  const row = await typedRow(
    z.object({ n: col.int }),
    sql`
      select count(*)::int as n from commerce.access_requests r
      where r.terms_accepted_at is not null and r.sandbox_id is null
        and (r.created_at at time zone ${store.timeZone})::date >= ${range.from}::date and (r.created_at at time zone ${store.timeZone})::date < ${range.to}::date
    `,
  );
  return row?.n ?? 0;
}

/**
 * The rate a goal measures: sign-ups per 100 visits over the 30 whole days before today, or why it is not known (`reason` for the Autopilot
 * page to word, `missing` in English for the goal's progress, which the model reads too).
 */
export type SignupRate =
  | { percent: number; visits: number; signups: number }
  | { percent: null; reason: "not_house" | "not_counting" | "no_visits"; missing: string };

/** Kaizena Flow's sign-ups per 100 visits to its site, from its own store (`store`, else read here), over the last 30 whole days. */
export async function houseSignupRate(now = new Date(), store?: Store | null): Promise<SignupRate> {
  const house = store === undefined ? await currentStore(HOUSE_SLUG) : store;
  if (!house?.house) return { percent: null, reason: "not_house", missing: "Only Kaizena Flow's own store counts sign-ups to Kaizena Flow." };
  if (!house.visitCounting) {
    return { percent: null, reason: "not_counting", missing: "Kaizena Flow's store does not count visits (its Settings → Analytics), so sign-ups per visit cannot be worked out." };
  }
  const today = todayIn(now, house.timeZone);
  const range = { from: addDays(today, -30), to: today };
  const [visits, signups] = await Promise.all([
    typedRow(
      z.object({ n: col.int }),
      sql`select count(*)::int as n from commerce.visits v where v.store_id = ${house.id}::uuid and v.day >= ${range.from}::date and v.day < ${range.to}::date`,
    ),
    houseSignups(house, range),
  ]);
  const n = visits?.n ?? 0;
  if (n === 0) return { percent: null, reason: "no_visits", missing: "No visits to Kaizena Flow's site were counted in the last 30 days." };
  return { percent: (signups / n) * 100, visits: n, signups };
}
