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
const support = await import("./inventory-test-support");
const { clearLevels, mainLocation, newStore, pay, place, setLevel } = support;

type Row = Record<string, unknown>;
let storeId: string;
let account: string;
let main: string;

beforeAll(async () => {
  const made = await newStore("backorder-mail");
  storeId = made.storeId;
  account = made.account;
  main = await mainLocation(storeId);
});

afterAll(async () => {
  await closeDb();
});

/** The words of the order confirmation a shopper is sent, as plain text (the seed's thermos keeps selling at zero, "within 7 days"). */
async function confirmationFor(lines: [string, number][], locale: string): Promise<{ html: string; text: string }> {
  const order = await place(storeId, lines);
  await pay(storeId, order, account);
  await db().execute(sql`update commerce.orders set email = ${`mail-${order.orderId.slice(0, 8)}@example.com`}, locale = ${locale} where id = ${order.orderId}::uuid`);
  await sendOrderConfirmation(storeId, order.orderId);
  const [mail] = await db().execute<Row>(sql`select html, text from commerce.email_messages where store_id = ${storeId}::uuid and order_id = ${order.orderId}::uuid`);
  const plain = (value: unknown) =>
    String(value ?? "")
      .replace(/<!-- -->/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/\s+/g, " ");
  return { html: plain(mail.html), text: plain(mail.text) };
}

describe("the order confirmation of a line on backorder (wave 3, D172)", () => {
  it("says how many of the units are on backorder and within how many days they are expected to ship, never a date", async () => {
    await clearLevels(storeId, "DEMO-THERMOS");
    await setLevel(storeId, "DEMO-THERMOS", main, 3);
    const { html, text } = await confirmationFor([["DEMO-THERMOS", 5]], "en-IE");
    const sentence = "2 of 5 on backorder: expected to ship within 7 days of your order";
    expect(html).toContain(sentence);
    expect(text).toContain(sentence);
    expect(html).not.toMatch(/in stock|\d{4}-\d{2}-\d{2}.*backorder/i);
  });

  it("reads in the order's language, by hand", async () => {
    await clearLevels(storeId, "DEMO-THERMOS");
    await setLevel(storeId, "DEMO-THERMOS", main, 0);
    const nb = await confirmationFor([["DEMO-THERMOS", 1]], "nb-NO");
    expect(nb.html).toContain("1 av 1 på restordre: forventes sendt innen 7 dager etter din bestilling");
  });

  it("says nothing about backorder for an order wholly from stock", async () => {
    await setLevel(storeId, "DEMO-MUG-WHITE", main, 5);
    const { html } = await confirmationFor([["DEMO-MUG-WHITE", 1]], "en-IE");
    expect(html).not.toMatch(/backorder/i);
  });
});
