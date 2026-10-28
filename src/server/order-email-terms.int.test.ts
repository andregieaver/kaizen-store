import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock("./stripe", () => ({
  platformStripe: () => ({
    checkout: { sessions: { retrieve: async (id: string) => ({ id, payment_intent: `pi_for_${id}`, invoice: null }) } },
    invoices: { retrieve: async (id: string) => ({ id, payments: { data: [] } }) },
  }),
  platformPublishableKey: () => "pk_test_x",
  platformModes: () => ["test"],
  WEBHOOK_EVENTS: [],
}));

const { sendOrderConfirmation } = await import("./shopper-emails");
const { newStore, pay, place } = await import("./inventory-test-support");

type Row = Record<string, unknown>;
let storeId: string;
let account: string;

beforeAll(async () => {
  const made = await newStore("terms-mail");
  storeId = made.storeId;
  account = made.account;
});

afterAll(async () => {
  await closeDb();
});

/**
 * The order confirmation names the store's terms the order was placed under (D379): when and whether ticked, and a link to each text as it was
 * kept, opened by the order page's own key; an order that kept no terms says nothing of them.
 */
describe("the order confirmation and the terms accepted", () => {
  async function confirmation(withTerms: boolean): Promise<{ html: string; orderId: string; key: string }> {
    const order = await place(storeId, [["DEMO-MUG-WHITE", 1]]);
    if (withTerms) {
      const [snapshot] = await db().execute<Row>(sql`
        insert into commerce.legal_snapshots (store_id, role, locale, title, content, content_hash)
        values (${storeId}::uuid, 'terms', 'en-IE', 'Terms of sale', '{}'::jsonb, ${"a".repeat(64)})
        on conflict (store_id, role, locale, content_hash) do update set title = excluded.title
        returning id
      `);
      await db().execute(sql`
        insert into commerce.order_terms (order_id, store_id, mode, locale, snapshots)
        values (${order.orderId}::uuid, ${storeId}::uuid, 'checkbox', 'en-IE',
          ${JSON.stringify([{ role: "terms", snapshotId: String(snapshot.id), hash: "a".repeat(64), title: "Terms of sale" }])}::jsonb)
      `);
    }
    await pay(storeId, order, account);
    await db().execute(sql`update commerce.orders set email = ${`terms-${order.orderId.slice(0, 8)}@example.com`}, locale = 'en-IE' where id = ${order.orderId}::uuid`);
    await sendOrderConfirmation(storeId, order.orderId);
    const [mail] = await db().execute<Row>(sql`select html from commerce.email_messages where store_id = ${storeId}::uuid and order_id = ${order.orderId}::uuid`);
    const [payment] = await db().execute<Row>(sql`select provider_reference from commerce.payments where order_id = ${order.orderId}::uuid order by created_at limit 1`);
    return { html: String(mail.html).replace(/&amp;/g, "&"), orderId: order.orderId, key: String(payment.provider_reference) };
  }

  it("says the terms were ticked and links each text as kept, with the order page's key", async () => {
    const { html, orderId, key } = await confirmation(true);
    expect(html).toContain("Terms you accepted");
    expect(html).toContain("You ticked these texts when you ordered on");
    expect(html).toContain("Terms of sale");
    expect(html).toContain(`/order/${orderId}/terms/terms?session_id=${encodeURIComponent(key)}`);
  });

  it("says nothing of terms for an order that kept none", async () => {
    const { html } = await confirmation(false);
    expect(html).not.toContain("Terms you accepted");
  });
});
