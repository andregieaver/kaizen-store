import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Account, Membership } from "./auth";

vi.mock("server-only", () => ({}));

const calls = vi.hoisted(() => ({ refreshed: 0, tags: [] as string[], role: "owner" as "owner" | "admin" }));
vi.mock("next/cache", () => ({
  cacheLife: () => {},
  cacheTag: () => {},
  updateTag: (tag: string) => calls.tags.push(tag),
  revalidateTag: () => {},
  refresh: () => {
    calls.refreshed += 1;
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));

const members = vi.hoisted(() => ({ byStore: new Map<string, { account: Account; storeId: string }>() }));
vi.mock("@/server/auth", async (original) => {
  const real = await original<typeof import("./auth")>();
  const { getStore } = await import("./stores");
  return {
    ...real,
    requireMember: async (storeSlug: string): Promise<Membership> => {
      const entry = members.byStore.get(storeSlug);
      if (!entry) throw new Error("NEXT_NOT_FOUND");
      return { account: entry.account, role: calls.role, store: (await getStore(storeSlug))! };
    },
    getMembership: async (storeSlug: string): Promise<Membership | null> => {
      const entry = members.byStore.get(storeSlug);
      return entry ? { account: entry.account, role: calls.role, store: (await getStore(storeSlug))! } : null;
    },
  };
});

// An email provider that accepts everything: an acknowledgement only counts as sent once it was handed to one.
process.env.RESEND_API_KEY = "re_test_key";
process.env.EMAIL_FROM = "butikk@example.com";
let emailCount = 0;
vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ id: `em_act_${++emailCount}` }), { status: 200, headers: { "content-type": "application/json" } }));

const actions = await import("../app/admin/(gated)/[store]/returns/actions");
const settingsActions = await import("../app/admin/(gated)/[store]/settings/returns/actions");
const r = await import("./returns");
const rs = await import("./return-settings");

type Row = Record<string, unknown>;

/**
 * The returns screens' server actions (D153), as the forms call them: a member of the store works a return from a voluntary request to
 * a closed, refunded one through form data, another store's return is "no longer exists", the rules are the owner's, and every
 * change is written to the audit log. The order here was not paid through Stripe, so its refund is recorded as made outside.
 */

const run = Date.now().toString(36);
let slug: string;
let storeId: string;
let otherSlug: string;
let otherStoreId: string;
let seq = 0;
const idle = { status: "idle" as const, messages: [] };

async function makeStore(name: string): Promise<{ id: string; slug: string; account: Account }> {
  const storeSlug = `${name}-${run}`;
  const email = `${name}-${run}@example.com`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${email}, 'Kari', ${name}) returning id`);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${storeSlug}, ${name}, null) as id`);
  // The template's countries, languages and currencies, as before D178 step 4 (a new store starts in its own country alone).
  await db().execute(sql`update commerce.stores set features = features || array['countries', 'languages', 'currencies'] where id = ${String(store.id)}::uuid`);
  const [row] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${email}`);
  const account: Account = { id: String(row.id), email: String(row.email), name: "Kari", platformAdmin: false };
  members.byStore.set(storeSlug, { account, storeId: String(store.id) });
  return { id: String(store.id), slug: storeSlug, account };
}

beforeAll(async () => {
  const first = await makeStore("ract");
  slug = first.slug;
  storeId = first.id;
  const other = await makeStore("ract2");
  otherSlug = other.slug;
  otherStoreId = other.id;
  await db().execute(sql`update commerce.stores set locales = array['nb-NO', 'sv-SE'] where id = ${storeId}::uuid`);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await closeDb();
});

/** A paid order of the store with one line of 2 units of a real variant (so what comes back can be put in stock). */
async function paidOrder(store = storeId): Promise<{ order: string; line: string }> {
  seq += 1;
  const [o] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor,
      total_minor, billing_address, shipping_address, delivered_at)
    values (${store}::uuid, ${`${run}-${seq}`}, 'NO', 'NOK', 'nb-NO', 'shopper@example.com', 'paid', 20000, 0, 0, 0, 20000, '{}', '{}', now() - interval '20 days')
    returning id
  `);
  const [v] = await db().execute<Row>(sql`
    select id, sku from commerce.product_variants where store_id = ${store}::uuid and active and delivery = 'physical' order by sku limit 1
  `);
  const [l] = await db().execute<Row>(sql`
    insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, total_minor, tax_minor, tax_rate, tax_code)
    values (${store}::uuid, ${String(o.id)}::uuid, ${String(v.id)}::uuid, ${String(v.sku)}, 'Kopp', 2, 10000, 20000, 0, 0.25, 'txcd_99999999') returning id
  `);
  return { order: String(o.id), line: String(l.id) };
}

async function voluntaryReturn(store = storeId): Promise<{ id: string; line: string; order: string }> {
  const { order, line } = await paidOrder(store);
  const [ret] = await db().execute<Row>(sql`insert into commerce.returns (store_id, order_id, kind, status) values (${store}::uuid, ${order}::uuid, 'return', 'requested') returning id`);
  await db().execute(sql`insert into commerce.return_lines (store_id, return_id, order_line_id, quantity) values (${store}::uuid, ${String(ret.id)}::uuid, ${line}::uuid, 2)`);
  return { id: String(ret.id), line, order };
}

/** A withdrawal: a confirmed request that was not acknowledged, and its approved return of one unit. */
async function withdrawalReturn(): Promise<{ id: string; request: string; line: string }> {
  const { order, line } = await paidOrder();
  const [request] = await db().execute<Row>(sql`
    insert into commerce.withdrawal_requests (store_id, order_id, name, email, channel) values (${storeId}::uuid, ${order}::uuid, 'Kari', 'shopper@example.com', 'web') returning id
  `);
  await db().execute(sql`insert into commerce.withdrawal_request_lines (store_id, withdrawal_request_id, order_line_id, quantity) values (${storeId}::uuid, ${String(request.id)}::uuid, ${line}::uuid, 1)`);
  await db().execute(sql`update commerce.withdrawal_requests set status = 'confirmed' where id = ${String(request.id)}::uuid`);
  const [ret] = await db().execute<Row>(sql`
    insert into commerce.returns (store_id, order_id, withdrawal_request_id, kind, status) values (${storeId}::uuid, ${order}::uuid, ${String(request.id)}::uuid, 'withdrawal', 'approved') returning id
  `);
  await db().execute(sql`insert into commerce.return_lines (store_id, return_id, order_line_id, quantity) values (${storeId}::uuid, ${String(ret.id)}::uuid, ${line}::uuid, 1)`);
  return { id: String(ret.id), request: String(request.id), line };
}

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const audits = async (action: string) =>
  (await db().execute<Row>(sql`select details, account_id from commerce.audit_log where store_id = ${storeId}::uuid and action = ${action} order by id`)).map((a) => a.details as Record<string, unknown>);

describe("working a return through the forms' actions", () => {
  it("goes from a request to a closed, refunded return, writing each step to the audit log", async () => {
    const { id, line } = await voluntaryReturn();
    const before = calls.refreshed;

    // A return request waits for an answer: it cannot be received or refunded before it is approved.
    expect(await actions.markReceivedAction(slug, id, idle, form({}))).toMatchObject({ status: "error" });

    const approved = await actions.approveReturnAction(slug, id, idle, form({ instructions: "Pack it well.", labelUrl: "https://example.com/label", addressName: "Retur", addressStreet: "Lager 1", addressPostalCode: "0150", addressCity: "Oslo", addressCountry: "no" }));
    expect(approved).toEqual({ status: "ok", messages: ["Approved. The customer has been told how to send the goods back."] });
    expect(await r.getReturn(storeId, id)).toMatchObject({
      status: "approved",
      instructions: "Pack it well.",
      labelUrl: "https://example.com/label",
      returnAddress: { name: "Retur", street: "Lager 1", postalCode: "0150", city: "Oslo", country: "NO" },
    });
    expect(await audits("return.approved")).toEqual([{ returnId: id }]);

    // The label address must be https, and a half-filled address is refused with the server's words.
    expect(await actions.returnInstructionsAction(slug, id, idle, form({ instructions: "x", labelUrl: "http://example.com/x" }))).toMatchObject({ status: "error", messages: [expect.stringContaining("https://")] });
    expect(await actions.returnInstructionsAction(slug, id, idle, form({ instructions: "x", addressName: "Retur" }))).toMatchObject({ status: "error", messages: [expect.stringContaining("whole return address")] });
    expect(await actions.returnInstructionsAction(slug, id, idle, form({ instructions: "New text", addressName: "Retur", addressStreet: "Lager 2", addressPostalCode: "0150", addressCity: "Oslo", addressCountry: "NO" }))).toMatchObject({ status: "ok" });

    expect(await actions.markInTransitAction(slug, id, idle, form({ on: "" }))).toMatchObject({ status: "ok" });
    expect(await actions.markReceivedAction(slug, id, idle, form({}))).toMatchObject({ status: "ok", messages: ["Marked as received. The customer has been told."] });

    // Inspecting needs a condition for the line, and a deduction needs its reason; amounts are typed in the order's currency.
    expect(await actions.inspectReturnAction(slug, id, idle, form({ [`condition:${line}`]: "" }))).toMatchObject({ status: "error" });
    expect(await actions.inspectReturnAction(slug, id, idle, form({ [`condition:${line}`]: "used", [`deduction:${line}`]: "20,00" }))).toMatchObject({ status: "error", messages: ["Say what the deduction is for."] });
    expect(await actions.inspectReturnAction(slug, id, idle, form({ [`condition:${line}`]: "used", [`deduction:${line}`]: "abc" }))).toMatchObject({ status: "error", messages: [expect.stringContaining("not an amount in NOK")] });
    expect(
      await actions.inspectReturnAction(slug, id, idle, form({ [`condition:${line}`]: "used", [`restock:${line}`]: "on", [`deduction:${line}`]: "20,00", [`deductionNote:${line}`]: "Used for a week" })),
    ).toMatchObject({ status: "ok", messages: ["Inspected."] });
    const inspected = await r.getReturn(storeId, id);
    expect(inspected?.lines[0]).toMatchObject({ condition: "used", restock: true, deductionMinor: 2000, deductionNote: "Used for a week" });

    // The working: both mugs less the deduction. The screen's recalculation is the same sum the refund works out.
    const recalculated = await actions.recalculateRefundAction(slug, id, "");
    expect(recalculated).toMatchObject({ ok: true, preview: { amountMinor: 18_000, canRefund: false, wholeOrder: false } });
    expect(await actions.recalculateRefundAction(slug, id, "abc")).toMatchObject({ ok: false });

    // Not paid through Stripe: refunded outside, recorded, with stock put back. A different amount needs a reason.
    expect(await actions.refundReturnAction(slug, id, idle, form({ amount: "150,00", reason: "" }))).toMatchObject({ status: "error", messages: ["Say why the amount differs from what was worked out."] });
    expect(await actions.refundReturnAction(slug, id, idle, form({ amount: "abc" }))).toMatchObject({ status: "error" });
    const onHand = async () =>
      Number((await db().execute<Row>(sql`select coalesce(sum(l.on_hand), 0)::int as n from commerce.inventory_levels l join commerce.order_lines ol on ol.variant_id = l.variant_id where ol.id = ${line}::uuid`))[0].n);
    const stockBefore = await onHand();
    const refunded = await actions.refundReturnAction(slug, id, idle, form({ amount: "180,00", reason: "", [`restock:${line}`]: "2" }));
    expect(refunded).toEqual({ status: "ok", messages: ["Recorded as refunded outside Kaizen's Stripe."] });
    expect(await r.getReturn(storeId, id)).toMatchObject({ refund: { recorded: true, amountMinor: 18_000, computedMinor: 18_000, outside: true } });
    // The two mugs are back in stock.
    expect(await onHand()).toBe(stockBefore + 2);
    expect(await audits("return.refunded")).toEqual([{ returnId: id, amountMinor: 18_000, computedMinor: 18_000, adjusted: false, outside: true }]);
    // Refunded once.
    expect(await actions.refundReturnAction(slug, id, idle, form({ amount: "180,00" }))).toMatchObject({ status: "error", messages: ["This return is already refunded."] });

    expect(await actions.returnNoteAction(slug, id, idle, form({ note: "Customer called" }))).toMatchObject({ status: "ok" });
    expect(await actions.closeReturnAction(slug, id, idle, form({ note: "Done" }))).toEqual({ status: "ok", messages: ["Closed."] });
    expect(await r.getReturn(storeId, id)).toMatchObject({ status: "closed", outcome: "refunded", staffNote: expect.stringContaining("Done") });
    expect((await audits("return.closed")).length).toBe(1);
    // An ended return takes no step but a note.
    expect(await actions.cancelReturnAction(slug, id, idle, form({}))).toMatchObject({ status: "error" });
    expect(await actions.returnNoteAction(slug, id, idle, form({ note: "After" }))).toMatchObject({ status: "ok" });
    // Every success refreshed the page.
    expect(calls.refreshed).toBeGreaterThan(before + 6);
  });

  it("declines a request with a reason, and a line of a return", async () => {
    const declined = await voluntaryReturn();
    expect(await actions.declineReturnAction(slug, declined.id, idle, form({ reason: "" }))).toMatchObject({ status: "error" });
    expect(await actions.declineReturnAction(slug, declined.id, idle, form({ reason: "Outside our policy" }))).toEqual({ status: "ok", messages: ["Declined. The customer has been told why."] });
    expect(await r.getReturn(storeId, declined.id)).toMatchObject({ status: "declined", decisionNote: "Outside our policy" });

    const partly = await voluntaryReturn();
    expect(await actions.declineReturnLineAction(slug, partly.id, idle, form({ lineId: partly.line, reason: "Worn out" }))).toEqual({ status: "ok", messages: ["The line is declined."] });
    expect((await r.getReturn(storeId, partly.id))?.lines[0]).toMatchObject({ decision: "decline", declineReason: "Worn out" });
    expect(await actions.declineReturnLineAction(slug, partly.id, idle, form({ lineId: partly.line, reason: "Again" }))).toMatchObject({ status: "error", messages: ["That line is already declined."] });
  });

  it("cancels a return that does not go ahead", async () => {
    const { id } = await voluntaryReturn();
    await actions.approveReturnAction(slug, id, idle, form({}));
    expect(await actions.cancelReturnAction(slug, id, idle, form({ note: "Customer changed their mind" }))).toEqual({ status: "ok", messages: ["Cancelled."] });
    expect(await r.getReturn(storeId, id)).toMatchObject({ status: "cancelled" });
  });

  it("closes a withdrawal that was not refunded only when asked to, on purpose", async () => {
    const { id } = await withdrawalReturn();
    // A withdrawal is not declined, and closing it with nothing refunded is a decision.
    expect(await actions.declineReturnAction(slug, id, idle, form({ reason: "No" }))).toMatchObject({ status: "error", messages: [expect.stringContaining("not the store's to refuse")] });
    expect(await actions.closeReturnAction(slug, id, idle, form({}))).toMatchObject({ status: "error", messages: [expect.stringContaining("Confirm that you want to close it without a refund")] });
    expect(await actions.closeReturnAction(slug, id, idle, form({ confirmNoRefund: "on", note: "Customer kept it" }))).toEqual({ status: "ok", messages: ["Closed."] });
    expect(await r.getReturn(storeId, id)).toMatchObject({ status: "closed", outcome: "no_refund" });
  });

  it("sends a confirmed withdrawal's acknowledgement again, and refuses a return that has none", async () => {
    const { id, request } = await withdrawalReturn();
    expect((await r.getReturn(storeId, id))?.request?.acknowledgement).toBe("not_sent");
    expect(await actions.sendAcknowledgementAction(slug, id)).toMatchObject({ status: "ok" });
    expect((await r.getReturn(storeId, id))?.request).toMatchObject({ id: request, acknowledgement: "sent" });
    expect((await audits("return.acknowledgement_resent")).length).toBeGreaterThan(0);

    const { id: voluntaryId } = await voluntaryReturn();
    expect(await actions.sendAcknowledgementAction(slug, voluntaryId)).toEqual({ status: "error", messages: ["This return has no confirmed withdrawal to acknowledge."] });
  });
});

describe("who can do what", () => {
  it("is a 404 for a store the account is not a member of, and 'no longer exists' for another store's return", async () => {
    const mine = await voluntaryReturn();
    await expect(actions.approveReturnAction("not-a-store", mine.id, idle, form({}))).rejects.toThrow("NEXT_NOT_FOUND");
    const theirs = await voluntaryReturn(otherStoreId);
    // Called as a member of the first store, with the other store's return: the return is looked up by this store's id.
    expect(await actions.approveReturnAction(slug, theirs.id, idle, form({}))).toMatchObject({ status: "error", messages: ["That return no longer exists."] });
    expect(await actions.refundReturnAction(slug, theirs.id, idle, form({ amount: "1" }))).toEqual({ status: "error", messages: ["This return no longer exists."] });
    expect(await actions.recalculateRefundAction(slug, theirs.id, "")).toEqual({ ok: false, problem: "This return no longer exists." });
    expect((await r.getReturn(otherStoreId, theirs.id))?.status).toBe("requested");
    // Not an id at all.
    expect(await actions.approveReturnAction(slug, "nope", idle, form({}))).toEqual({ status: "error", messages: ["This return no longer exists."] });
    expect(otherSlug).toBeTruthy();
  });

  it("lets staff work the queue but only an owner change the rules", async () => {
    calls.role = "admin";
    try {
      const { id } = await voluntaryReturn();
      expect(await actions.approveReturnAction(slug, id, idle, form({}))).toMatchObject({ status: "ok" });
      const refused = await settingsActions.saveReturnSettingsAction(slug, idle, form({ windowDays: "30", transitDays: "3", whoPaysReturn: "store", refundWhen: "request" }));
      expect(refused).toEqual({ status: "error", messages: ["Only an owner can change the return rules."] });
      expect((await rs.getReturnSettings(storeId)).windowDays).toBe(14);
    } finally {
      calls.role = "owner";
    }
  });
});

describe("the return rules' action", () => {
  const rules = (over: Record<string, string> = {}) =>
    form({ windowDays: "30", transitDays: "2", whoPaysReturn: "store", refundWhen: "request", acceptExcluded: "on", instructions: "Pakk godt.", "instructions:sv-SE": " Packa väl. ", ...over });

  it("saves the rules and the other languages' instructions, writes the audit log and drops what the site cached", async () => {
    calls.tags.length = 0;
    expect(await settingsActions.saveReturnSettingsAction(slug, idle, rules({ addressName: "Retur", addressStreet: "Lager 1", addressPostalCode: "0150", addressCity: "Oslo", addressCountry: "no" }))).toEqual({ status: "ok", messages: ["Saved."] });
    expect(await rs.getReturnSettings(storeId)).toEqual({
      windowDays: 30,
      transitDays: 2,
      whoPaysReturn: "store",
      refundWhen: "request",
      acceptExcluded: true,
      b2bReturns: false,
      instructions: "Pakk godt.",
      returnAddress: { name: "Retur", street: "Lager 1", postalCode: "0150", city: "Oslo", country: "NO" },
    });
    expect(await rs.getInstructionTranslations(storeId)).toEqual({ "sv-SE": "Packa väl." });
    expect(calls.tags.some((t) => t.includes("store"))).toBe(true);
    const [entry] = await audits("returns.settings_saved");
    expect(entry).toMatchObject({ windowDays: 30, whoPaysReturn: "store", translated: ["sv-SE"], instructionsLength: 10 });
    // The text of the instructions is not copied into the log.
    expect(JSON.stringify(entry)).not.toContain("Pakk godt");
  });

  it("never shortens the legal 14 days, and says what is wrong in words", async () => {
    expect(await settingsActions.saveReturnSettingsAction(slug, idle, rules({ windowDays: "13" }))).toEqual({ status: "error", messages: [expect.stringContaining("legal period is never shortened")] });
    expect(await settingsActions.saveReturnSettingsAction(slug, idle, rules({ windowDays: "" }))).toMatchObject({ status: "error" });
    expect(await settingsActions.saveReturnSettingsAction(slug, idle, rules({ whoPaysReturn: "carrier" }))).toMatchObject({ status: "error" });
    expect(await settingsActions.saveReturnSettingsAction(slug, idle, rules({ addressName: "Retur" }))).toMatchObject({ status: "error", messages: expect.arrayContaining(["Fill in the whole return address."]) });
    expect((await rs.getReturnSettings(storeId)).windowDays).toBe(30);
  });

  it("takes an empty address as the store's own, and an empty translation as none", async () => {
    expect(await settingsActions.saveReturnSettingsAction(slug, idle, rules({ "instructions:sv-SE": "" }))).toMatchObject({ status: "ok" });
    expect((await rs.getReturnSettings(storeId)).returnAddress).toBeNull();
    expect(await rs.getInstructionTranslations(storeId)).toEqual({});
  });
});
