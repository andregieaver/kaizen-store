import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NOT_PERSONAL, PERSONAL_DATA } from "@/lib/personal-data";
import { COPY_RULES } from "@/lib/store-copy-rules";
import { STORE_EXPORT_LEFT_OUT } from "@/lib/store-export-scope";

import { createTestDatabase } from "./testing";

/**
 * Deals and pipelines (S2, D464): the rules the database holds, run against real Postgres (PGlite) with every migration applied. A deal's
 * stage belongs to its pipeline and both to its store, as do its person, company and linked things; closed means a time and a way, lost may
 * say why; one thing belongs to one deal. A paid order, an issued Work invoice, or a link made to something already paid wins its open deals,
 * never a closed one, never by a copied order. Each stage entered and each close is kept, and the clock restarts on a stage change.
 */

let db: PGlite;
let shop: string;
let other: string;
let account: string;
let counter = 0;

type Row = Record<string, unknown>;

async function one<T = Row>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);

async function store(slug: string): Promise<string> {
  const { id } = await one<{ id: string }>("insert into commerce.stores (slug, name, country) values ($1, $1, 'NO') returning id", [slug]);
  await db.query(
    `insert into commerce.markets (store_id, code, currency, default_locale, locales, active)
     select $1, code, currency, default_locale, locales, true from commerce.countries where code = 'NO'`,
    [id],
  );
  return id;
}

async function pipeline(storeId: string, stages: string[] = ["New", "Talking", "Quote sent"]) {
  counter += 1;
  const { id } = await one<{ id: string }>("insert into commerce.deal_pipelines (store_id, name) values ($1, $2) returning id", [storeId, `Sales ${counter}`]);
  const ids: string[] = [];
  for (const [position, name] of stages.entries()) {
    ids.push((await one<{ id: string }>("insert into commerce.deal_stages (store_id, pipeline_id, name, position) values ($1, $2, $3, $4) returning id", [storeId, id, name, position])).id);
  }
  return { id, stages: ids };
}

async function customer(storeId: string): Promise<string> {
  counter += 1;
  return (await one<{ id: string }>("insert into commerce.customers (store_id, email) values ($1, $2) returning id", [storeId, `deal-${counter}@example.com`])).id;
}

async function company(storeId: string): Promise<string> {
  counter += 1;
  return (await one<{ id: string }>("insert into commerce.customer_companies (store_id, name) values ($1, $2) returning id", [storeId, `Kunde ${counter} AS`])).id;
}

async function deal(storeId: string, p: { id: string; stages: string[] }, over: { customer?: string | null; company?: string | null; stage?: string } = {}): Promise<string> {
  counter += 1;
  return (
    await one<{ id: string }>(
      `insert into commerce.deals (store_id, title, customer_id, company_id, pipeline_id, stage_id, currency, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, 'NOK', $7, $7) returning id`,
      [storeId, `Deal ${counter}`, over.customer ?? null, over.company ?? null, p.id, over.stage ?? p.stages[0], account],
    )
  ).id;
}

async function order(storeId: string, over: { draft?: string; copiedFrom?: string; status?: string } = {}): Promise<string> {
  counter += 1;
  return (
    await one<{ id: string }>(
      `insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
         billing_address, shipping_address, draft_id, copied_from, source, made_by)
       values ($1, $2, 'NO', 'NOK', 'nb-NO', 'buyer@example.com', $3::commerce.order_status, 1000, 0, 0, 0, 1000, '{}', '{}', $4, $5,
         case when $4::uuid is null then 'checkout' else 'draft' end, case when $4::uuid is null then null else $6::uuid end) returning id`,
      [storeId, `${over.copiedFrom ? "C-" : ""}${counter}`, over.status ?? "pending_payment", over.draft ?? null, over.copiedFrom ?? null, account],
    )
  ).id;
}

async function draftOrder(storeId: string): Promise<string> {
  counter += 1;
  return (
    await one<{ id: string }>(
      `insert into commerce.draft_orders (store_id, number, market_code, market_slug, currency, locale, email)
       values ($1, $2, 'NO', 'no', 'NOK', 'nb-NO', 'buyer@example.com') returning id`,
      [storeId, `D-${counter}`],
    )
  ).id;
}

const link = (storeId: string, dealId: string, kind: "order" | "draft" | "work_assignment", thing: string) =>
  db.query(
    `insert into commerce.deal_links (store_id, deal_id, kind, order_id, draft_id, assignment_id) values ($1, $2, $3, $4, $5, $6)`,
    [storeId, dealId, kind, kind === "order" ? thing : null, kind === "draft" ? thing : null, kind === "work_assignment" ? thing : null],
  );

const statusOf = async (dealId: string) => one<{ status: string; closed_via: string | null }>("select status, closed_via from commerce.deals where id = $1", [dealId]);

beforeAll(async () => {
  db = await createTestDatabase();
  shop = await store("deals-shop");
  other = await store("deals-other");
  account = (await one<{ id: string }>("insert into commerce.accounts (email) values ('seller@example.com') returning id")).id;
});

afterAll(async () => {
  await db.close();
});

describe("a pipeline and its stages", () => {
  it("names each pipeline once per store, and has at most one quote stage", async () => {
    const p = await pipeline(shop);
    const name = (await one<{ name: string }>("select name from commerce.deal_pipelines where id = $1", [p.id])).name;
    await rejects("insert into commerce.deal_pipelines (store_id, name) values ($1, $2)", [shop, name.toUpperCase()], /deal_pipelines_name_key/);
    await rejects("insert into commerce.deal_pipelines (store_id, name) values ($1, ' padded ')", [shop], /deal_pipelines_name/);
    await db.query("update commerce.deal_stages set quote_stage = true where id = $1", [p.stages[2]]);
    await rejects("update commerce.deal_stages set quote_stage = true where id = $1", [p.stages[1]], /deal_stages_quote_key/);
    await rejects("update commerce.deal_stages set probability = 101 where id = $1", [p.stages[1]], /deal_stages_probability/);
  });

  it("keeps a stage in its own store's pipeline", async () => {
    const p = await pipeline(shop);
    await rejects("insert into commerce.deal_stages (store_id, pipeline_id, name, position) values ($1, $2, 'Elsewhere', 9)", [other, p.id], /deal_stages_pipeline_fk/);
  });
});

describe("a deal", () => {
  it("sits in a stage of its own pipeline, in its own store, with its own store's person and company", async () => {
    const p = await pipeline(shop);
    const q = await pipeline(shop);
    const person = await customer(shop);
    await rejects(
      "insert into commerce.deals (store_id, title, customer_id, pipeline_id, stage_id, currency) values ($1, 'Mixed', $2, $3, $4, 'NOK')",
      [shop, person, p.id, q.stages[0]],
      /deals_stage_fk/,
    );
    const theirs = await customer(other);
    await rejects(
      "insert into commerce.deals (store_id, title, customer_id, pipeline_id, stage_id, currency) values ($1, 'Theirs', $2, $3, $4, 'NOK')",
      [shop, theirs, p.id, p.stages[0]],
      /deals_customer_fk/,
    );
    const theirCompany = await company(other);
    await rejects(
      "insert into commerce.deals (store_id, title, company_id, pipeline_id, stage_id, currency) values ($1, 'Theirs', $2, $3, $4, 'NOK')",
      [shop, theirCompany, p.id, p.stages[0]],
      /deals_company_fk/,
    );
  });

  it("is closed only with a time and a way, and only a closed deal says why", async () => {
    const p = await pipeline(shop);
    const id = await deal(shop, p, { customer: await customer(shop) });
    await rejects("update commerce.deals set status = 'lost' where id = $1", [id], /deals_closed/);
    await rejects("update commerce.deals set close_reason = 'Too dear' where id = $1", [id], /deals_reason/);
    await rejects("update commerce.deals set status = 'won', closed_at = now(), closed_via = 'magic' where id = $1", [id], /deals_closed_via/);
    await rejects("update commerce.deals set estimate_minor = -1 where id = $1", [id], /deals_estimate/);
    await db.query("update commerce.deals set status = 'lost', closed_at = now(), closed_via = 'person', close_reason = 'Too dear' where id = $1", [id]);
    await rejects("update commerce.deals set status = 'open' where id = $1", [id], /deals_closed|deals_reason/);
    await db.query("update commerce.deals set status = 'open', closed_at = null, closed_via = null, close_reason = null where id = $1", [id]);
  });

  it("keeps each stage entered and each close or reopen, and restarts its clock only when its stage changes", async () => {
    const p = await pipeline(shop);
    const id = await deal(shop, p, { customer: await customer(shop) });
    await db.query("update commerce.deals set stage_entered_at = now() - interval '5 days' where id = $1", [id]);
    await db.query("update commerce.deals set title = 'Renamed', stage_id = stage_id where id = $1", [id]);
    expect((await one<{ old: boolean }>("select stage_entered_at < now() - interval '4 days' as old from commerce.deals where id = $1", [id])).old).toBe(true);
    await db.query("update commerce.deals set stage_id = $2 where id = $1", [id, p.stages[1]]);
    expect((await one<{ old: boolean }>("select stage_entered_at < now() - interval '1 minute' as old from commerce.deals where id = $1", [id])).old).toBe(false);
    await db.query("update commerce.deals set status = 'won', closed_at = now(), closed_via = 'person' where id = $1", [id]);
    const { rows } = await db.query<{ stage_id: string; status: string; via: string | null; moved_by: string | null }>(
      "select stage_id, status, via, moved_by from commerce.deal_moves where deal_id = $1 order by id",
      [id],
    );
    expect(rows).toEqual([
      { stage_id: p.stages[0], status: "open", via: null, moved_by: account },
      { stage_id: p.stages[1], status: "open", via: null, moved_by: account },
      { stage_id: p.stages[1], status: "won", via: "person", moved_by: account },
    ]);
  });

  it("loses its person or company when they are deleted, and keeps its store", async () => {
    const p = await pipeline(shop);
    const person = await customer(shop);
    const firm = await company(shop);
    const id = await deal(shop, p, { customer: person, company: firm });
    await db.query("delete from commerce.customers where id = $1", [person]);
    expect(await one("select store_id, customer_id, company_id from commerce.deals where id = $1", [id])).toEqual({ store_id: shop, customer_id: null, company_id: firm });
    await db.query("delete from commerce.customer_companies where id = $1", [firm]);
    expect(await one("select store_id, customer_id, company_id from commerce.deals where id = $1", [id])).toEqual({ store_id: shop, customer_id: null, company_id: null });
  });

  it("takes its links, history and custom fields with it when it is deleted", async () => {
    const p = await pipeline(shop);
    const id = await deal(shop, p, { customer: await customer(shop) });
    await link(shop, id, "draft", await draftOrder(shop));
    await db.query("delete from commerce.deals where id = $1", [id]);
    expect(await one("select count(*)::int as n from commerce.deal_links where deal_id = $1", [id])).toEqual({ n: 0 });
    expect(await one("select count(*)::int as n from commerce.deal_moves where deal_id = $1", [id])).toEqual({ n: 0 });
  });
});

describe("what a deal is linked to", () => {
  it("is one thing of the kind it says, of its own store, in one deal only", async () => {
    const p = await pipeline(shop);
    const a = await deal(shop, p, { customer: await customer(shop) });
    const b = await deal(shop, p, { customer: await customer(shop) });
    const quote = await draftOrder(shop);
    await link(shop, a, "draft", quote);
    await expect(link(shop, b, "draft", quote)).rejects.toThrow(/deal_links_draft_key/);
    await expect(
      db.query("insert into commerce.deal_links (store_id, deal_id, kind, order_id) values ($1, $2, 'draft', $3)", [shop, b, await order(shop)]),
    ).rejects.toThrow(/deal_links_one/);
    await expect(link(shop, b, "order", await order(other))).rejects.toThrow(/deal_links_order_fk/);
  });

  it("goes when the quote it names is deleted", async () => {
    const p = await pipeline(shop);
    const id = await deal(shop, p, { customer: await customer(shop) });
    const quote = await draftOrder(shop);
    await link(shop, id, "draft", quote);
    await db.query("delete from commerce.draft_orders where id = $1", [quote]);
    expect(await one("select count(*)::int as n from commerce.deal_links where deal_id = $1", [id])).toEqual({ n: 0 });
  });
});

describe("a deal won by what it is linked to", () => {
  it("is won when its order is paid, or the order made from its quote", async () => {
    const p = await pipeline(shop);
    const direct = await deal(shop, p, { customer: await customer(shop) });
    const viaQuote = await deal(shop, p, { customer: await customer(shop) });
    const lost = await deal(shop, p, { customer: await customer(shop) });
    const first = await order(shop);
    await link(shop, direct, "order", first);
    const quote = await draftOrder(shop);
    await link(shop, viaQuote, "draft", quote);
    const fromQuote = await order(shop, { draft: quote });
    const third = await order(shop);
    await link(shop, lost, "order", third);
    await db.query("update commerce.deals set status = 'lost', closed_at = now(), closed_via = 'person' where id = $1", [lost]);

    await db.query("update commerce.orders set status = 'paid' where id = any($1)", [[first, fromQuote, third]]);
    expect(await statusOf(direct)).toEqual({ status: "won", closed_via: "order" });
    expect(await statusOf(viaQuote)).toEqual({ status: "won", closed_via: "order" });
    expect(await statusOf(lost)).toEqual({ status: "lost", closed_via: "person" });
    expect(await one("select status, via, moved_by from commerce.deal_moves where deal_id = $1 order by id desc limit 1", [direct])).toEqual({ status: "won", via: "order", moved_by: null });
  });

  it("is won at once when linked to an order already paid, but never by an order copied from another store", async () => {
    const p = await pipeline(shop);
    const now = await deal(shop, p, { customer: await customer(shop) });
    await link(shop, now, "order", await order(shop, { status: "paid" }));
    expect(await statusOf(now)).toEqual({ status: "won", closed_via: "order" });

    const copied = await deal(shop, p, { customer: await customer(shop) });
    await link(shop, copied, "order", await order(shop, { status: "paid", copiedFrom: "00000000-0000-4000-8000-00000000c0b1" }));
    expect(await statusOf(copied)).toEqual({ status: "open", closed_via: null });
  });

  it("is won when a Work invoice for its assignment is issued, or when linked to one already invoiced", async () => {
    const seller = await store("deals-work");
    await db.query(
      `update commerce.stores set legal_name = 'Konsulent AS', organisation_number = '923456789', postal_address = 'Storgata 1, 0155 Oslo',
         contact_email = 'post@konsulent.example', modules = array['work'] where id = $1`,
      [seller],
    );
    await db.query(
      "insert into commerce.work_settings (store_id, vat_registered, vat_number, bank_account, bic) values ($1, true, 'NO923456789MVA', 'NO9386011117947', 'DNBANOKK')",
      [seller],
    );
    const client = (
      await one<{ id: string }>(
        `insert into commerce.work_clients (store_id, name, legal_name, country, billing_address, currency, business, vat_treatment)
         values ($1, 'Kunde', 'Kunde AS', 'NO', $2::jsonb, 'NOK', true, 'domestic') returning id`,
        [seller, JSON.stringify({ line1: "Kundeveien 2", postalCode: "0250", city: "Oslo" })],
      )
    ).id;
    const assignment = async () =>
      (await one<{ id: string }>("insert into commerce.work_assignments (store_id, client_id, name) values ($1, $2, 'Rådgivning') returning id", [seller, client])).id;
    const invoice = async (assignmentId: string) => {
      const id = (
        await one<{ id: string }>("insert into commerce.work_invoices (store_id, client_id, assignment_id, currency) values ($1, $2, $3, 'NOK') returning id", [seller, client, assignmentId])
      ).id;
      await db.query(
        `insert into commerce.work_invoice_lines (store_id, invoice_id, position, assignment_id, description, quantity_hundredths, unit_price_minor, discount_bp, vat_category)
         values ($1, $2, 0, $3, 'Consulting', 150, 100000, 0, 'standard')`,
        [seller, id, assignmentId],
      );
      return id;
    };
    const p = await pipeline(seller);
    const work = await assignment();
    const won = await deal(seller, p, { company: await company(seller) });
    await link(seller, won, "work_assignment", work);
    const draft = await invoice(work);
    expect(await statusOf(won)).toEqual({ status: "open", closed_via: null });
    await db.query("select commerce.issue_work_invoice($1, $2, $3)", [seller, draft, account]);
    expect(await statusOf(won)).toEqual({ status: "won", closed_via: "work_invoice" });

    const invoiced = await assignment();
    await db.query("select commerce.issue_work_invoice($1, $2, $3)", [seller, await invoice(invoiced), account]);
    const late = await deal(seller, p, { company: await company(seller) });
    await link(seller, late, "work_assignment", invoiced);
    expect(await statusOf(late)).toEqual({ status: "won", closed_via: "work_invoice" });
  });
});

describe("a deal moved by its quote", () => {
  it("moves forward to its quote stage when its quote is sent, or when a sent quote is linked, and never back", async () => {
    const s = await store(`quote-move-${counter}`);
    const p = await pipeline(s, ["New", "Talking", "Quote sent", "Negotiating"]);
    await db.query("update commerce.deal_stages set quote_stage = true where id = $1", [p.stages[2]]);
    const stageOf = async (id: string) => (await one<{ stage_id: string }>("select stage_id from commerce.deals where id = $1", [id])).stage_id;
    // Sent as the app sends a quote: the draft goes from open to sent, with the time it was sent.
    const send = async (draft: string) => {
      const made = await order(s, { draft });
      await db.query("update commerce.draft_orders set status = 'sent', order_id = $2, sent_at = now(), expires_at = now() + interval '30 days' where id = $1", [draft, made]);
    };

    // Linked first, then sent: it moves when the quote goes out, and its history says the quote moved it.
    const first = await deal(s, p);
    const draft = await draftOrder(s);
    await link(s, first, "draft", draft);
    expect(await stageOf(first)).toBe(p.stages[0]);
    await send(draft);
    expect(await stageOf(first)).toBe(p.stages[2]);
    expect(await one("select via, moved_by from commerce.deal_moves where deal_id = $1 order by at desc, id desc limit 1", [first])).toEqual({ via: "quote", moved_by: null });

    // A quote already sent moves the deal it is linked to at once.
    const second = await deal(s, p, { stage: p.stages[1] });
    const sent = await draftOrder(s);
    await send(sent);
    await link(s, second, "draft", sent);
    expect(await stageOf(second)).toBe(p.stages[2]);

    // Further on already, or closed: it stays where it is.
    const ahead = await deal(s, p, { stage: p.stages[3] });
    const later = await draftOrder(s);
    await link(s, ahead, "draft", later);
    await send(later);
    expect(await stageOf(ahead)).toBe(p.stages[3]);
    const closed = await deal(s, p);
    await db.query("update commerce.deals set status = 'lost', closed_at = now(), closed_via = 'person' where id = $1", [closed]);
    const lostQuote = await draftOrder(s);
    await link(s, closed, "draft", lostQuote);
    await send(lostQuote);
    expect(await stageOf(closed)).toBe(p.stages[0]);

    // A pipeline with no quote stage moves nothing.
    const plain = await pipeline(s, ["New", "Later"]);
    const unmoved = await deal(s, plain);
    const plainQuote = await draftOrder(s);
    await link(s, unmoved, "draft", plainQuote);
    await send(plainQuote);
    expect(await stageOf(unmoved)).toBe(plain.stages[0]);
  });
});

describe("where a deal's rows go", () => {
  it("is the store's own, never copied, and a person's data only on the deal itself", () => {
    expect(STORE_EXPORT_LEFT_OUT.deal_links).toBe("record");
    expect(STORE_EXPORT_LEFT_OUT.deal_moves).toBe("record");
    for (const table of ["deal_pipelines", "deal_stages", "deals", "deal_links", "deal_moves"]) expect(COPY_RULES[table], table).toBeDefined();
    for (const table of ["deal_pipelines", "deal_stages", "deal_links", "deal_moves"]) expect(NOT_PERSONAL[table], table).toBeDefined();
    expect(PERSONAL_DATA.some((entry) => entry.table === "deals")).toBe(true);
  });
});

describe("the sales feature", () => {
  it("needs nothing else: deals are kept by a store with no online shop too", async () => {
    expect(await one("select commerce.feature_needs('sales') as needs")).toEqual({ needs: [] });
    expect(await one("select commerce.features_effective(array['sales']) as on")).toEqual({ on: ["sales"] });
  });
});
