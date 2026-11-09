import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const briefing = await import("./platform-briefing");

import type { Account } from "./auth";

type Row = Record<string, unknown>;

/**
 * The platform's targets and morning briefing (D513) against a real database: a target is set by an owner or the finance role, never by
 * another role, and its progress read from the month's figures; the briefing is off until turned on, then goes once a period at seven in
 * Oslo to the owners and finance, and not again for the same period.
 */

const run = Date.now().toString(36);
afterAll(async () => closeDb());

describe("the platform's targets and briefing (D513)", () => {
  it("sets targets by role, reads their progress, and sends the briefing once a period", async () => {
    const [owner] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_admin) values (${`brief-${run}@example.com`}, 'Eva', true) returning id`);
    const [finance] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_role) values (${`brief-fin-${run}@example.com`}, 'Finn', 'finance') returning id`);
    const [reader] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_role) values (${`brief-read-${run}@example.com`}, 'Rita', 'read_only') returning id`);
    const ownerAccount = { id: String(owner.id), email: "x", name: null, platformAdmin: true } as Account;
    const financeAccount = { id: String(finance.id), email: "x", name: null, platformAdmin: false, platformRole: "finance" } as Account;
    const readerAccount = { id: String(reader.id), email: "x", name: null, platformAdmin: false, platformRole: "read_only" } as Account;
    const [before] = await db().execute<Row>(sql`select briefing, briefing_last_period, briefing_offer_dismissed_at from commerce.platform_settings limit 1`);
    const month = "2031-03-01";
    try {
      // Targets: the plans area's (an owner or finance), never read-only's; money in a currency, counts without.
      expect(await briefing.savePlatformTarget(readerAccount, { metric: "paying", month, currency: null, targetValue: 10 })).toBe(false);
      expect(await briefing.savePlatformTarget(financeAccount, { metric: "sales", month, currency: null, targetValue: 100_000 })).toBe(false);
      expect(await briefing.savePlatformTarget(financeAccount, { metric: "sales", month, currency: "NOK", targetValue: 100_000 })).toBe(true);
      expect(await briefing.savePlatformTarget(ownerAccount, { metric: "paying", month, currency: "NOK", targetValue: 10 })).toBe(true);
      expect(await briefing.savePlatformTarget(ownerAccount, { metric: "paying", month, currency: null, targetValue: 12 })).toBe(true);
      const targets = await briefing.platformTargets(month);
      expect(targets.map((t) => [t.metric, t.currency, t.targetValue])).toEqual([
        ["paying", null, 12],
        ["sales", "NOK", 100_000],
      ]);
      expect(await briefing.savePlatformTarget(ownerAccount, { metric: "paying", month, currency: null, targetValue: 0 })).toBe(true);
      expect((await briefing.platformTargets(month)).map((t) => t.metric)).toEqual(["sales"]);

      // The snapshot reads the figures (live only).
      const snapshot = await briefing.platformSnapshot(new Date("2026-11-15T10:00:00Z"));
      expect(snapshot.today).toBe("2026-11-15");
      expect(snapshot.paying).toBeGreaterThanOrEqual(0);

      // The briefing: off until turned on, and its offer shown until then (or put away).
      await db().execute(sql`update commerce.platform_settings set briefing = 'off', briefing_last_period = null, briefing_offer_dismissed_at = null`);
      expect(await briefing.platformBriefingSetting()).toEqual({ kind: "off", offered: true });
      expect(await briefing.sendPlatformBriefing({ now: new Date("2026-11-16T07:30:00Z") })).toEqual({ sent: 0 });
      expect(await briefing.setPlatformBriefing(readerAccount, "daily")).toBe(false);
      expect(await briefing.setPlatformBriefing(financeAccount, "daily")).toBe(true);
      expect(await briefing.platformBriefingSetting()).toEqual({ kind: "daily", offered: false });

      // Before seven in Oslo nothing; at half past eight (UTC 07:30) it goes, to the owners and finance; not again for the period.
      expect(await briefing.sendPlatformBriefing({ now: new Date("2026-11-16T05:30:00Z") })).toEqual({ sent: 0 });
      const first = await briefing.sendPlatformBriefing({ now: new Date("2026-11-16T07:30:00Z") });
      expect(first.sent).toBeGreaterThanOrEqual(2);
      const mails = await db().execute<Row>(sql`select to_address from commerce.email_messages where kind = 'platform.briefing' and idempotency_key like 'platform.briefing:daily:2026-11-15:%'`);
      const to = mails.map((m) => String(m.to_address));
      expect(to).toEqual(expect.arrayContaining([`brief-${run}@example.com`, `brief-fin-${run}@example.com`]));
      expect(to).not.toContain(`brief-read-${run}@example.com`);
      expect(await briefing.sendPlatformBriefing({ now: new Date("2026-11-16T09:00:00Z") })).toEqual({ sent: 0 });
    } finally {
      await db().execute(sql`delete from commerce.platform_targets where month = ${month}::date`);
      await db().execute(sql`
        update commerce.platform_settings set briefing = ${String(before?.briefing ?? "off")}, briefing_last_period = ${(before?.briefing_last_period as string | null) ?? null},
          briefing_offer_dismissed_at = ${before?.briefing_offer_dismissed_at ? new Date(String(before.briefing_offer_dismissed_at)).toISOString() : null}::timestamptz`);
    }
  });
});
