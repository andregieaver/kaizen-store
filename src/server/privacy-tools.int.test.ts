import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Membership } from "./auth";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const ownerTools = await import("./owner-tools");
const stores = await import("./stores");

type Row = Record<string, unknown>;
type Listed = {
  showing: string;
  waiting: { open: number; past_deadline: number; due_within_a_week: number; summary: string };
  requests: { id: string; kind: string; status: string; received: string; due?: string; clock?: string; past_deadline?: boolean; extended?: boolean; admin: string }[];
  page: string;
  note: string;
};
type Explained = {
  request: string;
  status: string;
  outcome?: string;
  clock: { received: string; due: string; extended_until: string | null; now: string; past_deadline?: boolean };
  refusal_reason?: string;
  what_was_done?: { rows: string[]; kept_until?: string; subscriptions_cancelled?: number } | string;
  what_can_be_done: string[];
};

/**
 * The AI manager's privacy tools (wave 1g, D162) against a real database: the log and one request read in the log's own words, counts
 * that agree with what the control center flags, no person anywhere in an answer (no email, note or refusal text), another store's requests
 * never reached, and nothing that exports or erases. There is no money here, so no euro scenario.
 */

const run = Date.now().toString(36);
let member: Membership;
let other: Membership;
const ids: Record<string, string> = {};
let foreign = "";
const ctx = (m: Membership = member) => ({ account: m.account, store: m.store, invalidate: () => {} });
const call = <T>(name: string, args: unknown, m: Membership = member) => ownerTools.runOwnerTool(ctx(m), name as never, args) as Promise<T>;

async function makeMember(name: string): Promise<Membership> {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'Kari', 'Kaffe') returning id`);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Kaffe', null)`);
  const store = (await stores.getStore(name))!;
  const [account] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`${name}@example.com`}`);
  return { account: { id: String(account.id), email: String(account.email), name: "Kari", platformAdmin: false }, store, role: "owner" };
}

const SECRET_NOTE = `note-secret-${run}`;
const EMAILS = ["overdue", "soon", "far", "extended", "answered", "refused"].map((n) => `${n}-${run}@example.com`);

async function insertRequest(m: Membership, key: string, kind: "export" | "erasure", receivedDaysAgo: number, extra: { note?: string; email?: string } = {}) {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.privacy_requests (store_id, kind, channel, status, subject_email, received_at, due_at, note, handled_by)
    values (${m.store.id}::uuid, ${kind}, 'staff', 'open', ${extra.email ?? `${key}-${run}@example.com`}, now() - make_interval(days => ${receivedDaysAgo}),
      now() - make_interval(days => ${receivedDaysAgo}) + interval '1 month', ${extra.note ?? SECRET_NOTE}, ${m.account.id}::uuid)
    returning id
  `);
  return String(row.id);
}

beforeAll(async () => {
  member = await makeMember(`ptools-${run}`);
  other = await makeMember(`ptools-b-${run}`);
}, 60_000);
afterAll(async () => {
  await closeDb();
});

describe("list_privacy_requests", () => {
  it("answers an empty log plainly, never as a problem", async () => {
    const out = await call<Listed>("list_privacy_requests", {});
    expect(out.requests).toEqual([]);
    expect(out.waiting).toMatchObject({ open: 0, past_deadline: 0, due_within_a_week: 0, summary: "No privacy request is open." });
    expect(out.note).toBe("Nothing matches.");
    expect(out.page).toBe(`/admin/${member.store.slug}/privacy`);
  });

  it("lists the log, soonest due first, counted as the control center counts it, and names no person", async () => {
    ids.overdue = await insertRequest(member, "overdue", "erasure", 40);
    ids.soon = await insertRequest(member, "soon", "export", 27);
    ids.far = await insertRequest(member, "far", "export", 5);
    ids.extended = await insertRequest(member, "extended", "export", 20);
    await db().execute(sql`update commerce.privacy_requests set extended_until = received_at + interval '3 months', extension_reason = 'Complex' where id = ${ids.extended}::uuid`);
    const [answered] = await db().execute<Row>(sql`
      insert into commerce.privacy_requests (store_id, kind, channel, status, outcome, subject_email, received_at, due_at, completed_at, handled_by, plan_summary)
      values (${member.store.id}::uuid, 'erasure', 'staff', 'done', 'erased', null, now() - interval '60 days', now() - interval '30 days', now() - interval '50 days', ${member.account.id}::uuid,
        ${JSON.stringify({ rows: [{ table: "orders", action: "restricted", count: 2 }, { table: "wishlists", action: "deleted", count: 1 }], keptUntil: { first: "2031-01-01", last: "2032-01-01" }, subscriptionsCancelled: 1, savedCardsDetached: 0, warnings: [] })}::jsonb)
      returning id
    `);
    ids.answered = String(answered.id);
    const [refused] = await db().execute<Row>(sql`
      insert into commerce.privacy_requests (store_id, kind, channel, status, outcome, subject_email, received_at, due_at, completed_at, refusal_reason, refusal_note, handled_by)
      values (${member.store.id}::uuid, 'export', 'staff', 'refused', 'refused', ${EMAILS[5]}, now() - interval '20 days', now() + interval '10 days', now() - interval '5 days', 'excessive', ${SECRET_NOTE}, ${member.account.id}::uuid)
      returning id
    `);
    ids.refused = String(refused.id);
    // Another store's request is never this store's.
    foreign = await insertRequest(other, "foreign", "export", 40);

    const out = await call<Listed>("list_privacy_requests", {});
    expect(out.waiting).toMatchObject({ open: 4, past_deadline: 1, due_within_a_week: 1 });
    expect(out.waiting.summary).toBe("4 open, 1 past the one-month deadline, 1 due within the week.");
    expect(out.requests.map((r) => r.id)).toEqual([ids.overdue, ids.soon, ids.far, ids.extended]);
    expect(out.requests[0]).toMatchObject({ kind: "Erasure", status: "Open", past_deadline: true, admin: `/admin/${member.store.slug}/privacy/${ids.overdue}` });
    expect(out.requests[0].clock).toMatch(/days overdue$/);
    expect(out.requests[3]).toMatchObject({ extended: true });
    expect(out.requests.map((r) => r.id)).not.toContain(foreign);
    // Nobody is named: not the address, not the staff's note, not the refusal text.
    const text = JSON.stringify(await call<Listed>("list_privacy_requests", { which: "all" }));
    for (const email of EMAILS) expect(text).not.toContain(email);
    expect(text).not.toContain(SECRET_NOTE);
  });

  it("narrows by which, and shows the limit", async () => {
    expect((await call<Listed>("list_privacy_requests", { which: "overdue" })).requests.map((r) => r.id)).toEqual([ids.overdue]);
    expect((await call<Listed>("list_privacy_requests", { which: "due_soon" })).requests.map((r) => r.id)).toEqual([ids.soon]);
    const answered = await call<Listed>("list_privacy_requests", { which: "answered" });
    expect(answered.requests.map((r) => r.id).sort()).toEqual([ids.answered, ids.refused].sort());
    expect(answered.requests.every((r) => r.due === undefined && r.clock === undefined)).toBe(true);
    const all = await call<Listed>("list_privacy_requests", { which: "all", limit: 2 });
    expect(all.requests).toHaveLength(2);
    expect(all.showing).toBe("2 of 6");
    await expect(call("list_privacy_requests", { limit: 500 })).rejects.toThrow("The arguments could not be read");
  });

  it("counts like the control center does, so the two never disagree", async () => {
    const { privacyAttention } = await import("./privacy-attention");
    expect((await privacyAttention([member.store.id])).get(member.store.id)).toEqual({ overdue: 1, dueSoon: 1 });
    // The other store has one overdue request of its own, and only that.
    const out = await call<Listed>("list_privacy_requests", {}, other);
    expect(out.waiting).toMatchObject({ open: 1, past_deadline: 1 });
    expect(out.requests.map((r) => r.id)).toEqual([foreign]);
  });
});

describe("explain_privacy_request", () => {
  it("explains an overdue request: the clock, no extension, and where each step is done", async () => {
    const out = await call<Explained>("explain_privacy_request", { request: ids.overdue });
    expect(out).toMatchObject({ request: ids.overdue, status: "Open", clock: { past_deadline: true } });
    expect(out.clock.now).toMatch(/days overdue$/);
    const steps = out.what_can_be_done.join("\n");
    expect(steps).toMatch(/erase page/);
    expect(steps).toMatch(/cannot be extended/);
    expect(typeof out.what_was_done).toBe("string");
    expect(JSON.stringify(out)).not.toContain(EMAILS[0]);
    expect(JSON.stringify(out)).not.toContain(SECRET_NOTE);
  });

  it("offers the extension while it is allowed, and not again once it was made", async () => {
    expect((await call<Explained>("explain_privacy_request", { request: ids.far })).what_can_be_done.join("\n")).toMatch(/Extend the answer once/);
    const extended = await call<Explained>("explain_privacy_request", { request: ids.extended });
    expect(extended.clock.extended_until).toBeTruthy();
    expect(extended.what_can_be_done.join("\n")).not.toMatch(/Extend the answer once/);
  });

  it("says what an answered erasure did, counted, and what the law kept and until when", async () => {
    const out = await call<Explained>("explain_privacy_request", { request: ids.answered });
    expect(out).toMatchObject({ status: "Done", clock: { now: "Answered" }, what_can_be_done: [] });
    expect(out.outcome).toMatch(/erased/);
    expect(out.what_was_done).toMatchObject({ kept_until: "2031-01-01 to 2032-01-01", subscriptions_cancelled: 1 });
    const rows = (out.what_was_done as { rows: string[] }).rows;
    expect(rows).toHaveLength(2);
    expect(rows.join("\n")).toMatch(/2 .*: kept restricted/);
    expect(rows.join("\n")).toMatch(/1 .*: deleted/);
  });

  it("gives a refusal's reason as the log's own words, never the staff's text", async () => {
    const out = await call<Explained>("explain_privacy_request", { request: ids.refused });
    expect(out.refusal_reason).toBe("The request is excessive (for example, repeated)");
    expect(JSON.stringify(out)).not.toContain(SECRET_NOTE);
    expect(JSON.stringify(out)).not.toContain(EMAILS[5]);
  });

  it("refuses an id that is not one, one that is not found, and another store's", async () => {
    await expect(call("explain_privacy_request", { request: "not-a-request-id" })).rejects.toThrow(ownerTools.OwnerToolError);
    await expect(call("explain_privacy_request", { request: "00000000-0000-4000-8000-000000000000" })).rejects.toThrow("No privacy request");
    await expect(call("explain_privacy_request", { request: foreign })).rejects.toThrow("No privacy request");
    await expect(call("explain_privacy_request", { request: ids.overdue }, other)).rejects.toThrow("No privacy request");
  });

  it("changes nothing: the log is as it was after every read", async () => {
    const before = await db().execute<Row>(sql`select count(*)::int as n, max(updated_at) as at from commerce.privacy_requests where store_id = ${member.store.id}::uuid`);
    await call("list_privacy_requests", { which: "all" });
    await call("explain_privacy_request", { request: ids.overdue });
    const after = await db().execute<Row>(sql`select count(*)::int as n, max(updated_at) as at from commerce.privacy_requests where store_id = ${member.store.id}::uuid`);
    expect(after[0]).toEqual(before[0]);
  });
});

describe("the order tools after an erasure (D162)", () => {
  it("shows a restricted order as a sale and an anonymised one likewise, never the person, and finds neither by the person's email", async () => {
    const [v] = await db().execute<Row>(sql`select id, sku from commerce.product_variants where store_id = ${member.store.id}::uuid limit 1`);
    const place = async (n: number, email: string) => {
      const [o] = await db().execute<Row>(sql`
        insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, tax_minor, total_minor,
          billing_address, shipping_address, placed_at)
        values (${member.store.id}::uuid, ${`${run}-e${n}`}, 'NO', 'NOK', 'nb-NO', ${email}, 'paid', 10000, 0, 2000, 10000,
          ${JSON.stringify({ name: "Kari Nordmann" })}, ${JSON.stringify({ name: "Kari Nordmann", line1: "Gata 1", postalCode: "0150", city: "Oslo", country: "NO" })}, now() - interval '3 days')
        returning id
      `);
      await db().execute(sql`
        insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, total_minor, tax_minor, tax_rate, tax_code)
        values (${member.store.id}::uuid, ${String(o.id)}::uuid, ${String(v.id)}::uuid, ${String(v.sku)}, 'Kopp', 1, 10000, 10000, 2000, 0.25, 'txcd_99999999')
      `);
      await db().execute(sql`
        insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
        values (${member.store.id}::uuid, ${String(o.id)}::uuid, 'stripe', ${`cs_${run}_e${n}`}, 10000, 'NOK', 'captured')
      `);
      return String(o.id);
    };
    const email = `erased-${run}@example.com`;
    const kept = await place(1, email);
    const other = await place(2, `normal-${run}@example.com`);
    const [r] = await db().execute<Row>(sql`select commerce.anonymise_order(${member.store.id}::uuid, ${kept}::uuid, 'erasure') as r`);
    expect(r.r).toBe("restricted");

    type Orders = { orders: { number: string; customer: string; email?: string; total: string }[] };
    const all = await call<Orders>("list_orders", { limit: 50 });
    const restricted = all.orders.find((o) => o.number === `${run}-e1`)!;
    expect(restricted.customer).toBe("(personal data removed or restricted)");
    expect(restricted).not.toHaveProperty("email");
    expect(restricted.total).toMatch(/100[,.]00/);
    expect(JSON.stringify(all.orders.filter((o) => o.number === `${run}-e1`))).not.toContain("Kari");
    // The other order is as always.
    const normal = all.orders.find((o) => o.number === `${run}-e2`)!;
    expect(normal).toMatchObject({ customer: "Kari Nordmann", email: `normal-${run}@example.com` });
    // Searching by the erased person's email or name finds nothing of theirs; the number still works.
    expect((await call<Orders>("list_orders", { search: email })).orders.map((o) => o.number)).not.toContain(`${run}-e1`);
    expect((await call<Orders>("list_orders", { search: "Kari" })).orders.map((o) => o.number)).toEqual(expect.not.arrayContaining([`${run}-e1`]));
    expect((await call<Orders>("list_orders", { search: `${run}-e1` })).orders.map((o) => o.number)).toEqual([`${run}-e1`]);

    const one = await call<{ customer: Record<string, unknown>; total: string; vat: string }>("get_order", { order: `${run}-e1` });
    expect(Object.keys(one.customer)).toEqual(["removed"]);
    expect(JSON.stringify(one)).not.toContain("Kari");
    expect(JSON.stringify(one)).not.toContain(email);
    expect(one.total).toMatch(/100[,.]00/);
    expect(await call<{ customer: Record<string, unknown> }>("get_order", { order: String(other) })).toMatchObject({ customer: { name: "Kari Nordmann" } });
  });
});
