import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import type { OutgoingEmail, SendOutcome } from "./email";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const { makeStore, seedBusyStore, placeTestOrder, at, NOW } = await import("./analytics-insights-fixture");
const alerts = await import("./staff-alerts");
const settings = await import("./analytics-settings");
const insights = await import("./analytics-insights");

/**
 * Wave 8 unit D (D348) against a real database: targets of every kind saved, listed and followed; the analytics alerts emailed once a store day after
 * 20:00 to the staff chosen, at or above the floor; the briefing (the staff summary grown) with the alerts, the checkup and the targets, never for a
 * quiet period; and Home's one-press offer. The busy store of `analytics-insights-fixture.ts` raises alerts (a product's refunds, a drop in conversion);
 * its moment is Wednesday 14 October 2026, 14:00 in Oslo.
 */

const EVENING = new Date("2026-10-14T18:30:00Z"); // 20:30 in Oslo
const AFTERNOON = new Date("2026-10-14T16:30:00Z"); // 18:30 in Oslo

type Sent = OutgoingEmail;
const sink = () => {
  const sent: Sent[] = [];
  const send = async (message: OutgoingEmail): Promise<SendOutcome> => {
    sent.push(message);
    return "sent";
  };
  return { sent, send };
};

async function ownerOf(storeId: string): Promise<string> {
  const [row] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${storeId}::uuid and role = 'owner' limit 1`);
  return String(row.account_id);
}

let busy: Awaited<ReturnType<typeof makeStore>>;
let busyOwner: string;

beforeAll(async () => {
  busy = await makeStore("briefing-busy", true);
  await seedBusyStore(busy);
  busyOwner = await ownerOf(busy.id);
}, 240_000);

afterAll(async () => {
  await closeDb();
});

describe("targets of every kind (D348)", () => {
  it("keeps the first form and the new columns in step, whichever a writer gives", async () => {
    // The code running while the migration deploys writes the first form only.
    await db().execute(sql`insert into commerce.analytics_targets (store_id, month, revenue_target_minor) values (${busy.id}::uuid, '2026-11-01', 90000)`);
    const [first] = await db().execute<Row>(sql`
      select metric, period, starts_on::text as starts_on, ends_on::text as ends_on, target_value::int as target_value from commerce.analytics_targets
      where store_id = ${busy.id}::uuid and month = '2026-11-01'
    `);
    expect(first).toMatchObject({ metric: "net_sales", period: "month", starts_on: "2026-11-01", ends_on: "2026-11-30", target_value: 90000 });
    // Its upsert changes the amount only: the new column follows.
    await db().execute(sql`
      insert into commerce.analytics_targets (store_id, month, revenue_target_minor) values (${busy.id}::uuid, '2026-11-01', 95000)
      on conflict (store_id, month) do update set revenue_target_minor = excluded.revenue_target_minor
    `);
    const [after] = await db().execute<Row>(sql`select target_value from commerce.analytics_targets where store_id = ${busy.id}::uuid and month = '2026-11-01'`);
    expect(Number(after.target_value)).toBe(95000);
    // A monthly net-sales target saved the new way fills in the first form, which the month's reader reads.
    const saved = await settings.savePeriodTarget({ account: { id: busyOwner } as never, store: busy }, { metric: "net_sales", period: "month", start: "2026-12-05", value: "1500" });
    expect(saved.ok).toBe(true);
    expect((await settings.listTargets(busy.id)).find((t) => t.month === "2026-12-01")?.revenueTargetMinor).toBe(150_000);
    // Every other target leaves the first form empty, and the database refuses a period that is not whole.
    await expect(
      db().execute(sql`insert into commerce.analytics_targets (store_id, metric, period, starts_on, ends_on, target_value) values (${busy.id}::uuid, 'orders', 'week', '2026-10-28', '2026-11-03', 5)`),
    ).rejects.toThrow();
  });

  it("follows a running target from the period's own paid orders", async () => {
    // The week of Monday 12 October: the busy store's orders on the 13th (one of the last days' four), and the order today's test adds.
    const saved = await settings.savePeriodTarget({ account: { id: busyOwner } as never, store: busy }, { metric: "orders", period: "week", start: "2026-10-14", value: "10" });
    if (!saved.ok) throw new Error(saved.problems.join(" "));
    const cards = await insights.runningTargets(busy, NOW);
    const week = cards.find((c) => c.target.metric === "orders" && c.target.period === "week");
    expect(week?.target.startsOn).toBe("2026-10-12");
    const [counted] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.orders o
      where o.store_id = ${busy.id}::uuid and o.status = 'paid' and o.placed_at >= '2026-10-12T00:00:00+02:00' and o.placed_at < '2026-10-14T14:00:00+02:00'
    `);
    expect(week?.progress.actual).toBe(Number(counted.n));
    expect(week?.progress.expected).not.toBeNull();
    // Conversion is known: visits were counted from long before the week.
    await settings.savePeriodTarget({ account: { id: busyOwner } as never, store: busy }, { metric: "conversion", period: "week", start: "2026-10-14", value: "2" });
    const conv = (await insights.runningTargets(busy, NOW)).find((c) => c.target.metric === "conversion");
    expect(conv?.progress.missing).not.toBe("visits");
    // The month's net-sales target is the Overview's own card, left out unless asked for.
    expect(cards.some((c) => c.target.metric === "net_sales" && c.target.period === "month")).toBe(false);
  });

  it("forecasts the month's orders beside its revenue", async () => {
    const f = await insights.forecastForStore(busy, NOW);
    expect(f?.orders.basis).not.toBeUndefined();
    expect(f?.orders.soFarMinor).toBeGreaterThan(0);
    if (f?.orders.expectedMinor !== null) expect(f!.orders.lowMinor!).toBeLessThanOrEqual(f!.orders.expectedMinor!);
  });
});

describe("analytics alerts by email (D348)", () => {
  it("emails the staff chosen once a store day after 20:00, each alert once, never good news", async () => {
    await alerts.saveStaffAlerts(busy.id, { recipients: [{ accountId: busyOwner, events: ["analytics"] }], contactEvents: [], summary: "off", summaryWeekday: 1, summaryHour: 8, alertFloor: "info" }, busyOwner);
    const early = sink();
    await alerts.sendAnalyticsAlertEmails({ now: AFTERNOON, send: early.send });
    expect(early.sent.filter((m) => m.storeId === busy.id)).toHaveLength(0);

    const evening = sink();
    const out = await alerts.sendAnalyticsAlertEmails({ now: EVENING, send: evening.send });
    const mine = evening.sent.filter((m) => m.storeId === busy.id);
    expect(out.stores).toBeGreaterThanOrEqual(1);
    expect(mine).toHaveLength(1);
    expect(mine[0].kind).toBe("staff.analytics_alerts");
    expect(mine[0].idempotencyKey).toBe(`staff-analytics:${busy.id}:2026-10-14:${busyOwner}`);
    expect(mine[0].email.text).toContain("What the analytics found today");
    expect(mine[0].email.text).toContain(`/admin/${busy.slug}/analytics`);
    const kept = await db().execute<Row>(sql`select alert_id, severity from commerce.analytics_alert_sends where store_id = ${busy.id}::uuid and day = '2026-10-14'`);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.every((r) => r.severity !== "good")).toBe(true);

    // The same day again: claimed, nothing more.
    const again = sink();
    await alerts.sendAnalyticsAlertEmails({ now: new Date("2026-10-14T20:00:00Z"), send: again.send });
    expect(again.sent.filter((m) => m.storeId === busy.id)).toHaveLength(0);
  }, 120_000);

  it("sends nothing to a member who is not chosen, nor for a store with no one chosen", async () => {
    const quiet = await makeStore("briefing-nobody", false);
    const s = sink();
    await alerts.sendAnalyticsAlertEmails({ now: EVENING, send: s.send });
    expect(s.sent.filter((m) => m.storeId === quiet.id)).toHaveLength(0);
  });
});

describe("the briefing (D348)", () => {
  it("adds the alerts, the checkup and the targets to the summary, in the recipient's language", async () => {
    await alerts.saveStaffAlerts(busy.id, { recipients: [{ accountId: busyOwner, events: ["summary"] }], contactEvents: [], summary: "daily", summaryWeekday: 1, summaryHour: 8 }, busyOwner);
    await db().execute(sql`update commerce.staff_alert_settings set summary_last_period = null where store_id = ${busy.id}::uuid`);
    const s = sink();
    await alerts.sendDueSummaries({ now: NOW, send: s.send, note: async () => "One product's refunds stand out." });
    const mine = s.sent.filter((m) => m.storeId === busy.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].email.subject).toContain("your daily briefing");
    expect(mine[0].email.text).toContain("What the analytics found:");
    expect(mine[0].email.text).toContain("Your targets:");
    expect(mine[0].email.text).toContain("One product's refunds stand out.");
    // Nothing per customer: the fixture's buyers' addresses are never in it.
    expect(mine[0].email.text).not.toContain("@example.com");
  }, 120_000);

  it("sends nothing for a quiet period, and marks it done", async () => {
    const quiet = await makeStore("briefing-quiet", false);
    const owner = await ownerOf(quiet.id);
    await alerts.saveStaffAlerts(quiet.id, { recipients: [{ accountId: owner, events: ["summary"] }], contactEvents: [], summary: "daily", summaryWeekday: 1, summaryHour: 8 }, owner);
    const s = sink();
    await alerts.sendDueSummaries({ now: NOW, send: s.send, note: async () => null });
    expect(s.sent.filter((m) => m.storeId === quiet.id)).toHaveLength(0);
    const [row] = await db().execute<Row>(sql`select summary_last_period from commerce.staff_alert_settings where store_id = ${quiet.id}::uuid`);
    expect(row.summary_last_period).toBe("daily:2026-10-13");
    // A paid order the next day makes the next period worth a briefing.
    await placeTestOrder(quiet, { at: at(quiet, 0, 10) });
    const next = sink();
    await alerts.sendDueSummaries({ now: new Date("2026-10-15T12:00:00Z"), send: next.send, note: async () => null });
    expect(next.sent.filter((m) => m.storeId === quiet.id)).toHaveLength(1);
  }, 120_000);
});

describe("the briefing's offer on Home (D348)", () => {
  it("turns the briefing on in one press with the owner as recipient, keeping the defaults, and *Not now* hides it", async () => {
    const fresh = await makeStore("briefing-offer", false);
    const owner = await ownerOf(fresh.id);
    expect(await alerts.briefingOffered(fresh.id)).toBe(true);
    expect(await alerts.turnOnBriefing(fresh.id, owner, "weekly")).toEqual({ ok: true });
    expect(await alerts.briefingOffered(fresh.id)).toBe(false);
    const [recipient] = await db().execute<Row>(sql`select events from commerce.staff_alert_recipients where store_id = ${fresh.id}::uuid and account_id = ${owner}::uuid`);
    // The defaults an owner had (new orders and the rest) are kept, and the briefing is added.
    expect(recipient.events).toEqual(expect.arrayContaining(["new_order", "summary"]));
    const [config] = await db().execute<Row>(sql`select summary from commerce.staff_alert_settings where store_id = ${fresh.id}::uuid`);
    expect(config.summary).toBe("weekly");

    const other = await makeStore("briefing-not-now", false);
    const otherOwner = await ownerOf(other.id);
    expect(await alerts.dismissBriefingOffer(other.id, otherOwner)).toBe(true);
    expect(await alerts.briefingOffered(other.id)).toBe(false);
    // Only an owner of the store answers: someone else's answer changes nothing.
    const third = await makeStore("briefing-stranger", false);
    expect(await alerts.dismissBriefingOffer(third.id, otherOwner)).toBe(false);
    expect(await alerts.turnOnBriefing(third.id, otherOwner, "daily")).toMatchObject({ ok: false, problem: "not_owner" });
    expect(await alerts.briefingOffered(third.id)).toBe(true);
  });
});
