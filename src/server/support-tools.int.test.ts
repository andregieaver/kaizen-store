import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { formatMoney } from "@/lib/money";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
// The browser's cookies: a jar the tests fill, so a customer's session is the visitor's (or another customer's).
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {}, after: () => {} }));

const { getStore } = await import("./stores");
const support = await import("./support");
const route = await import("./support-route");
const { runTool, supportToolsFor } = await import("./support-tools");
const { createSignInCode, startSession } = await import("./customers");
const { systemDesk } = await import("./support-desk");
type ChatContext = import("./chat-route").ChatContext;
type ToolContext = import("./support-tools").SupportToolContext;

/**
 * The first line's tools for signed-in customers (D216, step 9; docs/support.md C11, C12): they refuse a visitor who is not signed in,
 * find only the customer's own orders (another customer's is "not found"), write amounts in the order's own currency (a euro order
 * shows euros), give links as chips made by code, and treat another customer signed in on the browser as not signed in. The sign-in
 * card's routes answer the same whether or not the email has an account, sign the visitor in and link the conversation to them.
 */

const run = Date.now().toString(36);
let storeId: string;
let slug: string;
let ctx: ChatContext;
let raw: { store: string; market: string };
const ana = { id: "", email: `ana-${run}@example.com` };
const bo = { id: "", email: `bo-${run}@example.com` };
let anaNok = "";
let anaEur = "";
let boOrder = "";

async function customer(email: string): Promise<string> {
  const [row] = await db().execute<Row>(sql`insert into commerce.customers (store_id, email, email_verified_at) values (${storeId}::uuid, ${email}, now()) returning id`);
  return String(row.id);
}

/** A paid order of the customer's, in a currency, sent in a parcel with a tracking page; returns its number. */
async function paidOrder(customerId: string, email: string, currency: string, totalMinor: number, n: number): Promise<string> {
  const number = `ST-${run}-${n}`;
  const [order] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor,
      tax_minor, total_minor, billing_address, shipping_address, placed_at, customer_id)
    values (${storeId}::uuid, ${number}, 'NO', ${currency}, 'nb-NO', ${email}, 'paid', ${totalMinor}, 0, 0, 0, ${totalMinor}, '{}'::jsonb, '{}'::jsonb,
      now() - interval '2 days', ${customerId}::uuid)
    returning id
  `);
  await db().execute(sql`
    insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
    values (${storeId}::uuid, ${String(order.id)}::uuid, ${`SKU-${n}`}, ${`Teapot ${n}`}, 1, ${totalMinor}, 0, ${totalMinor}, 0, 0, 'txcd_99999999', 'physical'::commerce.delivery)
  `);
  await db().execute(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
    values (${storeId}::uuid, ${String(order.id)}::uuid, 'stripe', ${`pi_${run}_${n}`}, 'acct_st', ${totalMinor}, ${currency}, 'captured'::commerce.payment_status)
  `);
  await db().execute(sql`
    insert into commerce.shipments (store_id, order_id, carrier, tracking_number, tracking_url, created_at, legacy)
    values (${storeId}::uuid, ${String(order.id)}::uuid, 'Bring', ${`T-${run}-${n}`}, ${`https://tracking.example.com/T-${run}-${n}`}, now() - interval '1 day', true)
  `);
  return number;
}

beforeAll(async () => {
  slug = `support-tools-${run}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'T', 'T') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Support tools', null) as id`);
  storeId = String(created.id);
  await db().execute(sql`update commerce.stores set status = 'active' where id = ${storeId}::uuid`);
  await db().execute(sql`insert into commerce.support_settings (store_id, mode, tone_on, summaries_on, partner) values (${storeId}::uuid, 'ai_first', false, false, false)`);
  ana.id = await customer(ana.email);
  bo.id = await customer(bo.email);
  anaNok = await paidOrder(ana.id, ana.email, "NOK", 49_900, 1);
  anaEur = await paidOrder(ana.id, ana.email, "EUR", 4_250, 2);
  boOrder = await paidOrder(bo.id, bo.email, "NOK", 12_000, 3);
  const store = (await getStore(slug))!;
  const market = store.markets.find((m) => m.code === "NO")!;
  raw = { store: slug, market: market.slug };
  ctx = {
    site: { kind: "store", store, market },
    storeId,
    lang: market.lang,
    locale: market.locale,
    market: market.slug,
    agent: { storeId, enabled: true, name: "Mia", occupation: "", avatar: null, greeting: {}, instructions: "", voice: false, dailyLimit: 1000 },
    connection: { provider: "openai", source: "store", apiUrl: "https://ai.example.com/v1", apiKey: "sk-test", textModel: "text-model", embeddingModel: null, space: null } as never,
    settings: (await support.deskSettings(systemDesk(storeId)))!,
  };
  const [conversation] = await db().execute<Row>(sql`insert into commerce.support_conversations (store_id, source, handler, token_hash, locale) values (${storeId}::uuid, 'site', 'ai', ${`t-${run}`}, 'nb-NO') returning id`);
  toolConversation = String(conversation.id);
});

afterEach(() => {
  vi.unstubAllGlobals();
  jar.clear();
});
afterAll(async () => closeDb());

let toolConversation = "";
const toolCtx = (customer: ToolContext["customer"]): ToolContext => ({ site: ctx.site as ToolContext["site"], settings: ctx.settings, customer, desk: systemDesk(storeId), conversationId: toolConversation });
const parsed = (outcome: { result: string }) => JSON.parse(outcome.result) as Record<string, unknown>;

/** Signs the browser in as a customer (the session cookie, as the store's sign-in sets it). */
const signIn = (who: { id: string }) => startSession(storeId, who.id);

describe("the first line's tools (C11, C12)", () => {
  it("are offered to a visitor who is not signed in, and refuse them", async () => {
    const tools = (await supportToolsFor(toolCtx(null)))!;
    const names = tools.definitions.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["ask_to_sign_in", "my_orders", "order_details", "return_options", "check_code"]));
    expect(names).toEqual(expect.arrayContaining(["propose_action", "request_staff_action"]));
    // Tools of features the store has off are not offered to a visitor who is not signed in; their handlers refuse all the same.
    for (const name of ["my_orders", "order_details", "return_options", "my_bookings", "my_subscriptions", "my_boxes", "bonus_balance"]) {
      const outcome = names.includes(name) ? await tools.run(name, { number: anaNok }) : await runTool(toolCtx(null), name, { number: anaNok });
      expect(parsed(outcome).error, name).toBe("not_signed_in");
      expect(outcome.chips ?? []).toEqual([]);
    }
    expect(await tools.run("ask_to_sign_in", { why: "To see the order." })).toMatchObject({ card: "sign_in" });
  });

  it("list the signed-in customer's own orders with totals in each order's own currency", async () => {
    const tools = (await supportToolsFor(toolCtx(ana)))!;
    const { orders } = parsed(await tools.run("my_orders", {})) as { orders: { number: string; total: string; status: string }[] };
    expect(orders.map((o) => o.number).sort()).toEqual([anaNok, anaEur].sort());
    const locale = ctx.locale;
    expect(orders.find((o) => o.number === anaNok)!.total).toBe(formatMoney(49_900, "NOK", locale));
    // C12: the euro order is in euros, written by code.
    const euro = orders.find((o) => o.number === anaEur)!;
    expect(euro.total).toBe(formatMoney(4_250, "EUR", locale));
    expect(euro.total).toContain("€");
    expect(orders.map((o) => o.number)).not.toContain(boOrder);
  });

  it("show one of the customer's own orders with its parcel's tracking as a chip, and another customer's is not found (C11)", async () => {
    const tools = (await supportToolsFor(toolCtx(ana)))!;
    const outcome = await tools.run("order_details", { number: ` #${anaEur} ` });
    const details = parsed(outcome);
    expect(details).toMatchObject({ number: anaEur, total: formatMoney(4_250, "EUR", ctx.locale) });
    expect(details.parcels).toEqual([expect.objectContaining({ carrier: "Bring", trackingNumber: `T-${run}-2` })]);
    expect(outcome.chips).toEqual(
      expect.arrayContaining([
        { kind: "tracking", label: `T-${run}-2`, href: `https://tracking.example.com/T-${run}-2` },
        expect.objectContaining({ kind: "order", label: anaEur }),
      ]),
    );
    for (const chip of outcome.chips ?? []) expect(chip.href).toMatch(/^(\/|https:\/\/)/);
    // Bo's order is exactly as unknown as one that does not exist.
    const theirs = await tools.run("order_details", { number: boOrder });
    const none = await tools.run("order_details", { number: `NOPE-${run}` });
    expect(parsed(theirs)).toEqual(parsed(none));
    expect(parsed(theirs).error).toBe("not_found");
    expect(parsed(await tools.run("return_options", { number: boOrder })).error).toBe("not_found");
  });

  it("say what can still be withdrawn from an order, with the withdrawal page as a chip", async () => {
    const outcome = await runTool(toolCtx(ana), "return_options", { number: anaNok });
    const options = parsed(outcome);
    expect(options).toMatchObject({ number: anaNok });
    expect((options.lines as unknown[]).length).toBe(1);
    if (outcome.chips?.length) expect(outcome.chips[0]).toMatchObject({ kind: "withdraw", label: anaNok });
    for (const chip of outcome.chips ?? []) expect(chip.href).toContain(`/withdraw?order=${encodeURIComponent(anaNok)}`);
  });

  it("check a discount code without promising what it takes off a cart", async () => {
    const outcome = parsed(await runTool(toolCtx(null), "check_code", { code: `NOPE${run}` }));
    expect(outcome).toMatchObject({ works: false, why: "unknown" });
  });
});

describe("the AI's turn with the tools", () => {
  /** The model's steps in turn (a message: text, or tool calls), keeping the tool results it was given. */
  function model(steps: Record<string, unknown>[]) {
    const results: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { messages: { role: string; content: unknown }[] };
        for (const message of body.messages) if (message.role === "tool") results.push(String(message.content));
        return Response.json({ choices: [{ message: steps.shift() ?? { content: "OK." } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
      }),
    );
    return results;
  }
  const call = (name: string, args: Record<string, unknown> = {}) => ({ content: null, tool_calls: [{ id: `c-${name}-${Math.random()}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] });

  it("reads the signed-in customer's order and keeps the chips with the answer; another customer signed in later is not signed in here", async () => {
    await signIn(ana);
    const results = model([call("order_details", { number: anaEur }), { content: "Your parcel is on its way." }]);
    const reply = await route.visitorTurn(ctx, { after: 0, signals: { views: [], searches: [] } }, `Where is ${anaEur}?`);
    if (reply instanceof Response) throw new Error(await reply.text());
    expect(reply.state.signedIn).toBe(true);
    const answer = reply.messages.find((m) => m.author === "ai")!;
    expect(answer.body).toBe("Your parcel is on its way.");
    expect(answer.data?.chips).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "tracking", label: `T-${run}-2` })]));
    expect(JSON.parse(results[0]).total).toBe(formatMoney(4_250, "EUR", ctx.locale));
    const ref = { id: reply.conversation!.id, token: reply.conversation!.token! };
    const [linked] = await db().execute<Row>(sql`select customer_id from commerce.support_conversations where id = ${ref.id}::uuid`);
    expect(String(linked.customer_id)).toBe(ana.id);

    // Bo signs in on the same browser: the conversation is Ana's, so Bo is not signed in here and sees nothing of hers.
    jar.clear();
    await signIn(bo);
    const again = model([call("order_details", { number: anaEur }), { content: "Please sign in." }]);
    const second = await route.visitorTurn(ctx, { conversation: ref, after: reply.messages.at(-1)!.seq, signals: { views: [], searches: [] } }, "And now?");
    if (second instanceof Response) throw new Error(await second.text());
    expect(second.state.signedIn).toBe(false);
    expect(JSON.parse(again[again.length - 1]).error).toBe("not_signed_in");
    expect(JSON.stringify(second.messages)).not.toContain(`T-${run}-2`);
  });

  it("keeps a proposal with the AI's answer, and the confirm route runs it only on Confirm (step 10)", async () => {
    await signIn(ana);
    model([call("propose_action", { kind: "order.resend_shipped", args: { orderNumber: anaNok } }), { content: "Press Confirm and I'll send it." }]);
    const reply = await route.visitorTurn(ctx, { after: 0, signals: { views: [], searches: [] } }, "Please send the shipping email again.");
    if (reply instanceof Response) throw new Error(await reply.text());
    const answer = reply.messages.find((m) => m.author === "ai")!;
    expect(answer.action).toMatchObject({ confirmer: "customer", status: "proposed" });
    expect(answer.action!.summary).toContain(anaNok);
    const ref = { id: reply.conversation!.id, token: reply.conversation!.token! };
    const done = await route.visitorConfirm(raw, ref, answer.seq, answer.action!.id, true);
    if (done instanceof Response) throw new Error(await done.text());
    expect(done.messages.at(-1)).toMatchObject({ author: "system", kind: "action_done" });
    // A second press is refused.
    expect(((await route.visitorConfirm(raw, ref, 0, answer.action!.id, true)) as Response).status).toBe(404);
  });

  it("refuses the order tools to a visitor who is not signed in", async () => {
    const results = model([call("my_orders"), { content: "Please sign in first." }]);
    const reply = await route.visitorTurn(ctx, { after: 0, signals: { views: [], searches: [] } }, "What did I order?");
    if (reply instanceof Response) throw new Error(await reply.text());
    expect(reply.state.signedIn).toBe(false);
    expect(JSON.parse(results[0]).error).toBe("not_signed_in");
  });
});

describe("the sign-in card's routes", () => {
  /** A conversation started by a visitor who is not signed in. */
  async function anonymous() {
    model0();
    const reply = await route.visitorTurn(ctx, { after: 0, signals: { views: [], searches: [] } }, "Hello");
    if (reply instanceof Response) throw new Error(await reply.text());
    return { id: reply.conversation!.id, token: reply.conversation!.token! };
  }
  const model0 = () => vi.stubGlobal("fetch", vi.fn(async () => Response.json({ choices: [{ message: { content: "Hi." } }] })));

  it("answer the same whether or not the email has an account", async () => {
    const ref = await anonymous();
    const known = await route.visitorSignIn(raw, ref, ana.email);
    const unknown = await route.visitorSignIn(raw, ref, `nobody-${run}@example.com`);
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(await known.json()).toEqual(await unknown.json());
  });

  it("sign the visitor in with the code and link the conversation to them", async () => {
    const ref = await anonymous();
    expect((await route.visitorSignIn(raw, ref, ana.email)).status).toBe(200);
    // A wrong code signs nobody in.
    const wrong = await route.visitorSignInCode(raw, ref, 0, ana.email, "000000");
    expect(wrong.status).toBe(400);
    expect(jar.size).toBe(0);
    const code = (await createSignInCode(storeId, ana.email))!;
    const right = await route.visitorSignInCode(raw, ref, 0, ana.email, code);
    expect(await right.json()).toMatchObject({ signedIn: true, state: { signedIn: true } });
    expect(jar.get(`account_${storeId}`)).toBeTruthy();
    const [row] = await db().execute<Row>(sql`select customer_id from commerce.support_conversations where id = ${ref.id}::uuid`);
    expect(String(row.customer_id)).toBe(ana.id);
  });

  it("leave a conversation that is another customer's as it is", async () => {
    const ref = await anonymous();
    await support.claimForCustomer(systemDesk(storeId), ref.id, ana.id);
    await route.visitorSignIn(raw, ref, bo.email);
    const code = (await createSignInCode(storeId, bo.email))!;
    const answer = (await (await route.visitorSignInCode(raw, ref, 0, bo.email, code)).json()) as Record<string, unknown>;
    expect(answer).toMatchObject({ signedIn: false, state: { signedIn: false } });
    expect(typeof answer.error).toBe("string");
    const [row] = await db().execute<Row>(sql`select customer_id from commerce.support_conversations where id = ${ref.id}::uuid`);
    expect(String(row.customer_id)).toBe(ana.id);
  });
});
