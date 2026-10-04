import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/db/client";

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
const pages = await import("./privacy-pages");
const admin = await import("./privacy-admin");
const requests = await import("./privacy-requests");

/**
 * What the staff pages of 1g read beyond the cards (D162, G3): which customer page a request's person lives at, whether anything is held,
 * and the personal-data state of an order for its banner. Counts, keys and dates only; another store's person is nobody's.
 */

let store: Awaited<ReturnType<typeof fx.makeStore>>;
let other: Awaited<ReturnType<typeof fx.makeStore>>;
beforeAll(async () => {
  store = await fx.makeStore("ppages");
  other = await fx.makeStore("ppages-b");
}, 60_000);
afterAll(async () => {
  await closeDb();
});

const actor = () => ({ storeId: store.storeId, accountId: store.ownerId });
const today = () => new Date().toISOString().slice(0, 10);

const viewOf = async (id: string) => (await requests.getRequest(store.storeId, id))!;

describe("the person a request names", () => {
  it("is found by the address staff logged, at the customer page's key, with what the store holds", async () => {
    const subject = await buildSubject(store, "req");
    const logged = await requests.logRequest(actor(), { kind: "erasure", email: subject.email, receivedOn: today(), note: "" });
    if (!logged.ok) throw new Error(logged.problem);
    const found = await pages.requestSubject(store.storeId, await viewOf(logged.id));
    expect(found.key).toBe(subject.customerId);
    expect(found.holdsData).toBe(true);
  }, 120_000);

  it("is a guest's latest order when there is no account", async () => {
    const guest = await fx.paidOrder(store, [["DEMO-MUG-WHITE", 1]], { email: `guest-${fx.unique("g")}@example.com` });
    const logged = await requests.logRequest(actor(), { kind: "export", email: guest.email, receivedOn: today(), note: "" });
    if (!logged.ok) throw new Error(logged.problem);
    const found = await pages.requestSubject(store.storeId, await viewOf(logged.id));
    expect(found).toEqual({ key: guest.orderId, holdsData: true });
  });

  it("holds nothing for an address the store has never seen, and the request can then be closed", async () => {
    const logged = await requests.logRequest(actor(), { kind: "export", email: `nobody-${fx.unique("n")}@example.com`, receivedOn: today(), note: "" });
    if (!logged.ok) throw new Error(logged.problem);
    expect(await pages.requestSubject(store.storeId, await viewOf(logged.id))).toEqual({ key: null, holdsData: false });
    expect(await requests.closeNoData(actor(), logged.id)).toEqual({ ok: true, emailed: false });
    expect((await viewOf(logged.id)).outcome).toBe("no_data");
  });

  it("never reaches another store's person, even by the same address", async () => {
    const theirs = await buildSubject(other, "req-b");
    const logged = await requests.logRequest(actor(), { kind: "export", email: theirs.email, receivedOn: today(), note: "" });
    if (!logged.ok) throw new Error(logged.problem);
    expect(await pages.requestSubject(store.storeId, await viewOf(logged.id))).toEqual({ key: null, holdsData: false });
  }, 120_000);
});

describe("an order's personal-data state", () => {
  it("is nothing for an order nothing has happened to, and nothing for another store's order", async () => {
    const order = await fx.paidOrder(store, [["DEMO-MUG-WHITE", 1]], { email: `plain-${fx.unique("p")}@example.com` });
    expect(await pages.orderPrivacy(store.storeId, order.orderId)).toBeNull();
    expect(await pages.orderPrivacy(other.storeId, order.orderId)).toBeNull();
  });

  it("shows a restricted sale with the day the bookkeeping rules let it go, and an unpaid order as anonymised", async () => {
    const subject = await buildSubject(store, "erased");
    const done = await admin.staffErase(actor(), subject.customerId, subject.email);
    expect(done).toMatchObject({ ok: true, outcome: "erased" });
    const sale = await pages.orderPrivacy(store.storeId, subject.ids.signedInOrder.orderId);
    expect(sale).toMatchObject({ restrictedOn: today(), anonymisedOn: null });
    // The first of January, at least five years on: never the day of the erasure.
    expect(sale!.keptUntil).toMatch(/^\d{4}-01-01$/);
    expect(Number(sale!.keptUntil!.slice(0, 4))).toBeGreaterThanOrEqual(new Date().getUTCFullYear() + 5);
    const unpaid = await pages.orderPrivacy(store.storeId, subject.ids.unpaidOrder.orderId);
    expect(unpaid).toMatchObject({ anonymisedOn: today(), keptUntil: null });
  }, 120_000);
});
