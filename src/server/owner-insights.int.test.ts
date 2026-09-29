import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { AiConnection } from "./ai";
import type { Membership } from "./auth";
import type { AssistantEvent } from "./owner-assistant";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));

const ownerTools = await import("./owner-tools");
const assistant = await import("./owner-assistant");
const stores = await import("./stores");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
let member: Membership;
let storeId: string;
let variant: { id: string; sku: string; productId: string };
const ctx = () => ({ account: member.account, store: member.store, invalidate: () => {} });

const connection = {
  provider: "openai",
  apiUrl: "https://ai.example/v1",
  apiKey: "sk-test",
  textModel: "text-model",
  textEuOnly: false,
  zeroDataRetention: false,
} as unknown as AiConnection;

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`insights-${run}@example.com`}, 'Kari', 'Kaffe') returning id
  `);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`insights-${run}`}, 'Kaffe', null) as id`);
  storeId = String(store.id);
  const [account] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`insights-${run}@example.com`}`);
  member = { account: { id: String(account.id), email: String(account.email), name: "Kari", platformAdmin: false }, store: (await stores.getStore(`insights-${run}`))!, role: "owner" };
  const [row] = await db().execute<Row>(sql`
    select v.id, v.sku, v.product_id from commerce.product_variants v join commerce.products p on p.id = v.product_id
    where v.store_id = ${storeId}::uuid and v.active and v.delivery = 'physical' and p.status = 'active' order by v.sku limit 1
  `);
  variant = { id: String(row.id), sku: String(row.sku), productId: String(row.product_id) };
  await db().execute(sql`update commerce.inventory_levels set on_hand = 0 where variant_id = ${variant.id}::uuid`);
  await db().execute(sql`
    update commerce.inventory_levels set on_hand = 10
    where (variant_id, location_id) = (select variant_id, location_id from commerce.inventory_levels where variant_id = ${variant.id}::uuid limit 1)
  `);

  // Ane buys often; Bo bought twice, long ago; Cy once, lately.
  let n = 0;
  const order = async (email: string, name: string, daysAgo: number, quantity: number) => {
    n += 1;
    const total = 10_000 * quantity;
    const [o] = await db().execute<Row>(sql`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, tax_minor, total_minor,
        billing_address, shipping_address, placed_at)
      values (${storeId}::uuid, ${`${run}-${n}`}, 'NO', 'NOK', 'nb-NO', ${email}, 'paid', ${total}, 0, 0, ${total},
        ${JSON.stringify({ name })}, ${JSON.stringify({ name, line1: "Gata 1", postalCode: "0150", city: "Oslo", country: "NO" })},
        now() - make_interval(days => ${daysAgo}))
      returning id
    `);
    await db().execute(sql`
      insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, total_minor, tax_minor, tax_rate, tax_code)
      values (${storeId}::uuid, ${String(o.id)}::uuid, ${variant.id}::uuid, ${variant.sku}, 'Kopp', ${quantity}, 10000, ${total}, 0, 0.25, 'txcd_99999999')
    `);
    await db().execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
      values (${storeId}::uuid, ${String(o.id)}::uuid, 'stripe', ${`cs_${run}_${n}`}, ${total}, 'NOK', 'captured')
    `);
    return String(o.id);
  };
  await order("ane@example.com", "Ane", 5, 10);
  await order("ane@example.com", "Ane", 20, 10);
  await order("ane@example.com", "Ane", 150, 1);
  await order("bo@example.com", "Bo", 120, 1);
  await order("bo@example.com", "Bo", 200, 1);
  await order("cy@example.com", "Cy", 10, 10);
});

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  await closeDb();
});

describe("the AI manager's analyses (D104)", () => {
  it("groups customers by how they buy, counted in code", async () => {
    const insights = (await ownerTools.runOwnerTool(ctx(), "customer_insights", { days: 90 })) as Record<string, any>;
    expect(insights.customers_ever).toBe(3);
    expect(insights.came_back).toMatchObject({ customers: 2, share: "66.7 %" });
    expect(insights.in_period).toEqual({ customers: 2, new: 1, returning: 1 });
    expect(insights.usual_days_between_orders).toBe(80);
    expect(insights.groups.at_risk.customers).toBe(1);
    expect(insights.at_risk_customers).toEqual([expect.objectContaining({ name: "Bo", email: "bo@example.com", orders: 2 })]);
    expect(insights.best_customers[0]).toMatchObject({ name: "Ane", orders: 3 });
    expect(insights.average_order_in_period).toEqual([{ currency: "NOK", orders: 3, average: expect.stringMatching(/^1[.\s\u00a0]?000/) }]);
  });

  it("says what sells, what to reorder and how the weeks went", async () => {
    const performance = (await ownerTools.runOwnerTool(ctx(), "product_performance", { days: 30 })) as Record<string, any>;
    expect(performance.best_sellers[0]).toMatchObject({ units: 30, orders: 3, stock: 10 });

    // 30 sold in 30 days, 10 left: 1 a day, lasting 10 days; 30 + 7 days need 37.
    const restock = (await ownerTools.runOwnerTool(ctx(), "restock_suggestions", { days: 30, cover_days: 30, lead_days: 7 })) as Record<string, any>;
    expect(restock.to_reorder).toEqual([expect.objectContaining({ sku: variant.sku, in_stock: 10, per_day: 1, lasts_days: 10, suggested_order: 27, order_now: false })]);
    const urgent = (await ownerTools.runOwnerTool(ctx(), "restock_suggestions", { days: 30, cover_days: 30, lead_days: 14 })) as Record<string, any>;
    expect(urgent.urgent).toBe(1);

    const trend = (await ownerTools.runOwnerTool(ctx(), "sales_trend", { period: "month", count: 3 })) as Record<string, any>;
    expect(trend.series).toHaveLength(3);
    expect(trend.series.at(-1)).toMatchObject({ so_far: true });
    expect(trend.series.reduce((sum: number, s: { orders: number }) => sum + s.orders, 0)).toBeGreaterThanOrEqual(3);

    const funnel = (await ownerTools.runOwnerTool(ctx(), "sales_funnel", { days: 30 })) as Record<string, any>;
    expect(funnel).toMatchObject({ orders_placed: expect.any(Number), orders_paid: expect.any(Number) });
    expect(funnel.note).toContain("not tracked");
  });

  it("emails only the store's own customers, without unbacked claims", async () => {
    const sent = (await ownerTools.runOwnerTool(ctx(), "email_customer", { to: "Ane@example.com", subject: "Takk!", message: "Hei Ane,\n\nTakk for at du handler hos oss.\n\nHilsen Kaffe" })) as {
      done: string;
    };
    expect(sent.done).toContain("ane@example.com");
    const [email] = await db().execute<Row>(sql`
      select to_address, subject, text from commerce.email_messages where store_id = ${storeId}::uuid and kind = 'store.message' order by created_at desc limit 1
    `);
    expect(email).toMatchObject({ to_address: "ane@example.com", subject: "Takk!" });
    expect(String(email.text)).toContain("Takk for at du handler hos oss.");

    await expect(ownerTools.runOwnerTool(ctx(), "email_customer", { to: "stranger@example.com", subject: "Hi", message: "Hello" })).rejects.toThrow("not a customer");
    await expect(
      ownerTools.runOwnerTool(ctx(), "email_customer", { to: "ane@example.com", subject: "Tilbud", message: "Vi har markedets laveste pris, kun i dag!" }),
    ).rejects.toThrow("Rewrite without claims");
    // By order number, the email links the order.
    const byOrder = (await ownerTools.runOwnerTool(ctx(), "email_customer", { to: `${run}-6`, subject: "Pakken", message: "Den er på vei." })) as { done: string };
    expect(byOrder.done).toContain("cy@example.com");

    const again = (await ownerTools.runOwnerTool(ctx(), "resend_order_email", { order: `${run}-1`, which: "confirmation" })) as { done: string };
    expect(again.done).toContain("again");
    await expect(ownerTools.runOwnerTool(ctx(), "resend_order_email", { order: `${run}-1`, which: "shipped" })).rejects.toThrow("not been sent");
  });

  it("sets stock by SKU and posts to Slack only when connected", async () => {
    expect(await ownerTools.runOwnerTool(ctx(), "set_stock", { sku: variant.sku, quantity: 42 })).toMatchObject({ done: `${variant.sku} now has 42 in stock.` });
    const [level] = await db().execute<Row>(sql`select sum(on_hand)::int as n from commerce.inventory_levels where variant_id = ${variant.id}::uuid`);
    expect(level.n).toBe(42);
    await expect(ownerTools.runOwnerTool(ctx(), "set_stock", { sku: "NO-SUCH-SKU", quantity: 1 })).rejects.toThrow("No shipped variant");
    await expect(ownerTools.runOwnerTool(ctx(), "post_to_slack", { message: "Hei team" })).rejects.toThrow("Slack is not connected");
    expect(await ownerTools.runOwnerTool(ctx(), "list_integrations", {})).toMatchObject({ connected: [], available: ["zapier", "make", "slack"] });
  });
});

// Voice mode's answers in words (D104) -------------------------------------------------------------------

function sse(chunks: unknown[]): Response {
  const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}
const says = (text: string) => sse([{ choices: [{ delta: { content: text } }] }]);
const calls = (name: string, args: unknown) => sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: "call-0", function: { name, arguments: JSON.stringify(args) } }] } }] }]);
type Request = { messages: { role: string; content: string | null }[] };

function fakeModel(...answers: Response[]) {
  const requests: Request[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      return answers.shift() ?? says("(no more answers)");
    }),
  );
  return requests;
}

async function turn(message: string, conversationId: string | null, voice = false) {
  const events: AssistantEvent[] = [];
  await assistant.runTurn({ member, conversationId, message, voice, emit: (e) => events.push(e), invalidate: () => {}, connection });
  return events;
}

describe("answering a kept change in words (D104)", () => {
  it("carries out a plain yes to a change asked for earlier, and nothing else", async () => {
    fakeModel(calls("create_discount", { code: `VOICE${run}`, percent: 15 }), says("The code waits for your yes."));
    const first = await turn("Make a 15 % code", null, true);
    const conversationId = (first[0] as { id: string }).id;
    const approval = first.find((e) => e.type === "approval");
    const approvalId = approval?.type === "approval" ? approval.approval.id : "";

    // Voice turns are told to speak plainly, and see what waits.
    const unclear = fakeModel(calls("decide_approval", { approval: approvalId, approve: true }), says("Please say yes or no."));
    await turn("Hmm, what was it again?", conversationId, true);
    expect(String(unclear[0].messages[0].content)).toContain("read aloud");
    expect(String(unclear[0].messages[0].content)).toContain(`[${approvalId}] Create the code VOICE${run.toUpperCase()}`);
    expect(String(unclear[1].messages.at(-1)!.content)).toContain("not a plain yes");

    const yes = await (async () => {
      fakeModel(calls("decide_approval", { approval: approvalId, approve: true }), says("Done, the code works now."));
      return turn("Yes, do it", conversationId, true);
    })();
    expect(yes).toContainEqual({ type: "approval", approval: expect.objectContaining({ id: approvalId, status: "done" }) });
    const [code] = await db().execute<Row>(sql`select active from commerce.discount_codes where store_id = ${storeId}::uuid and code = ${`VOICE${run}`.toUpperCase()}`);
    expect(code.active).toBe(true);

    // A change kept in this very turn cannot be approved by the same message.
    const same = fakeModel(calls("archive_product", { product: variant.productId }), calls("decide_approval", { approval: "00000000-0000-4000-8000-000000000000", approve: true }), says("Waiting."));
    const events = await turn("Yes, archive the cup", conversationId);
    const kept = events.find((e) => e.type === "approval");
    expect(kept).toMatchObject({ approval: { status: "pending" } });
    expect(String(same[2].messages.at(-1)!.content)).toContain("no such change");
  });
});
