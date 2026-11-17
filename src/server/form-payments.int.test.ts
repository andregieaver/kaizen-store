import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { FORM_STARTERS, draftFromStarter } from "@/lib/form-records";
import { newPageContent, pageInput } from "@/lib/page-content";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
vi.mock("./refresh", () => ({ refreshTag: () => {}, refreshTagNow: () => {} }));
// The visitor's cart cookie, as the browser would keep it.
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));
vi.mock("./stripe-keys", () => ({ platformModes: () => ["test"], platformPublishableKey: () => "pk_test_forms", platformSecretKey: () => "sk_test_x" }));

const admin = await import("./forms-admin");
const { submitForm } = await import("./forms");
const payments = await import("./form-payments");
const { newStore, variantId, place, pay } = await import("./inventory-test-support");

type Row = Record<string, unknown>;
let store: Awaited<ReturnType<typeof newStore>>;
let other: Awaited<ReturnType<typeof newStore>>;
const run = Date.now().toString(36);
const actor = () => ({ accountId: store.accountId, storeId: store.storeId });
/** A statement the database refuses, by the rule's own words (Drizzle wraps the error; the database's is its cause). */
const refusedBy = async (statement: Promise<unknown>, rule: RegExp) => {
  const error = await statement.then(() => null, (e: unknown) => e as { message?: string; cause?: { message?: string } });
  expect(`${error?.message ?? ""} ${error?.cause?.message ?? ""}`).toMatch(rule);
};
const contact = () => draftFromStarter(FORM_STARTERS.find((s) => s.key === "contact")!, "en", ["en"], [`owner-${run}@example.com`]);

beforeAll(async () => {
  store = await newStore("form-pay");
  other = await newStore("form-pay-o");
  await db().execute(sql`update commerce.payment_providers set enabled = true, active_mode = 'test' where store_id = ${store.storeId}::uuid`);
}, 120_000);

afterAll(async () => {
  await closeDb();
});

async function publish(formId: string, slug: string) {
  const page = pageInput.parse({
    ...newPageContent(),
    title: "Course",
    slug,
    rows: [{ id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks: [{ id: `f-${slug}`, type: "form", formId }] }] }],
  });
  await db().execute(sql`
    insert into commerce.pages (store_id, type, slug, draft, published, published_at)
    values (${store.storeId}::uuid, 'page', ${slug}, ${JSON.stringify(page)}::jsonb, ${JSON.stringify(page)}::jsonb, now())
  `);
}

describe("payments in a form (D738 F6c)", () => {
  it("takes only a product of the store's own, on a store's message form", async () => {
    const mug = await variantId(store.storeId, "DEMO-MUG-WHITE");
    const theirs = await variantId(other.storeId, "DEMO-MUG-WHITE");
    expect(await admin.saveForm(actor(), null, { ...contact(), paymentVariantId: theirs })).toEqual({ ok: false, problems: ["Choose one of your products to be paid for."] });
    expect(await admin.saveForm({ accountId: store.accountId, storeId: null }, null, { ...contact(), paymentVariantId: mug })).toEqual({
      ok: false,
      problems: ["Kaizena Flow's own forms take no payments."],
    });
    const made = await admin.saveForm(actor(), null, { ...contact(), paymentVariantId: mug });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect((await admin.getForm(store.storeId, made.id))?.paymentVariantId).toBe(mug);
    // A save that says nothing of the payment (the AI manager's, the Admin API's) keeps it; null removes it.
    expect(await admin.saveForm(actor(), made.id, { ...contact(), name: "Renamed" })).toMatchObject({ ok: true });
    expect((await admin.getForm(store.storeId, made.id))?.paymentVariantId).toBe(mug);
    expect(await admin.saveForm(actor(), made.id, { ...contact(), paymentVariantId: null })).toMatchObject({ ok: true });
    expect((await admin.getForm(store.storeId, made.id))?.paymentVariantId).toBeNull();
    // The database holds the same rule.
    await refusedBy(db().execute(sql`update commerce.forms set payment_variant_id = ${theirs}::uuid where id = ${made.id}::uuid`), /forms\.payment/);
  });

  it("offers the product at its price in the market, and finds it by name for the editor", async () => {
    const mug = await variantId(store.storeId, "DEMO-MUG-WHITE");
    const offer = await payments.formPaymentOffer(store.storeId, mug, "no");
    expect(offer?.price).toMatch(/kr/);
    expect(offer?.title.length).toBeGreaterThan(0);
    // Another store's product is no offer of this store's.
    expect(await payments.formPaymentOffer(store.storeId, await variantId(other.storeId, "DEMO-MUG-WHITE"), "no")).toBeNull();
    const found = await payments.formPaymentChoices(store.storeId, offer!.title.slice(0, 4));
    expect(found.some((f) => f.variantId === mug)).toBe(true);
  });

  it("keeps the response, puts the product in the visitor's cart and sends them to the checkout; paid, the response shows its order", async () => {
    const mug = await variantId(store.storeId, "DEMO-MUG-WHITE");
    const made = await admin.saveForm(actor(), null, { ...contact(), paymentVariantId: mug });
    if (!made.ok) throw new Error("made");
    await publish(made.id, `kurs-${run}`);
    jar.clear();
    const values = { q1: "Ada", q2: `ada-${run}@example.com`, q3: "Sign me up" };
    const sent = await submitForm(
      { store: store.storeId, block: made.id, values, consent: false, website: "", lang: "en", path: `/kurs-${run}`, elapsed: 5000, market: "no" },
      `visitor-${run}`,
    );
    expect(sent).toMatchObject({ status: 200, body: { ok: true, outcome: "pay", url: expect.stringMatching(/\/checkout$/) } });
    const { responses } = await admin.listResponses(store.storeId, made.id);
    expect(responses).toHaveLength(1);
    expect(responses[0].payment).toEqual({ state: "waiting" });
    const [link] = await db().execute<Row>(sql`select cart_id, variant_id from commerce.form_payments where response_id = ${responses[0].id}::uuid`);
    expect(link.variant_id).toBe(mug);
    // The cart is the visitor's own (its cookie), holding the product once.
    expect([...jar.values()]).toContain(String(link.cart_id));
    const lines = await db().execute<Row>(sql`select variant_id, quantity from commerce.cart_lines where cart_id = ${String(link.cart_id)}::uuid`);
    expect(lines).toEqual([{ variant_id: mug, quantity: 1 }]);
    await refusedBy(db().execute(sql`update commerce.form_payments set cart_id = gen_random_uuid() where response_id = ${responses[0].id}::uuid`), /form_payments\.fixed/);

    // An order placed from a response's cart and paid is its order (a placed order of another cart stands for it here).
    const order = await place(store.storeId, [["DEMO-MUG-WHITE", 1]]);
    const [placed] = await db().execute<Row>(sql`select cart_id, number from commerce.orders where id = ${order.orderId}::uuid`);
    const second = await admin.saveForm(actor(), null, { ...contact(), paymentVariantId: mug });
    if (!second.ok) throw new Error("second");
    await admin.keepResponse({ formId: second.id, answers: [{ label: "Name", value: "Kari" }], contactEmail: null, path: "/", locale: "en", delivery: "sent" });
    const [kept] = (await admin.listResponses(store.storeId, second.id)).responses;
    await db().execute(sql`
      insert into commerce.form_payments (response_id, store_id, cart_id, variant_id, created_at)
      values (${kept.id}::uuid, ${store.storeId}::uuid, ${String(placed.cart_id)}::uuid, ${mug}::uuid, now() - interval '1 minute')
    `);
    expect((await admin.listResponses(store.storeId, second.id)).responses[0].payment).toEqual({ state: "waiting" });
    await pay(store.storeId, order, store.account);
    expect((await admin.listResponses(store.storeId, second.id)).responses[0].payment).toEqual({ state: "paid", orderId: order.orderId, number: String(placed.number) });
  });

  it("keeps the response and says it was sent when the payment cannot start", async () => {
    const mug = await variantId(store.storeId, "DEMO-MUG-WHITE");
    const made = await admin.saveForm(actor(), null, { ...contact(), paymentVariantId: mug });
    if (!made.ok) throw new Error("made");
    await publish(made.id, `kurs-off-${run}`);
    await db().execute(sql`update commerce.payment_providers set enabled = false where store_id = ${store.storeId}::uuid`);
    try {
      const sent = await submitForm(
        { store: store.storeId, block: made.id, values: { q1: "Ola", q2: `ola-${run}@example.com`, q3: "Hi" }, consent: false, website: "", lang: "en", path: "/", elapsed: 5000, market: "no" },
        `visitor-off-${run}`,
      );
      expect(sent).toEqual({ status: 200, body: { ok: true, outcome: "sent" } });
      const { responses } = await admin.listResponses(store.storeId, made.id);
      expect(responses).toHaveLength(1);
      expect(responses[0].payment).toBeNull();
    } finally {
      await db().execute(sql`update commerce.payment_providers set enabled = true where store_id = ${store.storeId}::uuid`);
    }
  });
});
