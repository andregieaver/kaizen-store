import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { formatMoney } from "@/lib/money";

import type { Account } from "./auth";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const ownerTools = await import("./owner-tools");
const notifications = await import("./notifications");
const rules = await import("./order-rules");
const alerts = await import("./staff-alerts");
const tracking = await import("./shipment-tracking");
const translate = await import("./store-translate");
const { markSent } = await import("./order-admin");
const { getStore } = await import("./stores");
const { fxStore, paidOrder, NO_EUR } = await import("./fulfilment-test-fixture");

type Row = Record<string, unknown>;
type Answer = Record<string, unknown>;
type Fx = Awaited<ReturnType<typeof fxStore>>;

/**
 * The AI manager's notification tools and the store translation's *Customer emails* scope (wave 3, D238, `docs/wave-3-notifications.md` 5.5) against a real
 * database. `notification_settings` repeats the Notifications page (switches, which languages have the store's own words) and never gives the words;
 * `order_rules` repeats the Automation page's sentences (amounts in the main currency, a euro order's run included) and its log; `parcel_tracking` repeats
 * the stored tracking (a Bring parcel's phase, PostNord's unverified codes said so) and another store's order is not found. Each refuses a role without its
 * permission. Translating emails lists the main language's own words, keeps the target's other parts and refuses a suggestion that changed a placeholder.
 */

let store: Fx;
let other: Fx;
const mine = new Set<string>();

const accountOf = async (fx: Fx): Promise<Account> => {
  const [row] = await db().execute<Row>(sql`select id, email from commerce.accounts where id = ${fx.accountId}::uuid`);
  return { id: String(row.id), email: String(row.email), name: "Owner", platformAdmin: false } as Account;
};
const run = async (fx: Fx, name: string, input: unknown = {}, holder?: { role: "owner" | "admin"; permissions?: string[] | null }) =>
  (await ownerTools.runOwnerTool({ account: await accountOf(fx), store: (await getStore(fx.slug))!, invalidate: () => {}, ...(holder ? { holder } : {}) } as never, name, input)) as Answer;
const drain = async () => {
  for (let i = 0; i < 20; i++) {
    const r = await alerts.processStoreEvents({ limit: 200, storeIds: [...mine] });
    if (r.claimed < 200) return;
  }
};
const connect = (fx: Fx, carrier: string) =>
  db().execute(sql`insert into commerce.shipping_carriers (store_id, carrier, complete) values (${fx.storeId}::uuid, ${carrier}, true) on conflict do nothing`);

beforeAll(async () => {
  store = await fxStore("notetools");
  other = await fxStore("notetools-other");
  mine.add(store.storeId);
  mine.add(other.storeId);
  await connect(store, "bring");
  await connect(store, "postnord");
});
afterAll(async () => {
  await closeDb();
});

describe("notification_settings", () => {
  it("says each email's switch and which languages have the store's own words, never the words", async () => {
    expect(await notifications.setNotification(store.storeId, "order.sent", false, store.accountId)).toMatchObject({ ok: true });
    const saved = await notifications.saveTemplate(store.storeId, "order.sent", "nb", { subject: "Pakken din er på vei, ordre {order_number}", heading: null, body: null }, store.accountId);
    expect(saved.ok).toBe(true);
    const answer = await run(store, "notification_settings");
    const emails = answer.emails as { id: string; status: string; wording: unknown }[];
    const sent = emails.find((e) => e.id === "order.sent")!;
    expect(sent.status).toBe("off");
    expect(JSON.stringify(sent.wording)).toContain("the store's own subject");
    expect(emails.find((e) => e.id === "order.confirmation")!.status).toMatch(/required/);
    expect(emails.find((e) => e.id === "order.parcel_delivered")!.status).toBe("off");
    expect(answer.off).toEqual(expect.arrayContaining(["Order sent", "Delivered (carrier)", "Out for delivery (carrier)"]));
    // The owner's words never reach the model.
    expect(JSON.stringify(answer)).not.toContain("Pakken din");
    // Another store's switches and words are its own.
    const theirs = (await run(other, "notification_settings", { notification: "order.sent" })).emails as { status: string; wording: unknown }[];
    expect(theirs).toHaveLength(1);
    expect(theirs[0].status).toBe("on");
    expect(JSON.stringify(theirs[0].wording)).not.toContain("own");
  });

  it("refuses an email that is not one Kaizena Flow sends, and a role without settings:read", async () => {
    await expect(run(store, "notification_settings", { notification: "order.unknown" })).rejects.toThrow(/no customer email/);
    await expect(run(store, "notification_settings", {}, { role: "admin", permissions: ["orders:read"] })).rejects.toThrow();
    await expect(run(store, "notification_settings", {}, { role: "admin", permissions: ["settings:read"] })).resolves.toBeDefined();
  });
});

describe("order_rules", () => {
  it("gives each rule's sentence in the main currency and the log's runs, a euro order's included", async () => {
    const saved = await rules.saveRule(
      store.storeId,
      null,
      { name: "Big order", match: "all", conditions: [{ kind: "total_at_least", amountMinor: 100 }], actions: [{ kind: "tag", label: "Big" }] },
      store.accountId,
    );
    expect(saved.ok).toBe(true);
    const euro = await paidOrder(store, [["DEMO-TOTE", 1]], { market: NO_EUR });
    expect(euro.currency).toBe("EUR");
    await drain();
    const answer = await run(store, "order_rules", { rule: "big order" });
    const [rule] = answer.rules as { name: string; rule: string; on: boolean; last_run: unknown }[];
    expect(rule).toMatchObject({ name: "Big order", on: true });
    // The page's own sentence, the amount in the store's main currency (kroner) as formatMoney writes it.
    expect(rule.rule).toBe(`When an order is paid and the total is at least ${formatMoney(100, "NOK", "en-GB")}, tag "Big".`);
    const runs = answer.latest_runs as { order: string; matched: boolean; conditions: string[]; actions: string[] }[];
    const forEuro = runs.find((r) => r.order === euro.number)!;
    expect(forEuro).toMatchObject({ matched: true, actions: ["tag: done"] });
    expect(forEuro.conditions).toEqual(["total at least: met"]);
    // Only matched or not, and none asked.
    expect((await run(store, "order_rules", { matched: false, runs: 50 })).latest_runs).toEqual((await rules.ruleLog(store.storeId, { matched: false, limit: 50 })).map(() => expect.anything()));
    expect((await run(store, "order_rules", { runs: 0 })).latest_runs).toEqual([]);
  });

  it("says a store with no rules has none, refuses a rule it does not have, and a role without settings:read", async () => {
    expect(await run(other, "order_rules")).toMatchObject({ rules: [], note: expect.stringMatching(/no automation rules/) });
    await expect(run(store, "order_rules", { rule: "Nothing like it" })).rejects.toThrow(/No rule/);
    await expect(run(store, "order_rules", {}, { role: "admin", permissions: ["orders:read"] })).rejects.toThrow();
  });
});

describe("parcel_tracking", () => {
  const ship = async (fx: Fx, carrier: string) => {
    const order = await paidOrder(fx, [["DEMO-TOTE", 1]]);
    await db().execute(sql`update commerce.orders set placed_at = now() - interval '2 days' where id = ${order.orderId}::uuid`);
    const number = `370${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    const sent = await markSent(fx.storeId, order.orderId, { carrier, trackingNumber: number, trackingUrl: null }, fx.accountId);
    if (!sent.ok) throw new Error(sent.reason);
    return { order, number };
  };
  const hourAgo = () => new Date(Date.now() - 3_600_000).toISOString();

  it("repeats a Bring parcel's stored phase and events, and says a parcel not checked yet plainly", async () => {
    const p = await ship(store, "bring");
    let answer = await run(store, "parcel_tracking", { order: p.order.number });
    expect(answer).toMatchObject({ order: p.order.number, delivery: "not recorded" });
    expect((answer.parcels as Answer[])[0]).toMatchObject({ tracking_number: p.number, followed: true, phase: expect.stringMatching(/not checked yet/) });

    await tracking.pollTracking({
      fetchEvents: async (parcel) =>
        parcel.trackingNumber === p.number ? { ok: true, events: [{ at: hourAgo(), status: "IN_TRANSIT", description: "Sendingen er under transport", location: "Lillestrøm" }] } : { ok: true, events: [] },
      limits: { perRun: 500, perCarrier: 500 },
    });
    answer = await run(store, "parcel_tracking", { order: p.order.number });
    const [parcel] = answer.parcels as Answer[];
    expect(parcel).toMatchObject({ followed: true, phase: "on its way" });
    expect(parcel).not.toHaveProperty("phase_note");
    expect(parcel.newest_events).toEqual([{ at: expect.any(String), what: "Sendingen er under transport", where: "Lillestrøm" }]);
  });

  it("says PostNord's codes are not verified, so nothing is recorded or emailed from them", async () => {
    const p = await ship(store, "postnord");
    await tracking.pollTracking({
      fetchEvents: async (parcel) => (parcel.trackingNumber === p.number ? { ok: true, events: [{ at: hourAgo(), status: "DELIVERED", description: "Delivered" }] } : { ok: true, events: [] }),
      limits: { perRun: 500, perCarrier: 500 },
    });
    const answer = await run(store, "parcel_tracking", { order: p.order.number });
    const [parcel] = answer.parcels as Answer[];
    expect(parcel.phase_note).toMatch(/not verified/);
    expect(answer.delivery).toBe("not recorded");
  });

  it("finds only the store's own orders, says an order with no parcel so, and needs orders:read", async () => {
    const theirs = await paidOrder(other, [["DEMO-TOTE", 1]]);
    await expect(run(store, "parcel_tracking", { order: theirs.orderId })).rejects.toThrow(/No order/);
    expect(await run(other, "parcel_tracking", { order: theirs.number })).toMatchObject({ parcels: [], note: expect.stringMatching(/no parcel/) });
    await expect(run(other, "parcel_tracking", { order: theirs.number }, { role: "admin", permissions: ["settings:read"] })).rejects.toThrow();
  });
});

describe("translating customer emails (the emails scope)", () => {
  it("lists the main language's own words, writes an accepted suggestion beside the language's other parts, and refuses a changed placeholder", async () => {
    const live = (await getStore(store.slug))!;
    const [from, to] = live.localization.locales;
    expect(to).toBeTruthy();
    const target = notifications.templateLocale(to)!;
    expect(
      (await notifications.saveTemplate(store.storeId, "order.refunded", from, { subject: "Refusjon for ordre {order_number}", heading: "Vi har refundert", body: null }, store.accountId)).ok,
    ).toBe(true);
    // The other language already has its own heading: only the subject is missing.
    expect((await notifications.saveTemplate(store.storeId, "order.refunded", to, { subject: null, heading: "Own heading", body: null }, store.accountId)).ok).toBe(true);

    const member = { store: live, account: await accountOf(store) } as never;
    const work = await translate.translationWorklist(member, to, ["emails"], "missing");
    const unit = work.units.find((u) => u.id === "email:order.refunded")!;
    expect(unit.items.map((i) => i.key)).toEqual(["subject"]);
    expect(unit.legal).toBe(false);

    const refused = await translate.applyTranslations(member, to, [{ unitId: "email:order.refunded", values: { subject: "Refund for order {ordernumber}" } }]);
    expect(refused).toMatchObject({ ok: true, saved: 0 });
    if (refused.ok) expect(refused.skipped[0]).toMatch(/placeholders/);

    const done = await translate.applyTranslations(member, to, [{ unitId: "email:order.refunded", values: { subject: "Refund for order {order_number}" } }]);
    expect(done).toMatchObject({ ok: true, saved: 1 });
    expect(await notifications.getTemplate(store.storeId, "order.refunded", target)).toEqual({ subject: "Refund for order {order_number}", heading: "Own heading", body: null });
    // Nothing left to translate in that language.
    expect((await translate.translationWorklist(member, to, ["emails"], "missing")).units.find((u) => u.id === "email:order.refunded")).toBeUndefined();
  });
});
