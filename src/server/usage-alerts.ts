import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { renderEmail } from "@/lib/email-layout";
import { siteUrl } from "@/lib/site";
import { monthOf } from "@/lib/usage-metrics";
import { usageEmail } from "@/lib/usage-emails";

import { sendEmail } from "./email";
import { log } from "./log";
import { storeUsageLines } from "./usage";

/**
 * Warning owners about their limits (D314, `docs/capacity.md` step 2.5), from the daily usage job: each store whose lines near (80 %) or
 * reach a limit emails each owner once per store, month and level, by the email's idempotency key (no table). Stores that are not open
 * and templates are left out, and so are soft limits while the store has said it expects a busy time (`capacity_events`). Never throws.
 */

type Row = Record<string, unknown>;

export async function sendUsageAlerts(now: Date = new Date()): Promise<{ stores: number; emails: number }> {
  const result = { stores: 0, emails: 0 };
  try {
    // Nothing to warn about until some limit is set somewhere.
    const [any] = await db().execute<Row>(sql`
      select exists (select 1 from commerce.plan_limits where value is not null)
          or exists (select 1 from commerce.limit_overrides where value is not null and store_id is not null) as set
    `);
    if (any?.set !== true) return result;
    const stores = await db().execute<Row>(sql`
      select s.id, s.slug, s.name,
             exists (select 1 from commerce.capacity_events e where e.store_id = s.id and e.starts_at <= ${now.toISOString()}::timestamptz and e.ends_at > ${now.toISOString()}::timestamptz) as busy
      from commerce.stores s
      where commerce.store_is_active(s.id) and not (s.is_template or s.starter)
    `);
    const month = monthOf(now).key;
    for (const store of stores) {
      const storeId = String(store.id);
      const lines = (await storeUsageLines(storeId, now)).filter((l) => l.measured && l.state !== "ok" && !(store.busy === true && l.enforce === "soft"));
      if (lines.length === 0) continue;
      const level = lines.some((l) => l.state === "reached" || l.state === "over") ? "reached" : "near";
      const shown = level === "reached" ? lines.filter((l) => l.state !== "near") : lines;
      result.stores++;
      const owners = await db().execute<Row>(sql`
        select distinct on (a.id) a.id, a.email
        from commerce.store_members m
        join commerce.accounts a on a.id = m.account_id and a.disabled_at is null
        where m.store_id = ${storeId}::uuid and m.role = 'owner' and m.disabled_at is null and a.email <> ''
      `);
      const email = renderEmail(usageEmail({ storeName: String(store.name), level, lines: shown, url: `${siteUrl()}/admin/${String(store.slug)}/billing` }));
      for (const person of owners) {
        const outcome = await sendEmail({
          storeId,
          kind: level === "reached" ? "usage.reached" : "usage.near",
          to: String(person.email),
          email,
          fromName: "Kaizena Flow",
          idempotencyKey: `usage:${storeId}:${month}:${level}:${String(person.id)}`,
        });
        if (outcome === "sent" || outcome === "logged") result.emails++;
      }
    }
  } catch (error) {
    log("error", "usage.alerts_failed", {}, error);
  }
  return result;
}
