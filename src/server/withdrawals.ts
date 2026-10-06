import "server-only";

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { registerWithdrawal as registerSchema, returnRequest, withdrawalConfirm, withdrawalStart } from "@/lib/return-input";
import { noonOf, dayIn } from "@/lib/work-dates";
import { refundDeadline, sendBackDay } from "@/lib/withdrawal";
import {
  declaredProblems,
  type LineEligibility,
  type LineRight,
  type QuantityProblem,
  type ReturnReason,
  type WithdrawalWindow,
  orderRight,
} from "@/lib/withdrawal";

import { unarchiveForReturn } from "./order-archive";
import { guarded, refusal, type Refused } from "./return-errors";
import { judge, loadFacts, recipientsOf, writeEvent, type OrderFacts } from "./return-facts";
import { buildAcknowledgement, sendWithdrawalAcknowledgement } from "./return-emails";
import { NOTHING_SENT_SQL } from "./return-sql";

type Row = Record<string, unknown>;

/**
 * The withdrawal function and the voluntary return request, the shopper's side (D153, `docs/returns.md`).
 *
 * - **Step 1, `startWithdrawal()`**: matches the order number and the email without telling a stranger whether an order
 *   exists (the answer is the same shape, after a fixed delay floor), and keeps a *pending* request for 24 hours. It is
 *   not a withdrawal yet.
 * - **Step 2, `confirmWithdrawal()`**: the legal act. One transaction records the confirmation, makes the return
 *   (starting `approved`) and writes the order's history; then the acknowledgement is emailed in the same request. An
 *   email that cannot be handed over leaves the withdrawal standing, as "acknowledgement not sent".
 * - **`startReturnRequest()`**: the store's own longer window, a voluntary return the store may approve or decline.
 *
 * Access is the order number with the email on the order (or its customer's), or the order page's own key, or the
 * signed-in customer's ownership: never the order number alone. Abuse limits are counted in the database by the
 * request's own keys (order, email, store, per hour), never by IP address or cookie. Nothing here sets a cookie or stores
 * anything in the browser.
 */

/** What a stranger cannot tell apart: how long an answer takes. Applied to every answer of step 1 and the lookup. */
export const DELAY_FLOOR_MS = 600;

/** The most requests per hour, by the request's own keys. */
export const WITHDRAWAL_LIMITS = { perOrder: 5, perEmail: 10, perStore: 300 } as const;
export const RETURN_REQUEST_LIMITS = { openPerOrder: 5, perEmail: 10, perStore: 300 } as const;
/**
 * Guesses that matched no order, per hour, by what the request itself supplied (D153): the typed email, the typed order number
 * and the store in all. Order numbers are a sequence, so without this anyone who knows an email could walk through them. Only
 * hashes are kept (`commerce.withdrawal_attempts`), never an IP address, a cookie or the raw value.
 */
export const ATTEMPT_LIMITS = { perEmail: 10, perOrder: 10, perStore: 300 } as const;

export type ShopperWho = {
  orderNumber: string;
  email: string;
  /** The order page's key (the payment's reference): proves the order is the visitor's. */
  orderKey?: string | null;
  /** The signed-in customer, when there is one: their own orders need no email. */
  customerId?: string | null;
};

export type Options = { customerId?: string | null; now?: Date; floorMs?: number };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function floor<T>(startedAt: number, ms: number | undefined, value: T): Promise<T> {
  const wait = (ms ?? DELAY_FLOOR_MS) - (Date.now() - startedAt);
  if (wait > 0) await sleep(wait);
  return value;
}

const normalNumber = (value: string) => value.replace(/\s+/g, "").replace(/^#/, "").toUpperCase();

const attemptKey = (storeId: string, kind: "email" | "order", value: string) =>
  createHash("sha256").update(`${storeId}|${kind}|${value}`).digest("hex");

/** The keys a request supplies for counting guesses: the typed email and the typed order number, normalised. */
function attemptKeys(storeId: string, who: { orderNumber: string; email: string }): { kind: "email" | "order"; hash: string }[] {
  const keys: { kind: "email" | "order"; hash: string }[] = [];
  const number = normalNumber(who.orderNumber);
  const email = who.email.trim().toLowerCase();
  if (number) keys.push({ kind: "order", hash: attemptKey(storeId, "order", number) });
  if (email) keys.push({ kind: "email", hash: attemptKey(storeId, "email", email) });
  return keys;
}

/** Which counts of guesses in the last hour are over their limit. */
type GuessLimits = { email: boolean; order: boolean; store: boolean };

/** Whether too many guesses were made in the last hour by this request's own keys, or in the store in all. */
async function guessLimits(storeId: string, who: { orderNumber: string; email: string }): Promise<GuessLimits> {
  const out: GuessLimits = { email: false, order: false, store: false };
  const limit = { email: ATTEMPT_LIMITS.perEmail, order: ATTEMPT_LIMITS.perOrder };
  for (const key of attemptKeys(storeId, who)) {
    const [row] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.withdrawal_attempts
      where store_id = ${storeId}::uuid and key_kind = ${key.kind} and key_hash = ${key.hash} and at > now() - interval '1 hour'
    `);
    if (Number(row?.n ?? 0) >= limit[key.kind]) out[key.kind] = true;
  }
  const [all] = await db().execute<Row>(sql`
    select count(*)::int as n from commerce.withdrawal_attempts where store_id = ${storeId}::uuid and at > now() - interval '1 hour'
  `);
  out.store = Number(all?.n ?? 0) >= ATTEMPT_LIMITS.perStore;
  return out;
}

/**
 * Whether the limits turn this attempt away. Guessing is only ever done with an email and a number, so the limits turn away
 * what is shown by those (and what matched nothing); an order shown by its page's key, which cannot be guessed, or by being the
 * signed-in customer, is never turned away by them: nobody can lock a consumer out of the function by guessing at their order.
 */
const turnedAway = (limits: GuessLimits, proof: Proof | null): boolean =>
  (limits.email || limits.order || limits.store) && proof !== "key" && proof !== "customer";

/** Keeps a guess that matched no order, as hashes of what the request supplied. */
async function recordGuess(storeId: string, who: { orderNumber: string; email: string }): Promise<void> {
  for (const key of attemptKeys(storeId, who)) {
    await db().execute(sql`
      insert into commerce.withdrawal_attempts (store_id, key_kind, key_hash) values (${storeId}::uuid, ${key.kind}, ${key.hash})
    `);
  }
}

/** How the visitor showed the order is theirs. */
export type Proof = "email" | "key" | "customer";

/**
 * The order the shopper means, or null: the number (without spaces or case) of one of this store's own orders, shown by
 * the email on the order or its customer, by the order page's key, or by being the signed-in customer. A copied order
 * (D129) is never found.
 */
export async function matchOrder(storeId: string, who: ShopperWho): Promise<{ id: string; proof: Proof } | null> {
  const number = normalNumber(who.orderNumber);
  const email = who.email.trim().toLowerCase();
  const key = who.orderKey?.trim() || null;
  const customerId = who.customerId ?? null;
  if (!number) return null;
  const [row] = await db().execute<Row>(sql`
    select o.id,
      (${customerId}::uuid is not null and o.customer_id = ${customerId}::uuid) as by_customer,
      (${key}::text is not null and exists (
        select 1 from commerce.payments p
        where p.store_id = o.store_id and p.order_id = o.id and p.provider in ('stripe', 'venue', 'manual') and p.provider_reference = ${key}
      )) as by_key
    from commerce.orders o
    left join commerce.customers c on c.store_id = o.store_id and c.id = o.customer_id
    where o.store_id = ${storeId}::uuid and o.copied_from is null
      and upper(regexp_replace(o.number, '\\s', '', 'g')) = ${number}
      and (
        (${email} <> '' and (lower(o.email) = ${email} or lower(c.email) = ${email}))
        or (${customerId}::uuid is not null and o.customer_id = ${customerId}::uuid)
        or (${key}::text is not null and exists (
          select 1 from commerce.payments p
          where p.store_id = o.store_id and p.order_id = o.id and p.provider in ('stripe', 'venue', 'manual') and p.provider_reference = ${key}
        ))
      )
    limit 1
  `);
  if (!row) return null;
  // The strongest proof the visitor gave: the order page's key (it cannot be guessed), then being signed in, then the email.
  return { id: String(row.id), proof: row.by_key ? "key" : row.by_customer ? "customer" : "email" };
}

/** The id of the order the shopper means, or null (see `matchOrder()`). */
export async function findOrderFor(storeId: string, who: ShopperWho): Promise<string | null> {
  return (await matchOrder(storeId, who))?.id ?? null;
}

/**
 * Whether the visitor may see this order's returns: it is the signed-in customer's own, or they hold the order page's key.
 * For the order page and My account, which already know the order.
 */
export async function shopperCanAccessOrder(storeId: string, orderId: string, access: { sessionId: string } | { customerId: string }): Promise<boolean> {
  const [row] =
    "customerId" in access
      ? await db().execute<Row>(sql`
          select 1 from commerce.orders
          where store_id = ${storeId}::uuid and id = ${orderId}::uuid and customer_id = ${access.customerId}::uuid and copied_from is null
        `)
      : await db().execute<Row>(sql`
          select 1 from commerce.payments
          where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and provider in ('stripe', 'venue', 'manual')
            and provider_reference = ${access.sessionId}
        `);
  return Boolean(row);
}

// ---------------------------------------------------------------------------
// What the shopper sees of an order
// ---------------------------------------------------------------------------

export type WithdrawalLineView = LineEligibility & {
  title: string;
  sku: string;
  /** Units bought on the line. */
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
};

export type WithdrawalOrderView = {
  orderId: string;
  number: string;
  currency: string;
  status: string;
  /** Where the order stands in time: the statutory period, the store's own, or over. */
  window: WithdrawalWindow;
  /** What the shopper can do with the order as a whole: a withdrawal, a voluntary return, or nothing. */
  right: LineRight;
  /** Every line, those that cannot be withdrawn with their plain reason (`refusal`, `exclusion`). */
  lines: WithdrawalLineView[];
  business: boolean;
  /** A subscription's order: accepted like any other, the subscription itself is ended separately. */
  subscription: boolean;
  storeName: string;
  contactEmail: string | null;
  timeZone: string;
  whoPaysReturn: "shopper" | "store";
  /** The store's own window in days (14 when it has none beyond the statutory period). */
  windowDays: number;
  /** The email on the order, to prefill the form: given only when the visitor proved the order by its key or by being signed in. */
  email: string | null;
};

function viewOf(facts: OrderFacts, now: Date, proof: Proof = "email"): WithdrawalOrderView {
  const { lines, window } = judge(facts, now);
  return {
    orderId: facts.orderId,
    number: facts.number,
    currency: facts.currency,
    status: facts.status,
    window,
    right: orderRight(lines),
    lines: lines.map((eligibility) => {
      const line = facts.lines.find((l) => l.id === eligibility.lineId)!;
      return { ...eligibility, title: line.title, sku: line.sku, quantity: line.quantity, unitPriceMinor: line.unitPriceMinor, totalMinor: line.totalMinor };
    }),
    business: facts.order.business,
    subscription: Boolean(facts.order.subscription),
    storeName: facts.storeName,
    contactEmail: facts.contactEmail,
    timeZone: facts.timeZone,
    whoPaysReturn: facts.whoPaysReturn,
    windowDays: facts.settings.windowDays,
    email: proof === "email" ? null : facts.email || null,
  };
}

const lookupInput = z.object({
  orderNumber: withdrawalStart.shape.orderNumber,
  /** Optional here: an order opened from its own page (by its key) or by a signed-in customer needs no email. */
  email: z.string().trim().toLowerCase().max(254).default(""),
  orderKey: withdrawalStart.shape.orderKey,
});

/**
 * The order's lines and what can be done with each, for the withdrawal form, after the same matching as step 1 (a
 * stranger gets `null` for any order that is not theirs, after the same delay, and nothing else). The reply shown to the
 * visitor is the same whether it matched or not: "If the details match an order, you will see the next step."
 */
export async function lookupWithdrawableOrder(storeId: string, input: unknown, options: Options = {}): Promise<WithdrawalOrderView | null> {
  const startedAt = Date.now();
  const parsed = lookupInput.safeParse(input);
  if (!parsed.success) return floor(startedAt, options.floorMs, null);
  const limits = await guessLimits(storeId, parsed.data);
  const match = await matchOrder(storeId, { ...parsed.data, customerId: options.customerId });
  if (!match) await recordGuess(storeId, parsed.data);
  if (turnedAway(limits, match?.proof ?? null)) return floor(startedAt, options.floorMs, null);
  const facts = match ? await loadFacts(storeId, match.id) : null;
  return floor(startedAt, options.floorMs, facts && match ? viewOf(facts, options.now ?? new Date(), match.proof) : null);
}

// ---------------------------------------------------------------------------
// Step 1
// ---------------------------------------------------------------------------

export type Problem = { path: string; code: string };

export type PendingWithdrawal = {
  id: string;
  name: string;
  email: string;
  expiresAt: string;
  orderNumber: string;
  currency: string;
  lines: { lineId: string; title: string; sku: string; quantity: number }[];
};

export type StartOutcome =
  | { ok: false; reason: "invalid"; problems: Problem[] }
  /** Too many requests in the last hour by this email, order or store; asked of nobody's order in particular. */
  | { ok: false; reason: "limited" }
  /** The same shape for any order that is not the visitor's. */
  | { ok: true; matched: false }
  | {
      ok: true;
      matched: true;
      order: WithdrawalOrderView;
      /** The pending request, to be confirmed in step 2; null when nothing declared can be withdrawn (see `problems`). */
      request: PendingWithdrawal | null;
      problems: QuantityProblem[];
    };

function problemsOf(error: z.ZodError): Problem[] {
  return error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.message }));
}

async function count(query: ReturnType<typeof sql>): Promise<number> {
  const [row] = await db().execute<Row>(query);
  return Number(row?.n ?? 0);
}

async function pendingView(storeId: string, requestId: string): Promise<PendingWithdrawal | null> {
  const [request] = await db().execute<Row>(sql`
    select w.id, w.name, w.email, w.expires_at, o.number, o.currency from commerce.withdrawal_requests w
    join commerce.orders o on o.store_id = w.store_id and o.id = w.order_id
    where w.store_id = ${storeId}::uuid and w.id = ${requestId}::uuid
  `);
  if (!request) return null;
  const lines = await db().execute<Row>(sql`
    select l.order_line_id, ol.title, ol.sku, l.quantity from commerce.withdrawal_request_lines l
    join commerce.order_lines ol on ol.store_id = l.store_id and ol.id = l.order_line_id
    where l.store_id = ${storeId}::uuid and l.withdrawal_request_id = ${requestId}::uuid order by ol.title, ol.id
  `);
  return {
    id: String(request.id),
    name: String(request.name),
    email: String(request.email),
    expiresAt: new Date(String(request.expires_at)).toISOString(),
    orderNumber: String(request.number),
    currency: String(request.currency).trim(),
    lines: lines.map((l) => ({ lineId: String(l.order_line_id), title: String(l.title), sku: String(l.sku), quantity: Number(l.quantity) })),
  };
}

/**
 * Step 1 of the withdrawal button: the statement. Keeps a pending request when the details match an order and what was
 * declared can be withdrawn; it expires after 24 hours and is deleted by the daily job. Asking again for the same thing
 * returns the pending request it already made. Never a withdrawal until `confirmWithdrawal()`.
 */
export async function startWithdrawal(storeId: string, input: unknown, options: Options = {}): Promise<StartOutcome> {
  const startedAt = Date.now();
  const parsed = withdrawalStart.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", problems: problemsOf(parsed.error) };
  const data = parsed.data;
  const now = options.now ?? new Date();

  const tooManyByEmail = await count(sql`
    select count(*)::int as n from commerce.withdrawal_requests
    where store_id = ${storeId}::uuid and lower(email) = ${data.email} and submitted_at > now() - interval '1 hour'
  `);
  const tooManyInStore = await count(sql`
    select count(*)::int as n from commerce.withdrawal_requests
    where store_id = ${storeId}::uuid and submitted_at > now() - interval '1 hour'
  `);
  if (tooManyByEmail >= WITHDRAWAL_LIMITS.perEmail || tooManyInStore >= WITHDRAWAL_LIMITS.perStore) {
    return floor(startedAt, options.floorMs, { ok: false, reason: "limited" });
  }
  // Guesses that matched nothing are counted by the email and the order number typed, so a sequence of numbers cannot be walked:
  // over the limit, what is shown by email and number is turned away whether or not it matches (the same answer for any number).
  const limits = await guessLimits(storeId, data);
  const match = await matchOrder(storeId, { ...data, customerId: options.customerId });
  if (turnedAway(limits, match?.proof ?? null)) {
    if (!match) await recordGuess(storeId, data);
    return floor(startedAt, options.floorMs, { ok: false, reason: "limited" });
  }
  if (!match) {
    await recordGuess(storeId, data);
    return floor(startedAt, options.floorMs, { ok: true, matched: false });
  }
  const orderId = match.id;
  const facts = await loadFacts(storeId, orderId);
  if (!facts) return floor(startedAt, options.floorMs, { ok: true, matched: false });

  const tooManyForOrder = await count(sql`
    select count(*)::int as n from commerce.withdrawal_requests
    where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and submitted_at > now() - interval '1 hour'
  `);
  if (tooManyForOrder >= WITHDRAWAL_LIMITS.perOrder) return floor(startedAt, options.floorMs, { ok: false, reason: "limited" });

  const order = viewOf(facts, now, match.proof);
  const problems = declaredProblems(data.lines, order.lines, "withdrawal");
  if (problems.length > 0) return floor(startedAt, options.floorMs, { ok: true, matched: true, order, request: null, problems });
  // The request keeps the address the order is proven by. A visitor who showed the order by its page's key, or by being the
  // signed-in customer, may have typed any address: it is never what the store writes to (the acknowledgement and every
  // later email go to the order's own address, `recipientsOf()`), so the order's own is what is kept.
  const email = match.proof === "email" ? data.email : (recipientsOf(facts)[0] ?? data.email);

  const pairs = [...data.lines].sort((a, b) => (a.lineId < b.lineId ? -1 : 1)).map((l) => [l.lineId, l.quantity]);
  // The same statement made again is the same pending request, not a second row.
  const [same] = await db().execute<Row>(sql`
    select w.id from commerce.withdrawal_requests w
    where w.store_id = ${storeId}::uuid and w.order_id = ${orderId}::uuid and w.status = 'pending' and w.expires_at > now()
      and lower(w.email) = ${email} and w.name = ${data.name}
      and (select jsonb_agg(jsonb_build_array(l.order_line_id, l.quantity) order by l.order_line_id)
             from commerce.withdrawal_request_lines l where l.store_id = w.store_id and l.withdrawal_request_id = w.id) = ${JSON.stringify(pairs)}::jsonb
    limit 1
  `);
  let requestId = same ? String(same.id) : null;
  if (!requestId) {
    const made = await guarded(() =>
      db().transaction(async (tx) => {
        const [row] = await tx.execute<Row>(sql`
          insert into commerce.withdrawal_requests (store_id, order_id, name, email, channel, locale, market_code)
          values (${storeId}::uuid, ${orderId}::uuid, ${data.name}, ${email}, 'web', ${facts.locale}, ${facts.marketCode})
          returning id
        `);
        for (const line of data.lines) {
          await tx.execute(sql`
            insert into commerce.withdrawal_request_lines (store_id, withdrawal_request_id, order_line_id, quantity)
            values (${storeId}::uuid, ${String(row.id)}::uuid, ${line.lineId}::uuid, ${line.quantity})
          `);
        }
        return String(row.id);
      }),
    );
    if (typeof made !== "string") {
      return floor(startedAt, options.floorMs, {
        ok: true,
        matched: true,
        order,
        request: null,
        problems: data.lines.map((l) => ({ lineId: l.lineId, code: "too_many" as const })),
      });
    }
    requestId = made;
  }
  const request = await pendingView(storeId, requestId);
  return floor(startedAt, options.floorMs, { ok: true, matched: true, order, request, problems: [] });
}

/**
 * A request by its id (a random secret held by the shopper's page): what step 2 lists, or, once confirmed, the
 * confirmation. Null when there is none (a lapsed one is deleted by the daily job, and until then reads as expired).
 */
export async function getWithdrawalRequest(
  storeId: string,
  requestId: string,
): Promise<{ status: "pending" | "confirmed" | "expired"; request: PendingWithdrawal; confirmedAt: string | null; acknowledged: boolean } | null> {
  if (!z.uuid().safeParse(requestId).success) return null;
  const request = await pendingView(storeId, requestId);
  if (!request) return null;
  const [row] = await db().execute<Row>(sql`
    select status, confirmed_at, acknowledged_at, expires_at < now() as lapsed from commerce.withdrawal_requests
    where store_id = ${storeId}::uuid and id = ${requestId}::uuid
  `);
  const status = String(row.status) === "confirmed" ? "confirmed" : String(row.status) === "expired" || Boolean(row.lapsed) ? "expired" : "pending";
  return {
    status,
    request,
    confirmedAt: row.confirmed_at ? new Date(String(row.confirmed_at)).toISOString() : null,
    acknowledged: row.acknowledged_at !== null,
  };
}

// ---------------------------------------------------------------------------
// Step 2
// ---------------------------------------------------------------------------

export type ConfirmedReturn = {
  id: string;
  number: string;
  /** The secret address of the shopper's status page (`/returns/{token}`). */
  token: string;
  lines: { lineId: string; title: string; quantity: number; decision: "accept" | "decline"; declineReason: string | null }[];
};

export type AcknowledgementView = {
  /** The email was handed to the email provider, to the order's own address: a durable medium. False shows staff "acknowledgement not sent". */
  sent: boolean;
  /** The address it goes to (the order's own), for the page to name; null when the order has none. */
  to: string | null;
  /** The reference the acknowledgement names: the return's number. */
  reference: string | null;
  subject: string | null;
  /** The acknowledgement as plain text, shown on the confirmation page so the shopper has it at once. */
  text: string | null;
};

export type ConfirmOutcome =
  | {
      ok: true;
      /** The request was confirmed before: nothing was written again. */
      already: boolean;
      requestId: string;
      orderNumber: string;
      confirmedAt: string;
      /** The last store day (`YYYY-MM-DD`) to send the goods back, 14 days after the declaration. */
      sendBackBy: string;
      /** Withdrawn before the goods were sent: there is nothing to send back, and no refund is held for the goods. */
      nothingSent: boolean;
      /** The legal deadline for the refund: 14 days after the store was informed. */
      refundBy: string;
      returns: ConfirmedReturn[];
      acknowledgement: AcknowledgementView;
    }
  | Refused;

async function confirmedReturns(storeId: string, requestId: string): Promise<ConfirmedReturn[]> {
  const returns = await db().execute<Row>(sql`
    select id, number, public_token from commerce.returns
    where store_id = ${storeId}::uuid and withdrawal_request_id = ${requestId}::uuid order by created_at
  `);
  const out: ConfirmedReturn[] = [];
  for (const r of returns) {
    const lines = await db().execute<Row>(sql`
      select rl.order_line_id, ol.title, rl.quantity, rl.decision, rl.decline_reason from commerce.return_lines rl
      join commerce.order_lines ol on ol.store_id = rl.store_id and ol.id = rl.order_line_id
      where rl.store_id = ${storeId}::uuid and rl.return_id = ${String(r.id)}::uuid order by ol.title, ol.id
    `);
    out.push({
      id: String(r.id),
      number: String(r.number),
      token: String(r.public_token),
      lines: lines.map((l) => ({
        lineId: String(l.order_line_id),
        title: String(l.title),
        quantity: Number(l.quantity),
        decision: l.decision === "decline" ? "decline" : "accept",
        declineReason: l.decline_reason ? String(l.decline_reason) : null,
      })),
    });
  }
  return out;
}

/** Records the acknowledgement on the request once it was handed over; never takes one back or moves the first time. */
async function recordAcknowledgement(storeId: string, requestId: string, messageId: string | null): Promise<void> {
  if (!messageId) return;
  await db().execute(sql`
    update commerce.withdrawal_requests set acknowledged_at = now(), acknowledgement_reference = ${messageId}
    where store_id = ${storeId}::uuid and id = ${requestId}::uuid and status = 'confirmed' and acknowledged_at is null
  `);
}

async function confirmedOutcome(storeId: string, requestId: string, already: boolean): Promise<ConfirmOutcome> {
  const [request] = await db().execute<Row>(sql`
    select w.confirmed_at, w.acknowledged_at, w.acknowledgement_reference, o.number, s.time_zone from commerce.withdrawal_requests w
    join commerce.orders o on o.store_id = w.store_id and o.id = w.order_id
    join commerce.stores s on s.id = w.store_id
    where w.store_id = ${storeId}::uuid and w.id = ${requestId}::uuid and w.status = 'confirmed'
  `);
  if (!request) return refusal("not_found", "We could not find that withdrawal.");
  const confirmedAt = new Date(String(request.confirmed_at));
  // The acknowledgement goes in the same request. A repeated confirmation tries again only if the first never got out.
  let sent = request.acknowledged_at !== null;
  if (!sent) {
    const outcome = await sendWithdrawalAcknowledgement(storeId, requestId);
    sent = outcome.sent;
    await recordAcknowledgement(storeId, requestId, outcome.messageId);
  }
  const built = await buildAcknowledgement(storeId, requestId);
  const returns = await confirmedReturns(storeId, requestId);
  const [unsent] = await db().execute<Row>(sql`
    select ${NOTHING_SENT_SQL} as nothing_sent from commerce.returns r
    where r.store_id = ${storeId}::uuid and r.withdrawal_request_id = ${requestId}::uuid
  `);
  return {
    ok: true,
    already,
    requestId,
    orderNumber: String(request.number),
    confirmedAt: confirmedAt.toISOString(),
    sendBackBy: sendBackDay(confirmedAt, String(request.time_zone)),
    nothingSent: Boolean(unsent?.nothing_sent),
    refundBy: refundDeadline(confirmedAt).toISOString(),
    returns,
    acknowledgement: {
      sent,
      to: built?.to[0] ?? null,
      reference: built?.reference ?? returns[0]?.number ?? null,
      subject: built?.email.subject ?? null,
      text: built?.email.text ?? null,
    },
  };
}

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

/**
 * The legal act, written in a transaction that already holds the pending request: the request is confirmed (at the
 * database's clock, or at `confirmedAt` when staff register a statement the store was told earlier), the withdrawal return
 * is made (`kind withdrawal`, starting approved, with the lines the law gives the right to; a line the law excludes that has
 * come to be so since is a declined line with its reason) and the order's history says so.
 */
async function writeConfirmation(
  tx: Tx,
  storeId: string,
  requestId: string,
  facts: OrderFacts,
  eligible: LineEligibility[],
  by: { actor: "shopper" | "staff"; confirmedAt?: Date | null; note?: string | null; registered?: Record<string, unknown> },
): Promise<{ ok: true; returnId: string; number: string } | Refused> {
  const declared = await tx.execute<Row>(sql`
    select order_line_id, quantity from commerce.withdrawal_request_lines
    where store_id = ${storeId}::uuid and withdrawal_request_id = ${requestId}::uuid order by order_line_id
  `);

  const keep: { lineId: string; quantity: number; decision: "accept" | "decline"; reason: string | null }[] = [];
  for (const row of declared) {
    const lineId = String(row.order_line_id);
    const quantity = Number(row.quantity);
    const el = eligible.find((e) => e.lineId === lineId);
    if (el && el.right === "withdrawal" && el.maxQuantity >= quantity) keep.push({ lineId, quantity, decision: "accept", reason: null });
    else if (el && el.refusal === "excluded_by_law" && el.exclusion) keep.push({ lineId, quantity, decision: "decline", reason: "excluded_by_law" });
    else return refusal("not_available", "Something you declared can no longer be withdrawn. Start again to see what can.");
  }
  if (!keep.some((l) => l.decision === "accept")) return refusal("nothing_to_withdraw", "Nothing you declared can be withdrawn.");

  await tx.execute(sql`
    update commerce.withdrawal_requests set status = 'confirmed', confirmed_at = ${by.confirmedAt ? by.confirmedAt.toISOString() : null}::timestamptz
    where store_id = ${storeId}::uuid and id = ${requestId}::uuid
  `);
  const [ret] = await tx.execute<Row>(sql`
    insert into commerce.returns (store_id, order_id, withdrawal_request_id, kind, status, instructions, return_address, staff_note)
    values (${storeId}::uuid, ${facts.orderId}::uuid, ${requestId}::uuid, 'withdrawal', 'approved',
            ${facts.settings.instructions || null},
            ${facts.settings.returnAddress ? JSON.stringify(facts.settings.returnAddress) : null}::jsonb, ${by.note ?? null})
    returning id, number
  `);
  // A return on an archived order starts work again (D173): the order is back in the list.
  await unarchiveForReturn(tx, storeId, facts.orderId);
  for (const line of keep) {
    await tx.execute(sql`
      insert into commerce.return_lines (store_id, return_id, order_line_id, quantity, decision, decline_reason)
      values (${storeId}::uuid, ${String(ret.id)}::uuid, ${line.lineId}::uuid, ${line.quantity}, ${line.decision}, ${line.reason})
    `);
  }
  const data = {
    returnId: String(ret.id),
    number: String(ret.number),
    requestId,
    ...(by.registered ? { registered: by.registered } : {}),
    lines: keep.map((l) => ({
      lineId: l.lineId,
      sku: facts.lines.find((x) => x.id === l.lineId)?.sku ?? null,
      quantity: l.quantity,
      decision: l.decision,
    })),
  };
  await writeEvent(tx, storeId, facts.orderId, "return.confirmed", data, by.actor);
  await writeEvent(tx, storeId, facts.orderId, "return.approved", { ...data, automatic: true }, "system");
  return { ok: true, returnId: String(ret.id), number: String(ret.number) };
}

/**
 * Step 2: *Confirm withdrawal*. The legal act, in one transaction: the request is confirmed (at the database's clock),
 * the return is made (`kind withdrawal`, starting approved, with the lines the law gives the right to; a line the law
 * excludes that has come to be so since step 1 is a declined line with its reason), and the order's history says so.
 * The period is judged as it stood when the shopper made the statement (step 1), so a day passing between the steps
 * never takes the right away. Idempotent: confirming again returns the same result and writes nothing. The
 * acknowledgement is emailed after the transaction, in the same request, and recorded when it was handed over.
 */
export async function confirmWithdrawal(storeId: string, input: unknown): Promise<ConfirmOutcome> {
  const parsed = withdrawalConfirm.safeParse(input);
  if (!parsed.success) return refusal("not_found", "We could not find that withdrawal.");
  const requestId = parsed.data.requestId;

  // Read before the transaction, so it holds one connection and no more: the facts, and the request as it stands.
  const [first] = await db().execute<Row>(sql`
    select order_id, status, expires_at, submitted_at from commerce.withdrawal_requests
    where store_id = ${storeId}::uuid and id = ${requestId}::uuid
  `);
  if (!first) return refusal("not_found", "We could not find that withdrawal.");
  if (first.status === "confirmed") return confirmedOutcome(storeId, requestId, true);
  const facts = await loadFacts(storeId, String(first.order_id));
  if (!facts) return refusal("not_found", "We could not find that withdrawal.");
  const { lines: eligible } = judge(facts, new Date(String(first.submitted_at)));

  const made = await guarded(async () =>
    db().transaction(async (tx): Promise<{ ok: true; already: boolean } | Refused> => {
      const [request] = await tx.execute<Row>(sql`
        select * from commerce.withdrawal_requests where store_id = ${storeId}::uuid and id = ${requestId}::uuid for update
      `);
      if (!request) return refusal("not_found", "We could not find that withdrawal.");
      if (request.status === "confirmed") return { ok: true, already: true };
      if (request.status === "expired" || new Date(String(request.expires_at)).getTime() < Date.now()) {
        return refusal("lapsed", "The request was not confirmed in time. Start again.");
      }
      const written = await writeConfirmation(tx, storeId, requestId, facts, eligible, { actor: "shopper" });
      if (!written.ok) return written;
      return { ok: true, already: false };
    }),
  );
  if (!made.ok) return made;
  return confirmedOutcome(storeId, requestId, made.already);
}

/** Staff's *Send again*: the acknowledgement of a confirmed withdrawal, to the order's own address, by a key of its own. */
export async function resendAcknowledgement(
  storeId: string,
  requestId: string,
): Promise<{ ok: true; sent: boolean } | Refused> {
  const [request] = await db().execute<Row>(sql`
    select status from commerce.withdrawal_requests where store_id = ${storeId}::uuid and id = ${requestId}::uuid
  `);
  if (!request || request.status !== "confirmed") return refusal("not_found", "That withdrawal is not confirmed.");
  const outcome = await sendWithdrawalAcknowledgement(storeId, requestId, { resend: true });
  await recordAcknowledgement(storeId, requestId, outcome.messageId);
  return { ok: true, sent: outcome.sent };
}

// ---------------------------------------------------------------------------
// A withdrawal made outside the function: staff register it
// ---------------------------------------------------------------------------

export type RegisterOutcome =
  | { ok: true; returnId: string; number: string; requestId: string; confirmedAt: string; acknowledged: boolean }
  | Refused;

/**
 * Staff register a withdrawal the consumer made outside the withdrawal function (CRD Art. 11: any unequivocal statement
 * counts): an email, a letter, a call, or a statement the function could not match to an order because of a typo. The store
 * was informed on `informedOn` (its calendar day; empty is now), and that moment is what starts the 14 days for the refund
 * and is stated in the acknowledgement. The request, its lines, the confirmation and the withdrawal return are written exactly
 * as the consumer's own two steps write them (`writeConfirmation()`), the acknowledgement goes to the order's own address and
 * the order's history says staff registered it, how and by whom. The period is judged as it stood when the store was told. A
 * statement that by the records came after the 14 days can be registered as `late` with its reason (the consumer was not given
 * the information about the right of withdrawal, or received the goods later): the period is then longer by law (Art. 10).
 */
export async function registerWithdrawal(storeId: string, input: unknown, accountId: string | null, now = new Date()): Promise<RegisterOutcome> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) return refusal("invalid", parsed.error.issues[0]?.message ?? "Check the details and try again.");
  const data = parsed.data;
  const [found] = await db().execute<Row>(sql`
    select o.id, s.time_zone from commerce.orders o join commerce.stores s on s.id = o.store_id
    where o.store_id = ${storeId}::uuid and o.copied_from is null and upper(regexp_replace(o.number, '\\s', '', 'g')) = ${normalNumber(data.orderNumber)}
  `);
  if (!found) return refusal("not_found", "No order of this store has that number.");
  const facts = await loadFacts(storeId, String(found.id));
  if (!facts) return refusal("not_found", "No order of this store has that number.");
  if (!["paid", "fulfilled", "closed"].includes(facts.status)) return refusal("not_paid", "An order that was not paid cannot be withdrawn from.");

  // When the store was told: now, or noon of the day it names (never in the future).
  let informedAt = now;
  if (data.informedOn) {
    informedAt = noonOf(data.informedOn, facts.timeZone);
    if (informedAt.getTime() > now.getTime()) {
      if (data.informedOn > dayIn(now, facts.timeZone)) return refusal("future", "The store cannot have been told in the future.");
      informedAt = now;
    }
  }
  const { lines: judged } = judge(facts, informedAt);
  // Past the 14 days by the records, but accepted as in time by the store (information not given, goods received later).
  const eligible = data.late
    ? judged.map((line) => (line.refusal === "period_over" ? { ...line, right: "withdrawal" as const, maxQuantity: line.remaining, refusal: null } : line))
    : judged;
  const problems = declaredProblems(data.lines, eligible, "withdrawal");
  if (problems.length > 0) {
    const first = problems[0];
    const words: Record<QuantityProblem["code"], string> = {
      unknown_line: "A line you chose is not on this order.",
      no_right: "A line you chose has no right of withdrawal now (see the order's lines for why).",
      too_many: "More is chosen than is left to withdraw from.",
      not_positive: "Each quantity is a whole number of 1 or more.",
      duplicate: "Each line is chosen once.",
    };
    return refusal(`line_${first.code}`, words[first.code]);
  }
  const recipient = recipientsOf(facts)[0] ?? "";
  const made = await guarded(async () =>
    db().transaction(async (tx) => {
      const [request] = await tx.execute<Row>(sql`
        insert into commerce.withdrawal_requests (store_id, order_id, name, email, channel, locale, market_code, submitted_at)
        values (${storeId}::uuid, ${facts.orderId}::uuid, ${data.name}, ${recipient}, ${data.channel}, ${facts.locale}, ${facts.marketCode},
                ${informedAt.toISOString()}::timestamptz)
        returning id
      `);
      const requestId = String(request.id);
      for (const line of data.lines) {
        await tx.execute(sql`
          insert into commerce.withdrawal_request_lines (store_id, withdrawal_request_id, order_line_id, quantity)
          values (${storeId}::uuid, ${requestId}::uuid, ${line.lineId}::uuid, ${line.quantity})
        `);
      }
      const note = [`Registered by staff (${data.channel}).`, data.late ? `Accepted as in time: ${data.lateReason}` : null, data.note].filter(Boolean).join("\n");
      const written = await writeConfirmation(tx, storeId, requestId, facts, eligible, {
        actor: "staff",
        confirmedAt: informedAt,
        note,
        registered: { by: accountId, channel: data.channel, late: data.late },
      });
      if (!written.ok) return written;
      return { ok: true as const, requestId, returnId: written.returnId, number: written.number };
    }),
  );
  if (!made.ok) return made;
  // The acknowledgement goes out in the same request, to the order's own address, as for the consumer's own statement.
  const outcome = await sendWithdrawalAcknowledgement(storeId, made.requestId);
  await recordAcknowledgement(storeId, made.requestId, outcome.messageId);
  return {
    ok: true,
    returnId: made.returnId,
    number: made.number,
    requestId: made.requestId,
    confirmedAt: informedAt.toISOString(),
    acknowledged: outcome.sent,
  };
}

// ---------------------------------------------------------------------------
// The store's own window: a voluntary return
// ---------------------------------------------------------------------------

export type ReturnRequestOutcome =
  | { ok: false; reason: "invalid"; problems: Problem[] }
  | { ok: false; reason: "limited" }
  | { ok: true; matched: false }
  | {
      ok: true;
      matched: true;
      order: WithdrawalOrderView;
      /** Made when everything declared can be asked for; the store approves or declines it. */
      created: { id: string; number: string; token: string } | null;
      problems: QuantityProblem[];
    };

/**
 * A return request inside the store's own window (kind `return`, status `requested`): a reason chosen from the list and
 * an optional note, for the lines the store takes back voluntarily. The store approves or declines. Matched and limited
 * like the withdrawal; the statutory right is never asked for here.
 */
export async function startReturnRequest(storeId: string, input: unknown, options: Options = {}): Promise<ReturnRequestOutcome> {
  const startedAt = Date.now();
  const parsed = returnRequest.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", problems: problemsOf(parsed.error) };
  const data = parsed.data;
  const now = options.now ?? new Date();

  const byEmail = await count(sql`
    select count(*)::int as n from commerce.returns r join commerce.orders o on o.store_id = r.store_id and o.id = r.order_id
    where r.store_id = ${storeId}::uuid and r.kind = 'return' and lower(o.email) = ${data.email} and r.created_at > now() - interval '1 hour'
  `);
  const inStore = await count(sql`
    select count(*)::int as n from commerce.returns where store_id = ${storeId}::uuid and kind = 'return' and created_at > now() - interval '1 hour'
  `);
  if (byEmail >= RETURN_REQUEST_LIMITS.perEmail || inStore >= RETURN_REQUEST_LIMITS.perStore) {
    return floor(startedAt, options.floorMs, { ok: false, reason: "limited" });
  }
  const limits = await guessLimits(storeId, data);
  const match = await matchOrder(storeId, { ...data, customerId: options.customerId });
  if (turnedAway(limits, match?.proof ?? null)) {
    if (!match) await recordGuess(storeId, data);
    return floor(startedAt, options.floorMs, { ok: false, reason: "limited" });
  }
  const orderId = match?.id ?? null;
  const facts = orderId ? await loadFacts(storeId, orderId) : null;
  if (!orderId || !facts || !match) {
    await recordGuess(storeId, data);
    return floor(startedAt, options.floorMs, { ok: true, matched: false });
  }

  const open = await count(sql`
    select count(*)::int as n from commerce.returns
    where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and kind = 'return' and status = 'requested'
  `);
  if (open >= RETURN_REQUEST_LIMITS.openPerOrder) return floor(startedAt, options.floorMs, { ok: false, reason: "limited" });

  const order = viewOf(facts, now, match.proof);
  const problems = declaredProblems(data.lines, order.lines, "return");
  if (problems.length > 0) return floor(startedAt, options.floorMs, { ok: true, matched: true, order, created: null, problems });

  const made = await guarded(() =>
    db().transaction(async (tx) => {
      const [ret] = await tx.execute<Row>(sql`
        insert into commerce.returns (store_id, order_id, kind, status, reason, reason_note, instructions, return_address)
        values (${storeId}::uuid, ${orderId}::uuid, 'return', 'requested', ${data.reason}, ${data.note},
                ${facts.settings.instructions || null},
                ${facts.settings.returnAddress ? JSON.stringify(facts.settings.returnAddress) : null}::jsonb)
        returning id, number, public_token
      `);
      // A return on an archived order starts work again (D173): the order is back in the list.
      await unarchiveForReturn(tx, storeId, orderId);
      for (const line of data.lines) {
        await tx.execute(sql`
          insert into commerce.return_lines (store_id, return_id, order_line_id, quantity, reason)
          values (${storeId}::uuid, ${String(ret.id)}::uuid, ${line.lineId}::uuid, ${line.quantity}, ${line.reason ?? data.reason})
        `);
      }
      await writeEvent(
        tx,
        storeId,
        orderId,
        "return.requested",
        {
          returnId: String(ret.id),
          number: String(ret.number),
          reason: data.reason satisfies ReturnReason | null,
          lines: data.lines.map((l) => ({ lineId: l.lineId, sku: facts.lines.find((x) => x.id === l.lineId)?.sku ?? null, quantity: l.quantity })),
        },
        "shopper",
      );
      return { id: String(ret.id), number: String(ret.number), token: String(ret.public_token) };
    }),
  );
  if ("ok" in made) {
    return floor(startedAt, options.floorMs, {
      ok: true,
      matched: true,
      order,
      created: null,
      problems: data.lines.map((l) => ({ lineId: l.lineId, code: "too_many" as const })),
    });
  }
  return floor(startedAt, options.floorMs, { ok: true, matched: true, order, created: made, problems: [] });
}
