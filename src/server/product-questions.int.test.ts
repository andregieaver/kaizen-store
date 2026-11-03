import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { newPageContent, pageInput } from "@/lib/page-content";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));

// Email is only kept (`logged`), never sent, without Resend's settings.
delete process.env.RESEND_API_KEY;

const { askProductQuestion, findProductPart, productQuestionRequest } = await import("./product-questions");
const { requestQuote } = await import("./quote-requests");
const support = await import("./support");
const { systemDesk } = await import("./support-desk");
const fixtures = await import("./inventory-test-support");

type Row = Record<string, unknown>;

/**
 * The product question (D431) against a real database: a product layout's question part sends a shopper's question to the store's support
 * inbox as a conversation of source `form`, the product (title, link, chosen variant) its first answer, a copy emailed to the part's own
 * addresses; while the desk is off the question is emailed instead (to the part's addresses, else the store's contact address). The part's
 * fields are read from the published layout, never from the browser; the same spam holds as a page's form. Set to *Request a quote*, the same
 * part makes a request for a quote with its own fields. Email is only logged here.
 */

const run = Date.now().toString(36);
const questionId = `question-${run}`;
const quoteId = `quote-${run}`;
const copyTo = `sales-${run}@example.com`;
let store: Awaited<ReturnType<typeof fixtures.newStore>>;
let productId: string;
let variantId: string;

const layout = pageInput.parse({
  ...newPageContent(),
  title: "Product",
  slug: `layout-${run}`,
  rows: [
    {
      id: "r1",
      type: "row",
      layout: "1",
      columns: [
        {
          id: "c1",
          blocks: [
            { id: "t1", type: "product", part: "title" },
            { id: questionId, type: "product", part: "question", recipients: [copyTo], questionFields: { phone: "optional" } },
            { id: quoteId, type: "product", part: "question", questionKind: "quote", questionFields: { company: "required" } },
          ],
        },
      ],
    },
  ],
});

let visitors = 0;
const ask = (values: Record<string, string>, over: Record<string, unknown> = {}) =>
  askProductQuestion(
    productQuestionRequest.parse({
      store: store.storeId,
      market: "no",
      product: productId,
      variant: variantId,
      block: questionId,
      values,
      website: "",
      lang: "nb",
      path: `/s/${store.slug}/no/p/mug`,
      elapsed: 8000,
      ...over,
    }),
    `pq-visitor-${run}-${++visitors}`,
  );

const setDesk = (mode: string, formMessages = "inbox_and_email") =>
  db().execute(sql`update commerce.support_settings set mode = ${mode}, form_messages = ${formMessages} where store_id = ${store.storeId}::uuid`);
const conversations = () =>
  db().execute<Row>(sql`select * from commerce.support_conversations where store_id = ${store.storeId}::uuid and source = 'form' order by created_at`);
const mailsTo = (address: string) =>
  db().execute<Row>(sql`select subject, html, status from commerce.email_messages where store_id = ${store.storeId}::uuid and to_address = ${address} order by created_at`);

beforeAll(async () => {
  store = await fixtures.newStore("product-question");
  variantId = await fixtures.variantId(store.storeId, "DEMO-MUG-WHITE");
  const [variant] = await db().execute<Row>(sql`select product_id from commerce.product_variants where id = ${variantId}::uuid`);
  productId = String(variant.product_id);
  const [page] = await db().execute<Row>(sql`
    insert into commerce.pages (store_id, type, slug, draft, published, published_at)
    values (${store.storeId}::uuid, 'product_layout', ${`layout-${run}`}, ${JSON.stringify(layout)}::jsonb, ${JSON.stringify(layout)}::jsonb, now())
    returning id
  `);
  await db().execute(sql`update commerce.stores set product_layout_id = ${String(page.id)}::uuid where id = ${store.storeId}::uuid`);
  await support.ensureDesk(systemDesk(store.storeId));
}, 120_000);

afterAll(async () => {
  await db().execute(sql`delete from commerce.form_submissions where store_id = ${store.storeId}::uuid`);
  await closeDb();
});

describe("a product question (D431)", () => {
  it("finds the part in the store's published product layout, and nothing for another id", async () => {
    expect(await findProductPart(store.storeId, questionId)).toMatchObject({ type: "product", part: "question", recipients: [copyTo] });
    expect(await findProductPart(store.storeId, "t1")).toBeNull();
    expect(await findProductPart(store.storeId, "nope")).toBeNull();
  });

  it("goes to the support inbox with the product attached, and a copy to the part's addresses", async () => {
    await setDesk("people");
    const answer = await ask({ name: "Kari Nordmann", email: `kari-${run}@example.com`, phone: "", message: "Tåler den oppvaskmaskin?" });
    expect(answer).toEqual({ status: 200, body: { ok: true, outcome: "sent" } });
    const [c] = await conversations();
    expect(c).toMatchObject({ source: "form", handler: "queue", contact_email: `kari-${run}@example.com`, contact_name: "Kari Nordmann" });
    expect(String(c.email_subject)).toMatch(/^Spørsmål om /);
    const messages = await db().execute<Row>(sql`select body from commerce.support_messages where conversation_id = ${String(c.id)}::uuid order by seq`);
    const body = messages.map((m) => String(m.body)).join("\n");
    // The product first: its title with the chosen variant and its address in the shopper's view, then the question.
    expect(body).toMatch(new RegExp(`^Produkt:\nDemo: Keramikkopp \\(Farge: Hvit\\)\nhttps?://[^\n]+/s/${store.slug}(/no)?/p/demo-keramikkopp`));
    expect(body).toContain("Tåler den oppvaskmaskin?");
    const copies = await mailsTo(copyTo);
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ status: "logged" });
    expect(String(copies[0].html)).toContain("Tåler den oppvaskmaskin?");
  });

  it("is emailed instead while the desk is off, and refused without the email or the question", async () => {
    await setDesk("off");
    const before = (await conversations()).length;
    expect((await ask({ name: "Ola", email: "", message: "Hei" })).status).toBe(422);
    expect((await ask({ name: "Ola", email: `ola-${run}@example.com`, message: "" })).status).toBe(422);
    expect(await ask({ name: "Ola", email: `ola-${run}@example.com`, message: "Finnes den i blått?" })).toMatchObject({ status: 200 });
    expect(await conversations()).toHaveLength(before);
    expect(await mailsTo(copyTo)).toHaveLength(2);
  });

  it("tells a robot it worked and sends nothing, and refuses a part that is not a question", async () => {
    await setDesk("people");
    const before = (await conversations()).length;
    expect(await ask({ name: "Bot", email: "bot@example.com", message: "Buy now" }, { website: "https://spam.example" })).toEqual({ status: 200, body: { ok: true, outcome: "sent" } });
    expect(await conversations()).toHaveLength(before);
    expect((await ask({ name: "Kari", email: "kari@example.com", message: "Hei" }, { block: quoteId })).status).toBe(404);
    expect((await ask({ name: "Kari", email: "kari@example.com", message: "Hei" }, { block: "t1" })).status).toBe(404);
  });

  it("set to Request a quote, asks the part's own fields and makes a request for a quote", async () => {
    await db().execute(sql`
      insert into commerce.order_settings (store_id, quote_requests) values (${store.storeId}::uuid, 'everyone')
      on conflict (store_id) do update set quote_requests = 'everyone'
    `);
    const body = {
      store: store.slug,
      market: "no",
      from: "product",
      lines: [{ variantId, quantity: 4 }],
      name: "Kari Nordmann",
      email: `kari-${run}@example.com`,
      phone: "",
      company: "",
      note: "",
      website: "",
      elapsed: 6000,
      block: quoteId,
    };
    expect(await requestQuote(body, `pq-quote-${run}-1`)).toEqual({ status: 422, body: { ok: false, problems: { company: "required" } } });
    expect(await requestQuote({ ...body, company: "Nordmann AS" }, `pq-quote-${run}-2`)).toEqual({ status: 200, body: { ok: true } });
    // A question part is not a request for a quote.
    expect((await requestQuote({ ...body, block: questionId, company: "Nordmann AS" }, `pq-quote-${run}-3`)).status).toBe(404);
    // A guest's typed company is kept as the request's own (D431), never as the draft's buyer company.
    const drafts = await db().execute<Row>(sql`select request_company, company_name from commerce.draft_orders where store_id = ${store.storeId}::uuid and source = 'quote'`);
    expect(drafts).toEqual([{ request_company: "Nordmann AS", company_name: null }]);
  });
});
