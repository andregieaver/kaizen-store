import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { formatMoney } from "@/lib/money";

import type { AiConnection } from "./ai";
import type { Membership } from "./auth";
import type { Approval, AssistantEvent } from "./owner-assistant";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  cacheLife: () => {},
  cacheTag: () => {},
  updateTag: () => {},
  revalidateTag: () => {},
  refresh: () => {},
}));

const assistant = await import("./owner-assistant");
const ownerTools = await import("./owner-tools");
const stores = await import("./stores");
const mcp = await import("./store-mcp");

type Row = Record<string, unknown>;

/**
 * The AI manager's returns tools (D153) against a real database: the queue and one return read in the store's own words, an answer to a
 * return request kept for the owner's yes and then carried out (and emailed), a withdrawal that can never be declined (refused before it
 * is even kept), the claims filter on what the customer is sent, and another store's returns never reached. Nothing refunds.
 */

const run = Date.now().toString(36);
let member: Membership;
let other: Membership;
let serial = 0;
const tags: string[] = [];
const nok = (minor: number) => formatMoney(minor, "NOK", member.store.markets[0]?.locale ?? "en");
const ctx = (m: Membership = member) => ({ account: m.account, store: m.store, invalidate: (tag: string) => void tags.push(tag) });

const connection = {
  provider: "openai",
  apiUrl: "https://ai.example/v1",
  apiKey: "sk-test",
  textModel: "text-model",
  textEuOnly: false,
  zeroDataRetention: false,
} as unknown as AiConnection;

async function makeMember(name: string): Promise<Membership> {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'Kari', 'Kaffe') returning id
  `);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Kaffe', null)`);
  const store = (await stores.getStore(name))!;
  const [account] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`${name}@example.com`}`);
  return { account: { id: String(account.id), email: String(account.email), name: "Kari", platformAdmin: false }, store, role: "owner" };
}

type Explained = {
  returns: Row[];
  waiting: Record<string, unknown>;
  refund: { would_be_now: string; working: string[] };
  lines: Row[];
  you_can_do_here: string[];
  note: string;
  history: string[];
  admin: string;
  kind_means: string;
  refund_due: string;
  refund_deadline: string;
  acknowledgement: string;
  next_steps_on_the_page: string[];
  page: string;
  showing: string;
};

type Placed = { orderId: string; number: string; lines: Record<string, string> };

/** A paid order of goods, written as a checkout leaves it. */
async function paidOrder(m: Membership, lines: { sku: string; qty: number; unit: number }[], email: string): Promise<Placed> {
  serial += 1;
  const total = lines.reduce((a, l) => a + l.qty * l.unit, 0);
  const number = `RTL-${run}-${serial}`;
  const [order] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor,
      tax_minor, total_minor, billing_address, shipping_address, placed_at)
    values (${m.store.id}::uuid, ${number}, 'NO', 'NOK', 'nb-NO', ${email}, 'paid', ${total}, 0, 0, 0, ${total}, '{}'::jsonb, '{}'::jsonb, now() - interval '2 days')
    returning id
  `);
  const ids: Record<string, string> = {};
  for (const l of lines) {
    const [row] = await db().execute<Row>(sql`
      select id from commerce.product_variants where store_id = ${m.store.id}::uuid and sku = ${l.sku}
    `);
    const [line] = await db().execute<Row>(sql`
      insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
      values (${m.store.id}::uuid, ${String(order.id)}::uuid, ${String(row.id)}::uuid, ${l.sku}, ${l.sku}, ${l.qty}, ${l.unit}, 0, ${l.qty * l.unit}, 0, 0, 'txcd_99999999', 'physical'::commerce.delivery)
      returning id
    `);
    ids[l.sku] = String(line.id);
  }
  await db().execute(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
    values (${m.store.id}::uuid, ${String(order.id)}::uuid, 'stripe', ${`pi_${run}_${serial}`}, 'acct_rt', ${total}, 'NOK', 'captured'::commerce.payment_status)
  `);
  // Sent before anyone withdraws: a withdrawal made before sending has nothing to wait for, and these scenarios wait for the goods.
  await db().execute(sql`
    insert into commerce.shipments (store_id, order_id, carrier, tracking_number, created_at)
    values (${m.store.id}::uuid, ${String(order.id)}::uuid, 'Bring', ${`T-${run}-${serial}`}, now() - interval '1 day')
  `);
  return { orderId: String(order.id), number, lines: ids };
}

/** A return request (voluntary), as the shopper's form makes it. */
async function requestReturn(m: Membership, order: Placed, sku: string, reason: string | null): Promise<{ id: string; number: string }> {
  const [ret] = await db().execute<Row>(sql`
    insert into commerce.returns (store_id, order_id, kind, status, reason) values (${m.store.id}::uuid, ${order.orderId}::uuid, 'return', 'requested', ${reason})
    returning id, number
  `);
  await db().execute(sql`
    insert into commerce.return_lines (store_id, return_id, order_line_id, quantity)
    values (${m.store.id}::uuid, ${String(ret.id)}::uuid, ${order.lines[sku]}::uuid, 1)
  `);
  return { id: String(ret.id), number: String(ret.number) };
}

/** A withdrawal, confirmed as the second step does: a pending request, its lines, then the confirmation, and the return it makes. */
async function withdraw(m: Membership, order: Placed, sku: string): Promise<{ id: string; number: string }> {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.withdrawal_requests (store_id, order_id, name, email, channel, locale, market_code)
    values (${m.store.id}::uuid, ${order.orderId}::uuid, 'Ola Nordmann', 'ola@example.com', 'web', 'nb-NO', 'NO') returning id
  `);
  await db().execute(sql`
    insert into commerce.withdrawal_request_lines (store_id, withdrawal_request_id, order_line_id, quantity)
    values (${m.store.id}::uuid, ${String(request.id)}::uuid, ${order.lines[sku]}::uuid, 1)
  `);
  await db().execute(sql`update commerce.withdrawal_requests set status = 'confirmed' where id = ${String(request.id)}::uuid`);
  const [ret] = await db().execute<Row>(sql`
    insert into commerce.returns (store_id, order_id, withdrawal_request_id, kind, status)
    values (${m.store.id}::uuid, ${order.orderId}::uuid, ${String(request.id)}::uuid, 'withdrawal', 'approved') returning id, number
  `);
  await db().execute(sql`
    insert into commerce.return_lines (store_id, return_id, order_line_id, quantity)
    values (${m.store.id}::uuid, ${String(ret.id)}::uuid, ${order.lines[sku]}::uuid, 1)
  `);
  return { id: String(ret.id), number: String(ret.number) };
}

const statusOf = async (id: string) => {
  const [row] = await db().execute<Row>(sql`select status::text as status, decision_note, approved_at, refund_minor from commerce.returns where id = ${id}::uuid`);
  return row;
};

let o1: Placed;
let o2: Placed;
let v1: { id: string; number: string };
let v2: { id: string; number: string };
let v3: { id: string; number: string };
let w1: { id: string; number: string };
let foreign: { id: string; number: string };

beforeAll(async () => {
  member = await makeMember(`rt-tools-${run}`);
  other = await makeMember(`rt-other-${run}`);
  o1 = await paidOrder(member, [{ sku: "DEMO-MUG-WHITE", qty: 2, unit: 10_000 }, { sku: "DEMO-TOTE", qty: 1, unit: 5_750 }], "kari@example.com");
  o2 = await paidOrder(member, [{ sku: "DEMO-MUG-BLACK", qty: 1, unit: 12_000 }], "ola@example.com");
  const o3 = await paidOrder(member, [{ sku: "DEMO-LAMP", qty: 1, unit: 30_000 }], "per@example.com");
  v1 = await requestReturn(member, o1, "DEMO-MUG-WHITE", "too_small");
  v2 = await requestReturn(member, o1, "DEMO-TOTE", "changed_mind");
  v3 = await requestReturn(member, o3, "DEMO-LAMP", null);
  w1 = await withdraw(member, o2, "DEMO-MUG-BLACK");
  const foreignOrder = await paidOrder(other, [{ sku: "DEMO-MUG-WHITE", qty: 1, unit: 10_000 }], "annen@example.com");
  foreign = await requestReturn(other, foreignOrder, "DEMO-MUG-WHITE", "other");
});

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  for (const m of [member, other]) {
    await db().execute(sql`delete from commerce.assistant_approvals where store_id = ${m.store.id}::uuid`);
    await db().execute(sql`delete from commerce.assistant_conversations where store_id = ${m.store.id}::uuid`);
  }
  await closeDb();
});

/** A provider answering in the stream format: text in pieces, or tool calls. */
const sse = (chunks: unknown[]) =>
  new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
const says = (text: string) => sse(text.match(/[\s\S]{1,7}/g)!.map((piece) => ({ choices: [{ delta: { content: piece } }] })));
const calls = (...tools: { name: string; args: unknown }[]) =>
  sse(tools.map((tool, index) => ({ choices: [{ delta: { tool_calls: [{ index, id: `call-${index}`, function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] } }] })));

function fakeModel(...answers: Response[]) {
  const requests: { messages: { role: string; content: string | null }[] }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      return answers.shift() ?? says("(no more answers)");
    }),
  );
  return requests;
}

async function turn(message: string, conversationId: string | null = null) {
  const events: AssistantEvent[] = [];
  await assistant.runTurn({ member, conversationId, message, emit: (e) => events.push(e), invalidate: (tag) => void tags.push(tag), connection });
  return events;
}

const approvalOf = (events: AssistantEvent[]) => (events.find((e) => e.type === "approval") as { approval: Approval } | undefined)?.approval;

describe("list_returns", () => {
  it("lists the open returns oldest first with what waits, in the queue's own words", async () => {
    const r = (await ownerTools.runOwnerTool(ctx(), "list_returns", {})) as Record<string, unknown> & Explained;
    expect(r.waiting).toMatchObject({ open: 4, to_answer: 3, past_refund_deadline: 0, acknowledgement_not_sent: 1 });
    expect(r.waiting.summary).toBe("1 acknowledgement was not sent, 3 to approve.");
    expect(r.showing).toBe("4 of 4");
    expect(r.returns.map((x: Row) => x.number)).toEqual([v1.number, v2.number, v3.number, w1.number]);
    expect(r.returns[0]).toMatchObject({ kind: "Return request", status: "Requested", order: o1.number, customer: "kari@example.com", units: 1, past_refund_deadline: false });
    expect(r.returns[3]).toMatchObject({ kind: "Withdrawal", status: "Approved", customer: "Ola Nordmann <ola@example.com>" });
    expect(r.returns[3].admin).toBe(`/admin/${member.store.slug}/returns/${w1.id}`);
    expect(r.page).toBe(`/admin/${member.store.slug}/returns`);
  });

  it("narrows by what waits, by kind and by a search", async () => {
    const list = async (args: Record<string, unknown>) => ((await ownerTools.runOwnerTool(ctx(), "list_returns", args)) as { returns: Row[] }).returns.map((x) => x.number);
    expect(await list({ which: "requested" })).toEqual([v1.number, v2.number, v3.number]);
    expect(await list({ kind: "withdrawal" })).toEqual([w1.number]);
    expect(await list({ search: o2.number })).toEqual([w1.number]);
    expect(await list({ search: "ola@example.com" })).toEqual([w1.number]);
    expect(await list({ which: "overdue" })).toEqual([]);
    expect(await list({ which: "declined" })).toEqual([]);
    expect(await list({ limit: 2 })).toEqual([v1.number, v2.number]);
    expect(await ownerTools.runOwnerTool(ctx(), "list_returns", { which: "overdue" })).toMatchObject({ note: "Nothing matches.", showing: "0 of 0" });
  });

  it("never shows another store's returns", async () => {
    const mine = (await ownerTools.runOwnerTool(ctx(), "list_returns", { which: "all" })) as { returns: Row[] };
    expect(mine.returns.map((x) => x.number)).not.toContain(foreign.number);
    const theirs = (await ownerTools.runOwnerTool(ctx(other), "list_returns", {})) as { returns: Row[] };
    expect(theirs.returns.map((x) => x.number)).toEqual([foreign.number]);
  });
});

describe("explain_return", () => {
  it("explains a return request: the lines, the reason, what the refund would be now, and what can be done where", async () => {
    const r = (await ownerTools.runOwnerTool(ctx(), "explain_return", { return: v1.number })) as Record<string, unknown> & Explained;
    expect(r).toMatchObject({
      return: v1.number,
      kind: "Return request",
      status: "Requested",
      order: o1.number,
      customer: "kari@example.com",
      reason: "Too small",
      refund_due: null,
      past_refund_deadline: false,
    });
    expect(r.lines).toEqual([expect.objectContaining({ item: "DEMO-MUG-WHITE", quantity: 1, of_ordered: 2, decision: "Accepted" })]);
    // One of two mugs at what was paid for it, written by the store.
    expect(r.refund.would_be_now).toBe(nok(10_000));
    expect(r.refund.working).toEqual([`What the customer paid for the returned goods: ${nok(10_000)}`]);
    expect(r.you_can_do_here).toEqual(["approve_return", "decline_return"]);
    expect(r.note).toMatch(/does not refund/);
    expect(r.history).toEqual([]);
    expect(r.admin).toBe(`/admin/${member.store.slug}/returns/${v1.id}`);
  });

  it("explains a withdrawal as the customer's right: nothing here to approve or decline, and when the refund is due", async () => {
    const r = (await ownerTools.runOwnerTool(ctx(), "explain_return", { return: w1.number })) as Record<string, unknown> & Explained;
    expect(r).toMatchObject({ kind: "Withdrawal", status: "Approved", customer: "Ola Nordmann <ola@example.com>", reason: "None given (a withdrawal needs no reason)" });
    expect(r.kind_means).toMatch(/cannot refuse it/);
    expect(r.you_can_do_here).toEqual([]);
    expect(r.refund_due).toMatch(/^Waiting for the goods, refund due by /);
    expect(r.refund_deadline).toBeTruthy();
    expect(r.acknowledgement).toMatch(/^Not sent/);
    expect(r.refund.would_be_now).toBe(nok(12_000));
    expect(r.next_steps_on_the_page).toEqual(expect.arrayContaining(["Mark received", "Close"]));
  });

  it("finds a return by its id, and by its order when the order has one", async () => {
    expect(await ownerTools.runOwnerTool(ctx(), "explain_return", { return: w1.id })).toMatchObject({ return: w1.number });
    expect(await ownerTools.runOwnerTool(ctx(), "explain_return", { return: o2.number })).toMatchObject({ return: w1.number });
    expect(await ownerTools.runOwnerTool(ctx(), "explain_return", { return: w1.number.toLowerCase() })).toMatchObject({ return: w1.number });
  });

  it("names the returns of an order that has several, and says when there is none", async () => {
    await expect(ownerTools.runOwnerTool(ctx(), "explain_return", { return: o1.number })).rejects.toThrow(new RegExp(`${o1.number} has several returns: ${v1.number}, ${v2.number}`));
    await expect(ownerTools.runOwnerTool(ctx(), "explain_return", { return: "NOPE-R9" })).rejects.toThrow("No return NOPE-R9 in this store");
  });

  it("never reaches another store's return", async () => {
    await expect(ownerTools.runOwnerTool(ctx(), "explain_return", { return: foreign.number })).rejects.toThrow("No return");
    await expect(ownerTools.runOwnerTool(ctx(), "explain_return", { return: foreign.id })).rejects.toThrow("No return");
    expect(await ownerTools.runOwnerTool(ctx(other), "explain_return", { return: foreign.number })).toMatchObject({ return: foreign.number });
  });
});

describe("refusals before anything is kept for a yes", () => {
  it("refuses to decline or approve a withdrawal, with the reason", async () => {
    await expect(ownerTools.preflightOwnerTool(ctx(), "decline_return", { return: w1.number, reason: "Not taken back." })).rejects.toThrow(/legal right/);
    await expect(ownerTools.preflightOwnerTool(ctx(), "approve_return", { return: w1.number })).rejects.toThrow(/is a withdrawal/);
    // Run directly, too: the tool refuses it, and the database would.
    await expect(ownerTools.runOwnerTool(ctx(), "decline_return", { return: w1.number, reason: "Not taken back." })).rejects.toThrow(/legal right/);
    expect((await statusOf(w1.id)).status).toBe("approved");
  });

  it("refuses words the store cannot back, since the customer is sent them", async () => {
    await expect(ownerTools.preflightOwnerTool(ctx(), "decline_return", { return: v3.number, reason: "We always have the best price, so no." })).rejects.toThrow(/Rewrite without claims/);
    await expect(ownerTools.preflightOwnerTool(ctx(), "approve_return", { return: v3.number, instructions: "Hurry, only 2 left in stock." })).rejects.toThrow(/Rewrite without claims/);
    expect((await statusOf(v3.id)).status).toBe("requested");
  });

  it("refuses an unknown return, another store's, and one whose arguments cannot be read", async () => {
    await expect(ownerTools.preflightOwnerTool(ctx(), "approve_return", { return: "NOPE-R9" })).rejects.toThrow("No return NOPE-R9");
    await expect(ownerTools.preflightOwnerTool(ctx(), "approve_return", { return: foreign.number })).rejects.toThrow("No return");
    await expect(ownerTools.preflightOwnerTool(ctx(), "decline_return", { return: v3.number })).rejects.toThrow("The arguments could not be read");
    // A fine call passes.
    await expect(ownerTools.preflightOwnerTool(ctx(), "decline_return", { return: v3.number, reason: "Opened and used goods are not taken back." })).resolves.toBeUndefined();
  });

  it("is refused for Kaizen Life's assistant too, over the store's MCP server", async () => {
    expect(mcp.MCP_TOOLS.find((t) => t.name === "list_returns")).toBeTruthy();
    expect(mcp.MCP_TOOLS.find((t) => t.name === "approve_return")?.inputSchema).toMatchObject({ properties: { store: expect.anything(), return: expect.anything() } });
    const caller = { account: member.account, stores: [{ slug: member.store.slug, name: member.store.name }] } as unknown as Parameters<typeof mcp.callMcpTool>[0];
    const refused = await mcp.callMcpTool(caller, "decline_return", { store: member.store.slug, return: w1.number, reason: "No." }, () => {});
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toMatch(/legal right/);
    expect((await statusOf(w1.id)).status).toBe("approved");
  });
});

describe("answering a return request through the approval gate", () => {
  let conversationId: string;

  it("keeps an approval for the owner's yes and answers nothing until then", async () => {
    fakeModel(calls({ name: "approve_return", args: { return: v1.number, instructions: "Send it in the box it came in." } }), says("Venter på godkjenning."));
    const events = await turn("Godkjenn returen");
    conversationId = (events.find((e) => e.type === "conversation") as { id: string }).id;
    const queued = approvalOf(events)!;
    expect(queued).toMatchObject({ tool: "approve_return", category: "send", status: "pending" });
    expect(queued.summary).toBe(`Approve the return ${v1.number} and email the customer how to send the goods back, with your instructions: "Send it in the box it came in.".`);
    expect((await statusOf(v1.id)).status).toBe("requested");

    const decided = await assistant.decideApproval(member, queued.id, true, (tag) => void tags.push(tag));
    expect(decided).toMatchObject({ status: "done", outcome: expect.stringContaining(`Return ${v1.number} is approved`) });
    const after = await statusOf(v1.id);
    expect(after.status).toBe("approved");
    expect(after.approved_at).toBeTruthy();
    // Once, and nothing was refunded.
    expect(await assistant.decideApproval(member, queued.id, true, () => {})).toBeNull();
    expect(after.refund_minor).toBeNull();
    const [email] = await db().execute<Row>(sql`select count(*)::int as n from commerce.email_messages where store_id = ${member.store.id}::uuid and kind = 'return.approved'`);
    expect(email.n).toBe(1);
    const [logged] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where store_id = ${member.store.id}::uuid and action = 'store.assistant.approve_return'`);
    expect(logged.n).toBe(1);
    const [event] = await db().execute<Row>(sql`
      select data from commerce.order_events where store_id = ${member.store.id}::uuid and type = 'return.approved' and data ->> 'returnId' = ${v1.id}
    `);
    expect(event.data).toMatchObject({ number: v1.number, by: member.account.id });
  });

  it("declines with the reason, which is kept and emailed", async () => {
    fakeModel(calls({ name: "decline_return", args: { return: v2.number, reason: "Opened and used goods are not taken back." } }), says("Venter."));
    const events = await turn("Avslå returen", conversationId);
    const queued = approvalOf(events)!;
    expect(queued).toMatchObject({ tool: "decline_return", category: "send", status: "pending" });
    expect(queued.summary).toBe(`Decline the return ${v2.number} and email the customer why: "Opened and used goods are not taken back."`);
    expect((await statusOf(v2.id)).status).toBe("requested");
    const decided = await assistant.decideApproval(member, queued.id, true, () => {});
    expect(decided).toMatchObject({ status: "done", outcome: expect.stringContaining(`Return ${v2.number} is declined`) });
    expect(await statusOf(v2.id)).toMatchObject({ status: "declined", decision_note: "Opened and used goods are not taken back." });
    const [email] = await db().execute<Row>(sql`select count(*)::int as n from commerce.email_messages where store_id = ${member.store.id}::uuid and kind = 'return.declined'`);
    expect(email.n).toBe(1);
  });

  it("does not keep a call for a withdrawal at all: the model is told, and the owner is never asked", async () => {
    const requests = fakeModel(calls({ name: "decline_return", args: { return: w1.number, reason: "Not taken back." } }), says("Det kan ikke avslås."));
    const events = await turn("Avslå angreretten", conversationId);
    expect(approvalOf(events)).toBeUndefined();
    const [pending] = await db().execute<Row>(sql`select count(*)::int as n from commerce.assistant_approvals where store_id = ${member.store.id}::uuid and tool = 'decline_return' and status = 'pending'`);
    expect(pending.n).toBe(0);
    expect(JSON.stringify(requests.at(-1)!.messages)).toMatch(/legal right/);
    expect((await statusOf(w1.id)).status).toBe("approved");
  });

  it("refuses an answer on a return that is no longer waiting", async () => {
    await expect(ownerTools.runOwnerTool(ctx(), "approve_return", { return: v1.number })).rejects.toThrow(/is approved, so it cannot be approved/);
    await expect(ownerTools.runOwnerTool(ctx(), "decline_return", { return: v2.number, reason: "Again." })).rejects.toThrow(/is declined, so it cannot be declined/);
  });

  it("explains the answered returns and counts them off the queue", async () => {
    expect(await ownerTools.runOwnerTool(ctx(), "explain_return", { return: v2.number })).toMatchObject({ status: "Declined", you_can_do_here: [], refund: null });
    const approved = (await ownerTools.runOwnerTool(ctx(), "explain_return", { return: v1.number })) as { history: string[]; you_can_do_here: string[] };
    expect(approved.you_can_do_here).toEqual([]);
    expect(approved.history.at(-1)).toMatch(/: Approved$/);
    const queue = (await ownerTools.runOwnerTool(ctx(), "list_returns", {})) as { waiting: Row };
    expect(queue.waiting).toMatchObject({ open: 3, to_answer: 1 });
  });

  it("leaves another store's returns alone", async () => {
    await expect(ownerTools.runOwnerTool(ctx(), "approve_return", { return: foreign.number })).rejects.toThrow("No return");
    expect((await statusOf(foreign.id)).status).toBe("requested");
  });
});
