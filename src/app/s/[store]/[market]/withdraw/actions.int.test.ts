import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { FIELD, lineField, type WithdrawState } from "@/lib/withdraw-form";
import type { Store } from "@/server/stores";

type Row = Record<string, unknown>;

/**
 * The withdrawal function's action (D153), against a real database: what the page's form sends and what it gets back. The
 * shop and the signed-in customer are the only things replaced; the rules, the database and the emails are the real ones.
 */

const run = Date.now().toString(36);
let store: Pick<Store, "id" | "slug" | "timeZone">;
let signedIn: { id: string; email: string; name: string } | null = null;

vi.mock("@/server/shop", () => ({
  resolveShop: async (slug: string) => (slug === store.slug ? { store, market: { slug: "no", code: "NO", lang: "nb", locale: "nb-NO" }, ab: {} } : null),
}));
vi.mock("@/server/customers", async (original) => ({ ...(await original<typeof import("@/server/customers")>()), getCustomer: async () => signedIn }));

// An email provider that accepts everything: an acknowledgement only counts as sent once it was handed to one.
process.env.RESEND_API_KEY = "re_test_key";
process.env.EMAIL_FROM = "butikk@example.com";
let emailCount = 0;
vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ id: `em_wd_${++emailCount}` }), { status: 200, headers: { "content-type": "application/json" } }));

const { withdrawAction } = await import("./actions");
const { DELAY_FLOOR_MS } = await import("@/server/withdrawals");

beforeAll(async () => {
  const slug = `wd-${run}`;
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Testbutikk') returning id
  `);
  const [made] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Testbutikk', null) as id`);
  await db().execute(sql`update commerce.stores set contact_email = 'butikk@example.com', time_zone = 'Europe/Oslo' where id = ${String(made.id)}::uuid`);
  store = { id: String(made.id), slug, timeZone: "Europe/Oslo" };
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await closeDb();
});

beforeEach(() => {
  signedIn = null;
});

let seq = 0;
type Placed = { orderId: string; number: string; email: string; key: string; lines: { id: string; title: string; quantity: number }[] };

/** A paid order of goods, as the order page's Checkout return leaves it: not yet delivered, so the right is open. */
async function paidOrder(
  items: { title: string; quantity: number; exclusion?: string }[],
  over: { deliveredDaysAgo?: number; customerId?: string; company?: boolean } = {},
): Promise<Placed> {
  const n = ++seq;
  const number = `WD${run}${n}`.toUpperCase();
  const email = `shopper${n}-${run}@example.com`;
  const key = `cs_${number}`;
  const [order] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, customer_id, company_name,
      subtotal_minor, shipping_minor, tax_minor, total_minor, billing_address, shipping_address, delivered_at)
    values (${store.id}::uuid, ${number}, 'NO', 'NOK', 'nb-NO', ${email}, 'paid', ${over.customerId ?? null}, ${over.company ? "Firma AS" : null},
      ${items.length * 20_000}, 0, ${items.length * 4_000}, ${items.length * 20_000}, '{}', '{}',
      ${over.deliveredDaysAgo === undefined ? null : sql`now() - ${`${over.deliveredDaysAgo} days`}::interval`})
    returning id
  `);
  const orderId = String(order.id);
  const lines: Placed["lines"] = [];
  for (const item of items) {
    const [line] = await db().execute<Row>(sql`
      insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, total_minor, tax_minor, tax_rate, tax_code, withdrawal_exclusion)
      values (${store.id}::uuid, ${orderId}::uuid, ${`SKU-${n}-${lines.length}`}, ${item.title}, ${item.quantity}, 20000, ${item.quantity * 20_000},
              ${item.quantity * 4_000}, 0.25, 'txcd_99999999', ${item.exclusion ?? "none"}::commerce.withdrawal_exclusion)
      returning id
    `);
    lines.push({ id: String(line.id), title: item.title, quantity: item.quantity });
  }
  await db().execute(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
    values (${store.id}::uuid, ${orderId}::uuid, 'stripe', ${key}, ${items.length * 20_000}, 'NOK', 'captured')
  `);
  return { orderId, number, email, key, lines };
}

const initial = (): WithdrawState => ({
  phase: "form",
  values: { name: "", email: "", orderNumber: "" },
  orderKey: null,
  order: null,
  picked: null,
  errors: {},
  notice: null,
  returned: null,
  serial: 0,
});

function formOf(fields: Record<string, string | undefined>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) data.set(key, value);
  return data;
}

const send = (previous: WithdrawState, fields: Record<string, string | undefined>) => withdrawAction(store.slug, "no", previous, formOf(fields));
const identity = (o: Placed, over: Record<string, string> = {}) => ({ [FIELD.name]: "Kari Nordmann", [FIELD.email]: o.email, [FIELD.orderNumber]: o.number, ...over });

function as<P extends WithdrawState["phase"]>(state: WithdrawState, phase: P): Extract<WithdrawState, { phase: P }> {
  if (state.phase !== phase) throw new Error(`expected ${phase}, got ${JSON.stringify(state)}`);
  return state as Extract<WithdrawState, { phase: P }>;
}

describe("step 1: the statement", () => {
  it("finds the order and declares everything that can be withdrawn when no line was shown, then lists it for confirming", async () => {
    const order = await paidOrder([{ title: "Lampe", quantity: 2 }, { title: "Kopp med navn", quantity: 1, exclusion: "custom_made" }]);
    const state = as(await send(initial(), { [FIELD.intent]: "start", ...identity(order) }), "confirm");
    expect(state.request.orderNumber).toBe(order.number);
    // Only the line with the right is declared, in full; the excluded one is not.
    expect(state.request.lines).toEqual([{ lineId: order.lines[0].id, title: "Lampe", quantity: 2 }]);
    expect(state.order.lines.map((l) => [l.title, l.right, l.refusal])).toEqual([
      ["Kopp med navn", "none", "excluded_by_law"],
      ["Lampe", "withdrawal", null],
    ]);
    expect(state.serial).toBe(1);
    // Nothing is a withdrawal yet: a pending request, no return.
    const [pending] = await db().execute<Row>(sql`select status from commerce.withdrawal_requests where id = ${state.request.id}::uuid`);
    expect(pending.status).toBe("pending");
    expect(Number((await db().execute<Row>(sql`select count(*)::int as n from commerce.returns where order_id = ${order.orderId}::uuid`))[0].n)).toBe(0);
    // Nothing the browser must keep: the state holds no secret but the request's own id.
    expect(JSON.stringify(state)).not.toContain(order.key);
  });

  it("answers a wrong email and a wrong order number in the same shape, after the same delay as a match", async () => {
    const order = await paidOrder([{ title: "Lampe", quantity: 1 }]);
    const timed = async (fields: Record<string, string>) => {
      const startedAt = Date.now();
      const state = await send(initial(), { [FIELD.intent]: "start", ...fields });
      return { state, ms: Date.now() - startedAt };
    };
    const wrongEmail = await timed(identity(order, { [FIELD.email]: "someone-else@example.com" }));
    const wrongNumber = await timed(identity(order, { [FIELD.orderNumber]: "NO-SUCH-ORDER" }));
    const match = await timed(identity(order));
    for (const { state } of [wrongEmail, wrongNumber]) {
      const form = as(state, "form");
      expect(form).toMatchObject({ notice: "unmatched", order: null, errors: {}, picked: null, returned: null });
      expect(form.values.orderNumber).not.toBe("");
    }
    // The two mismatches are the same state but for what was typed, and neither says which part was wrong.
    expect({ ...as(wrongEmail.state, "form"), values: null }).toEqual({ ...as(wrongNumber.state, "form"), values: null });
    // A mismatch and a match both wait out the floor, so the clock tells nothing.
    for (const { ms } of [wrongEmail, wrongNumber, match]) expect(ms).toBeGreaterThanOrEqual(DELAY_FLOOR_MS - 60);
    expect(as(match.state, "confirm").request.lines.length).toBe(1);
  });

  it("never finds another store's order, or one with the right order number and nothing else", async () => {
    const order = await paidOrder([{ title: "Lampe", quantity: 1 }]);
    const state = as(await send(initial(), { [FIELD.intent]: "start", [FIELD.name]: "Kari", [FIELD.email]: "x@example.com", [FIELD.orderNumber]: order.number }), "form");
    expect(state.notice).toBe("unmatched");
    // Nor does a wrong order key help.
    const wrongKey = as(await send(initial(), { [FIELD.intent]: "start", ...identity(order, { [FIELD.email]: "x@example.com", [FIELD.orderKey]: "cs_not_it" }) }), "form");
    expect(wrongKey.notice).toBe("unmatched");
  });

  it("proves the order by its key instead of the email, as the link from the order page does", async () => {
    const order = await paidOrder([{ title: "Lampe", quantity: 1 }]);
    const state = as(await send(initial(), { [FIELD.intent]: "start", ...identity(order, { [FIELD.email]: "other-address@example.com", [FIELD.orderKey]: order.key }) }), "confirm");
    expect(state.values.email).toBe("other-address@example.com");
    expect(state.orderKey).toBe(order.key);
  });

  it("lets a signed-in customer withdraw from their own order without typing the email", async () => {
    const [customer] = await db().execute<Row>(sql`
      insert into commerce.customers (store_id, email, name) values (${store.id}::uuid, ${`kunde-${run}@example.com`}, 'Kari') returning id, email
    `);
    signedIn = { id: String(customer.id), email: String(customer.email), name: "Kari" };
    const order = await paidOrder([{ title: "Lampe", quantity: 1 }], { customerId: String(customer.id) });
    const state = as(await send(initial(), { [FIELD.intent]: "start", [FIELD.name]: "Kari", [FIELD.orderNumber]: order.number }), "confirm");
    // The customer's own address fills the field, and the acknowledgement goes there.
    expect(state.values.email).toBe(String(customer.email));
    // Someone else's order is still not theirs.
    const other = await paidOrder([{ title: "Vase", quantity: 1 }]);
    expect(as(await send(initial(), { [FIELD.intent]: "start", [FIELD.name]: "Kari", [FIELD.orderNumber]: other.number }), "form").notice).toBe("unmatched");
  });

  it("checks the fields before anything is looked up, and says which field and why", async () => {
    const state = as(await send(initial(), { [FIELD.intent]: "start", [FIELD.name]: "", [FIELD.email]: "not-an-email", [FIELD.orderNumber]: "" }), "form");
    expect(state.errors).toEqual({ name: "required", email: "email", orderNumber: "required" });
    expect(state.notice).toBeNull();
    // What was typed is kept.
    expect(state.values.email).toBe("not-an-email");
  });

  it("takes only the lines the shopper left ticked, with their numbers", async () => {
    const order = await paidOrder([{ title: "Lampe", quantity: 3 }, { title: "Vase", quantity: 1 }]);
    const [lamp, vase] = order.lines;
    // Opened from the order page: the lines were shown, so the form posts its choice.
    const shown = as(await send(initial(), { [FIELD.intent]: "start", ...identity(order, { [FIELD.orderKey]: order.key }) }), "confirm");
    const edit = as(await send(shown, { [FIELD.intent]: "edit", ...identity(order, { [FIELD.orderKey]: order.key }), [lineField("pick", lamp.id)]: "3", [lineField("pick", vase.id)]: "1" }), "form");
    expect(edit.order?.lines.length).toBe(2);
    expect(edit.picked).toEqual({ [lamp.id]: 3, [vase.id]: 1 });

    const state = as(
      await send(edit, {
        [FIELD.intent]: "start",
        ...identity(order, { [FIELD.orderKey]: order.key }),
        [FIELD.linesShown]: "1",
        [lineField("take", lamp.id)]: "on",
        [lineField("qty", lamp.id)]: "2",
        [lineField("qty", vase.id)]: "1",
      }),
      "confirm",
    );
    expect(state.request.lines).toEqual([{ lineId: lamp.id, title: "Lampe", quantity: 2 }]);
  });

  it("says what is wrong when nothing is ticked, or more than is left is asked for", async () => {
    const order = await paidOrder([{ title: "Lampe", quantity: 2 }]);
    const [lamp] = order.lines;
    const base = { [FIELD.intent]: "start", ...identity(order), [FIELD.linesShown]: "1" };
    const known = as(await send(initial(), { [FIELD.intent]: "start", ...identity(order) }), "confirm").order;
    const previous = { ...initial(), order: known };

    const none = as(await send(previous, base), "form");
    expect(none.errors).toEqual({ lines: "lines" });
    expect(none.order).toEqual(known);

    const tooMany = as(await send(previous, { ...base, [lineField("take", lamp.id)]: "on", [lineField("qty", lamp.id)]: "9" }), "form");
    expect(tooMany.notice).toBe("quantity");
    expect(tooMany.picked).toEqual({ [lamp.id]: 9 });

    const zero = as(await send(previous, { ...base, [lineField("take", lamp.id)]: "on", [lineField("qty", lamp.id)]: "" }), "form");
    expect(zero.errors.lines).toBe("quantity");
  });

  it("says plainly that nothing can be withdrawn when the whole order is out of reach", async () => {
    const order = await paidOrder([{ title: "Kopp med navn", quantity: 1, exclusion: "custom_made" }]);
    const state = as(await send(initial(), { [FIELD.intent]: "start", ...identity(order) }), "form");
    expect(state.notice).toBe("nothing");
    expect(state.order?.lines[0]).toMatchObject({ right: "none", refusal: "excluded_by_law", exclusion: "custom_made" });
  });

  it("refuses an unknown button and an unknown store without doing anything", async () => {
    const order = await paidOrder([{ title: "Lampe", quantity: 1 }]);
    expect(as(await send(initial(), { [FIELD.intent]: "delete", ...identity(order) }), "form").notice).toBe("failed");
    expect(as(await withdrawAction("no-such-store", "no", initial(), formOf({ [FIELD.intent]: "start", ...identity(order) })), "form").notice).toBe("failed");
  });
});

describe("step 2: the confirmation", () => {
  it("makes the withdrawal, returns the acknowledgement with its reference, and is the same when pressed again", async () => {
    const order = await paidOrder([{ title: "Lampe", quantity: 2 }]);
    const confirm = as(await send(initial(), { [FIELD.intent]: "start", ...identity(order) }), "confirm");
    const done = as(await send(confirm, { [FIELD.intent]: "confirm", ...identity(order), [FIELD.requestId]: confirm.request.id }), "done");
    expect(done.done).toMatchObject({
      orderNumber: order.number,
      timeZone: "Europe/Oslo",
      reference: `${order.number}-R1`,
      sent: true,
      email: order.email,
      returns: [{ number: `${order.number}-R1`, token: expect.stringMatching(/^[0-9a-f]{32,}$/) }],
    });
    expect(done.done.text).toContain(`${order.number}-R1`);
    expect(Date.parse(done.done.refundBy) - Date.parse(done.done.confirmedAt)).toBe(14 * 86_400_000);
    expect(done.done.sendBackBy).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const [email] = await db().execute<Row>(sql`select subject from commerce.email_messages where order_id = ${order.orderId}::uuid and kind = 'return.acknowledgement'`);
    expect(String(email.subject)).toContain(order.number);

    // A second press (a double click, a refresh that posts again) writes and sends nothing more.
    const again = as(await send(confirm, { [FIELD.intent]: "confirm", ...identity(order), [FIELD.requestId]: confirm.request.id }), "done");
    expect(again.done.returns).toEqual(done.done.returns);
    expect(Number((await db().execute<Row>(sql`select count(*)::int as n from commerce.returns where order_id = ${order.orderId}::uuid`))[0].n)).toBe(1);
    expect(Number((await db().execute<Row>(sql`select count(*)::int as n from commerce.email_messages where order_id = ${order.orderId}::uuid and kind = 'return.acknowledgement'`))[0].n)).toBe(1);
  });

  it("says the acknowledgement could not be sent while no email provider is set up, and does not name an address as having it", async () => {
    const saved = { key: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM };
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    try {
      const order = await paidOrder([{ title: "Lampe", quantity: 1 }]);
      const confirm = as(await send(initial(), { [FIELD.intent]: "start", ...identity(order) }), "confirm");
      const done = as(await send(confirm, { [FIELD.intent]: "confirm", ...identity(order), [FIELD.requestId]: confirm.request.id }), "done");
      expect(done.done).toMatchObject({ sent: false, reference: `${order.number}-R1` });
      // The page still shows the acknowledgement itself, so the shopper has it.
      expect(done.done.text).toContain(`${order.number}-R1`);
      const [request] = await db().execute<Row>(sql`select acknowledged_at from commerce.withdrawal_requests where id = ${confirm.request.id}::uuid`);
      expect(request.acknowledged_at).toBeNull();
    } finally {
      process.env.RESEND_API_KEY = saved.key;
      process.env.EMAIL_FROM = saved.from;
    }
  });

  it("is the act: until the button is pressed there is no return, and a request nobody confirmed stays pending", async () => {
    const order = await paidOrder([{ title: "Lampe", quantity: 1 }]);
    const confirm = as(await send(initial(), { [FIELD.intent]: "start", ...identity(order) }), "confirm");
    // Opening step 2 again (a refresh, a scanner) is the same pending request and changes nothing.
    const refreshed = as(await send(initial(), { [FIELD.intent]: "start", ...identity(order) }), "confirm");
    expect(refreshed.request.id).toBe(confirm.request.id);
    expect(Number((await db().execute<Row>(sql`select count(*)::int as n from commerce.returns where order_id = ${order.orderId}::uuid`))[0].n)).toBe(0);
  });

  it("says the request lapsed when it was not confirmed in time, and shows what can be withdrawn again", async () => {
    const order = await paidOrder([{ title: "Lampe", quantity: 1 }]);
    const confirm = as(await send(initial(), { [FIELD.intent]: "start", ...identity(order) }), "confirm");
    // Time passing: the app cannot age a request, so the rule's own trigger is set aside for the test.
    await db().execute(sql`alter table commerce.withdrawal_requests disable trigger user`);
    try {
      await db().execute(sql`update commerce.withdrawal_requests set submitted_at = now() - interval '2 days', expires_at = now() - interval '1 day' where id = ${confirm.request.id}::uuid`);
    } finally {
      await db().execute(sql`alter table commerce.withdrawal_requests enable trigger user`);
    }
    const state = as(await send(confirm, { [FIELD.intent]: "confirm", ...identity(order), [FIELD.requestId]: confirm.request.id }), "form");
    expect(state.notice).toBe("lapsed");
    expect(state.order?.lines[0]).toMatchObject({ right: "withdrawal" });
    expect(state.values.orderNumber).toBe(order.number);
  });

  it("refuses an id that is not a request of this store without saying more", async () => {
    const order = await paidOrder([{ title: "Lampe", quantity: 1 }]);
    const confirm = as(await send(initial(), { [FIELD.intent]: "start", ...identity(order) }), "confirm");
    const state = as(await send(confirm, { [FIELD.intent]: "confirm", ...identity(order), [FIELD.requestId]: "6f1f3a1e-2b7c-4e0e-9a55-0c4c7a1d9b10" }), "form");
    expect(state.notice).toBe("failed");
    expect(as(await send(confirm, { [FIELD.intent]: "confirm", ...identity(order), [FIELD.requestId]: "not-an-id" }), "form").notice).toBe("failed");
  });
});

describe("the store's own window: a return request", () => {
  it("is offered for goods past the 14 days, and sent to the store with a reason", async () => {
    await db().execute(sql`
      insert into commerce.return_settings (store_id, window_days) values (${store.id}::uuid, 60)
      on conflict (store_id) do update set window_days = 60
    `);
    try {
      const order = await paidOrder([{ title: "Lampe", quantity: 2 }], { deliveredDaysAgo: 30 });
      const [lamp] = order.lines;
      const shown = as(await send(initial(), { [FIELD.intent]: "start", ...identity(order) }), "form");
      // The statutory period is over: nothing to withdraw, but the store's window takes it back.
      expect(shown).toMatchObject({ notice: "nothing", order: { right: "return", window: { state: "voluntary" } } });
      expect(shown.order?.lines[0]).toMatchObject({ right: "return", max: 2 });

      const sent = as(
        await send(shown, {
          [FIELD.intent]: "return",
          ...identity(order),
          [lineField("rtake", lamp.id)]: "on",
          [lineField("rqty", lamp.id)]: "1",
          [FIELD.reason]: "too_big",
          [FIELD.note]: "Passer ikke i stua",
        }),
        "form",
      );
      expect(sent.returned).toMatchObject({ number: `${order.number}-R1`, token: expect.stringMatching(/^[0-9a-f]{32,}$/) });
      const [ret] = await db().execute<Row>(sql`select kind, status, reason, reason_note from commerce.returns where order_id = ${order.orderId}::uuid`);
      expect(ret).toMatchObject({ kind: "return", status: "requested", reason: "too_big", reason_note: "Passer ikke i stua" });
      // The store answers; the shopper only follows it.
      expect(Number((await db().execute<Row>(sql`select count(*)::int as n from commerce.withdrawal_requests where order_id = ${order.orderId}::uuid`))[0].n)).toBe(0);

      // No line chosen, and a reason that is not on the list, are told apart.
      expect(as(await send(shown, { [FIELD.intent]: "return", ...identity(order) }), "form").errors).toEqual({ lines: "lines" });
      const badReason = as(await send(shown, { [FIELD.intent]: "return", ...identity(order), [lineField("rtake", lamp.id)]: "on", [lineField("rqty", lamp.id)]: "1", [FIELD.reason]: "whim" }), "form");
      expect(badReason.errors.reason).toBe("reason");
      // A return request for another shopper's order is the same "unmatched".
      const stranger = as(await send(shown, { [FIELD.intent]: "return", ...identity(order, { [FIELD.email]: "x@example.com" }), [lineField("rtake", lamp.id)]: "on", [lineField("rqty", lamp.id)]: "1" }), "form");
      expect(stranger.notice).toBe("unmatched");
      expect(stranger.returned).toBeNull();
    } finally {
      await db().execute(sql`delete from commerce.return_settings where store_id = ${store.id}::uuid`);
    }
  });

  it("says the period is over when the store has no longer window", async () => {
    const order = await paidOrder([{ title: "Lampe", quantity: 1 }], { deliveredDaysAgo: 30 });
    const state = as(await send(initial(), { [FIELD.intent]: "start", ...identity(order) }), "form");
    expect(state).toMatchObject({ notice: "nothing", order: { right: "none", window: { state: "closed" } } });
    expect(state.order?.lines[0]).toMatchObject({ refusal: "period_over" });
  });
});
