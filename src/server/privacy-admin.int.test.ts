import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("./document-html", () => ({ documentHtml: () => "<html></html>" }));
vi.mock("./stripe", () => ({
  WEBHOOK_EVENTS: [],
  platformStripe: () => ({
    subscriptions: { cancel: async (id: string) => ({ id, status: "canceled", ended_at: Math.floor(Date.now() / 1000), metadata: {}, items: { data: [] }, cancel_at_period_end: false, cancel_at: null, pause_collection: null, trial_end: null }) },
    paymentMethods: { detach: async (id: string) => ({ id }) },
  }),
}));

const fx = await import("./invoice-test-fixture");
const { buildSubject } = await import("./privacy-fixture");
const admin = await import("./privacy-admin");
const requests = await import("./privacy-requests");
const { auditRows } = await import("./trust-fixtures");

type Row = Record<string, unknown>;

/**
 * What the staff pages of one customer read and do (D162, G3 and G9): the Privacy card with counts, an overdue banner, the erasure preview, the
 * download and the two-step erase with its typed confirmation, by the key the customer pages use (an account, an order or a subscription), and
 * never for another store's key.
 */

let store: Awaited<ReturnType<typeof fx.makeStore>>;
let other: Awaited<ReturnType<typeof fx.makeStore>>;
beforeAll(async () => {
  store = await fx.makeStore("padmin");
  other = await fx.makeStore("padmin-b");
}, 60_000);
afterAll(async () => {
  await closeDb();
});

const actor = () => ({ storeId: store.storeId, accountId: store.ownerId });

describe("the Privacy card", () => {
  it("counts what the store holds by the account's key, an order's or a subscription's, and shows an overdue request as a banner", async () => {
    const subject = await buildSubject(store, "card");
    const byAccount = (await admin.privacyCard(store.storeId, subject.customerId))!;
    expect(byAccount.subject).toMatchObject({ kind: "account", customerId: subject.customerId, email: subject.email });
    expect(byAccount.counts.orders).toBe(8);
    expect(byAccount.countsLine).toMatch(/8 orders/);
    expect(byAccount.language).toBe("nb");
    expect(byAccount.request).toBeNull();
    expect(byAccount.overdue).toBe(false);
    // The same person by an order of theirs, or by their subscription.
    expect((await admin.privacyCard(store.storeId, subject.ids.guestOrder.orderId))?.subject.customerId).toBe(subject.customerId);
    expect((await admin.privacyCard(store.storeId, subject.ids.subscription))?.subject.customerId).toBe(subject.customerId);
    // A request received long ago and not answered is overdue.
    const logged = await requests.logRequest(actor(), { kind: "export", email: subject.email, receivedOn: new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10), note: "" });
    expect(logged).toMatchObject({ ok: true });
    const late = (await admin.privacyCard(store.storeId, subject.customerId))!;
    expect(late.overdue).toBe(true);
    expect(late.request?.id).toBe((logged as { id: string }).id);
  }, 120_000);

  it("is nobody's for another store's key", async () => {
    const theirs = await buildSubject(other, "card-b");
    expect(await admin.privacyCard(store.storeId, theirs.customerId)).toBeNull();
    expect(await admin.privacyCard(store.storeId, theirs.ids.guestOrder.orderId)).toBeNull();
    expect(await admin.erasurePreview(store.storeId, theirs.customerId)).toBeNull();
    expect(await admin.staffExport(actor(), theirs.customerId)).toEqual({ ok: false, problem: "not_found" });
    expect(await admin.staffErase(actor(), theirs.customerId, theirs.email)).toMatchObject({ ok: false, problem: "not_found" });
    expect(await db().execute(sql`select 1 from commerce.customers where id = ${theirs.customerId}::uuid`)).toHaveLength(1);
  }, 120_000);
});

describe("the download and the two-step erase", () => {
  it("downloads for a guest by the key of their order, refuses a subject too large, and logs both without the person", async () => {
    const guest = await fx.paidOrder(store, [["DEMO-MUG-WHITE", 1]], { email: `guest-${fx.unique("g")}@example.com` });
    const done = await admin.staffExport(actor(), guest.orderId);
    if (!done.ok) throw new Error(done.problem);
    expect(done.file.subject).toMatchObject({ kind: "guest", email: guest.email });
    expect(done.file.counts.orders).toBe(1);
    expect(await admin.staffExport(actor(), guest.orderId, { rowLimit: 0 })).toEqual({ ok: false, problem: "too_large" });
    const entries = await auditRows(store.storeId, "customer.data_exported");
    expect(JSON.stringify(entries.map((e) => e.details))).not.toContain(guest.email);
  });

  it("previews first and erases only when the address is typed exactly (any case), changing nothing for a wrong one", async () => {
    const subject = await buildSubject(store, "typed");
    const preview = (await admin.erasurePreview(store.storeId, subject.customerId))!;
    expect(preview.email).toBe(subject.email);
    expect(preview.plan.rows.find((r) => r.table === "orders" && r.action === "restricted")?.count).toBe(6);
    expect(await admin.staffErase(actor(), subject.customerId, "someone@else.com")).toMatchObject({ ok: false, problem: "confirm" });
    expect(await admin.staffErase(actor(), subject.customerId, "")).toMatchObject({ ok: false, problem: "confirm" });
    expect(await db().execute(sql`select 1 from commerce.customers where id = ${subject.customerId}::uuid`)).toHaveLength(1);
    expect(await db().execute(sql`select 1 from commerce.privacy_requests where store_id = ${store.storeId}::uuid and subject_customer_id = ${subject.customerId}::uuid`)).toHaveLength(0);
    const done = await admin.staffErase(actor(), subject.customerId, `  ${subject.email.toUpperCase()} `);
    expect(done).toMatchObject({ ok: true, outcome: "erased" });
    // The owners were told (no personal data in the notice), and the customer's key is nobody's now.
    const notice = await db().execute<Row>(sql`select text from commerce.email_messages where store_id = ${store.storeId}::uuid and kind = 'privacy.owners_notice' and subject like '%erased%'`);
    expect(notice.length).toBeGreaterThan(0);
    expect(JSON.stringify(notice)).not.toContain(subject.email);
    expect(await admin.privacyCard(store.storeId, subject.customerId)).toBeNull();
    expect(await admin.privacyCard(store.storeId, subject.ids.guestOrder.orderId)).toBeNull();
  }, 120_000);
});
