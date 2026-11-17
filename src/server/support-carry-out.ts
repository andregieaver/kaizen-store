import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, type AdminLang } from "@/lib/admin-lang";
import { SUPPORT_WORDS } from "@/lib/admin-words/support";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { parsePrice } from "@/lib/product-input";
import { isStaffRequest, type RequestAddress, type StaffRequestKind } from "@/lib/support-actions";
import { CARRY_OUT_OF, carryOutOffer, type CarryOut, type CarryOutReach, type CarryOutWhy, type RequestFacts } from "@/lib/support-carry-out";

import { audit, holderOf, type Membership } from "./auth";
import { log } from "./log";
import { cancelOrder, getOrderAdmin, liveShipments, refundOrder, type OrderAdmin } from "./order-admin";
import { OwnerToolError } from "./owner-tool-error";
import { memberCan } from "./permissions";
import { sendCancelled, sendRefunded } from "./shopper-emails";
import { decideRequest } from "./support-actions";
import { memberDesk, type StaffDesk } from "./support-desk";
import { sendRequestDecisionEmail } from "./support-email";
import { carryOutAddressChangeTool, closeCancelRequests, requestFacts, requestedAddress, type StaffRequestFacts } from "./support-requests";
import { col, typedRows } from "./typed-rows";

/**
 * Staff act from the conversation (ecosystem plan E2.7, D713): a request the chat assistant passed to a person (`request_staff_action`) is
 * carried out where it is read, in the inbox or on the Requests page, instead of on the order page. Nothing here is new money logic: each
 * kind runs the function the order page or the AI manager's tool runs, with its own checks, history, audit and customer email:
 *
 * - a cancellation: `cancelOrder()` (it refunds what is left and puts the stock back), then `sendCancelled()`, as the order page's Cancel;
 * - an address change: `carryOutAddressChangeTool()`, the AI manager's own (`updateOrderContact()`), only for the order's own customer;
 * - a refund: `refundOrder()` of what is left, or of a part staff type, to the payment or as store credit, then `sendRefunded()`.
 *
 * Then the request is decided done through `decideRequest()`, so the customer reads the standard line in the conversation (and an email
 * when away). A failure leaves the request open and says why in plain words. An exception or anything else keeps Done and Decline only
 * (`carryOutOffer()`). It needs `support:write` to decide and `orders:write` to change orders, as the order page's own actions do.
 */

export type RequestChoice = {
  /** The person asking is the order's own customer (signed in, or confirmed from the order's address). */
  verified: boolean;
  carryOut: CarryOut | null;
  why: CarryOutWhy | null;
  /** What a refund or a cancellation gives back now, as the order page counts it (staff may refund part of a refund's). */
  money: { minor: number; currency: string } | null;
  /** The new address an address change asks for. */
  address: RequestAddress | null;
};

/** An open request of a conversation, as the inbox shows it above the reply box. */
export type ConversationRequest = {
  id: string;
  kind: StaffRequestKind;
  summary: string;
  details: string | null;
  orderNumber: string | null;
  /** The order's page is `/admin/{store}/orders/{id}`; null when the number is not one of the store's orders. */
  orderId: string | null;
  createdAt: string;
  choice: RequestChoice | null;
};

const NO_CHOICE: RequestChoice = { verified: false, carryOut: null, why: null, money: null, address: null };

/** The facts the offer reads: the request's own, and the order page's figures for a cancellation or a refund. */
function factsOf(r: StaffRequestFacts, admin: OrderAdmin | null): RequestFacts | null {
  if (!isStaffRequest(r.kind)) return null;
  const needsAdmin = r.kind === "refund" || r.kind === "cancel_order";
  const found = r.order_id !== null && (!needsAdmin || admin !== null);
  return {
    kind: r.kind,
    verified: r.verified,
    hasAddress: requestedAddress(r.args) !== null,
    order: found
      ? {
          status: admin?.status ?? r.order_status ?? "",
          sent: r.sent || (admin ? liveShipments(admin.shipments).length > 0 : false),
          held: r.held,
          editPending: admin?.fulfilment.editPending ?? false,
          refundableMinor: admin?.refundableMinor ?? 0,
          canRefund: admin?.canRefund ?? false,
          paidOutside: Boolean(admin?.paidOutside),
        }
      : null,
  };
}

/** The order page's own view of a request's order, only where an offer needs its money: a cancellation or a refund. */
const adminFor = (storeId: string, r: StaffRequestFacts): Promise<OrderAdmin | null> =>
  r.order_id && (r.kind === "refund" || r.kind === "cancel_order") ? getOrderAdmin(storeId, r.order_id) : Promise.resolve(null);

function choiceOf(r: StaffRequestFacts, admin: OrderAdmin | null, reach: CarryOutReach): RequestChoice {
  const facts = factsOf(r, admin);
  if (!facts) return NO_CHOICE;
  const offer = carryOutOffer(facts, reach);
  const money = admin && (offer.carryOut === "refund" || offer.carryOut === "cancel") ? { minor: admin.refundableMinor, currency: admin.currency } : null;
  return {
    verified: r.verified,
    carryOut: offer.carryOut,
    why: offer.why,
    money,
    // The address is for those who may carry it out: what the customer asked is in the request's summary and details for everyone.
    address: offer.carryOut === "address" ? requestedAddress(r.args) : null,
  };
}

/**
 * What each request offers a person: a carry-out, or why not. The order is read (the order page's `getOrderAdmin()`) only for a cancellation
 * or a refund, and only for a person who may carry it out; a few at a time.
 */
export async function requestChoices(storeId: string, ids: readonly string[], reach: CarryOutReach): Promise<Map<string, RequestChoice>> {
  return choicesOf(storeId, await requestFacts(storeId, ids), reach);
}

async function choicesOf(storeId: string, facts: readonly StaffRequestFacts[], reach: CarryOutReach): Promise<Map<string, RequestChoice>> {
  const choices = new Map<string, RequestChoice>();
  const reads = reach.decide && reach.changeOrders;
  for (let i = 0; i < facts.length; i += 5) {
    const batch = facts.slice(i, i + 5);
    const admins = await Promise.all(batch.map((r) => (reads ? adminFor(storeId, r) : Promise.resolve(null))));
    batch.forEach((r, j) => choices.set(r.id, choiceOf(r, admins[j], reach)));
  }
  return choices;
}

/** What a member may do with requests. */
export const memberReach = (member: Membership): CarryOutReach => ({ decide: memberDesk(member).canWrite, changeOrders: memberCan(member, "orders:write") });

/** The same for a desk the inbox opened (its holder's role; the action checks the member again). */
const deskReach = (staff: StaffDesk): CarryOutReach => ({ decide: staff.canWrite, changeOrders: Boolean(staff.holder && can(staff.holder, "orders:write")) });

const OPEN = z.object({
  id: col.uuid,
  kind: col.text,
  summary: col.text,
  details: col.textOrNull,
  order_number: col.textOrNull,
  created_at: col.timestamp,
});

/** The most open requests a conversation lists. */
const CONVERSATION_REQUESTS = 20;

/** A conversation's open requests to staff, oldest first, each with what it offers the person looking. Staff only; a store's desk only. */
export async function conversationRequests(staff: StaffDesk, conversationId: string): Promise<ConversationRequest[]> {
  const storeId = staff.desk.storeId;
  if (!storeId) return [];
  const rows = await typedRows(
    OPEN,
    sql`
      select a.id, a.kind, a.summary, a.details, a.args ->> 'orderNumber' as order_number, a.created_at
      from commerce.support_actions a
      where a.store_id = ${storeId}::uuid and a.conversation_id = ${conversationId}::uuid and a.confirmer = 'staff' and a.status = 'proposed'
      order by a.created_at, a.id
      limit ${CONVERSATION_REQUESTS}
    `,
  );
  const open = rows.filter((r) => isStaffRequest(r.kind));
  if (open.length === 0) return [];
  const facts = await requestFacts(storeId, open.map((r) => r.id));
  const choices = await choicesOf(storeId, facts, deskReach(staff));
  const orderOf = new Map(facts.map((f) => [f.id, f.order_id]));
  return open.map((r) => ({
    id: r.id,
    kind: r.kind as StaffRequestKind,
    summary: r.summary,
    details: r.details,
    orderNumber: r.order_number,
    orderId: orderOf.get(r.id) ?? null,
    createdAt: r.created_at,
    choice: choices.get(r.id) ?? null,
  }));
}

// Carrying out ---------------------------------------------------------------------------------------------------------------------------

/**
 * What the form sends: for a refund, a part typed in the order's currency (`amount`), else the whole; and for the whole of a refund or a
 * cancellation, the amount the person was shown (`expectMinor`), so what goes back is what the confirmation said, never a figure that moved.
 */
export type CarryOutInput = {
  /** A part of a refund, as typed in the order's currency; null for the whole. */
  amount: string | null;
  expectMinor: number | null;
  toCredit: boolean;
};

export type CarryOutResult = { ok: true; message: string; conversationId: string } | { ok: false; problem: string };

/** How long a press holds a request while its function runs, so two presses (two people) never run it twice. */
const CLAIM_SECONDS = 120;

async function claim(storeId: string, id: string): Promise<boolean> {
  const rows = await typedRows(
    z.object({ id: col.uuid }),
    sql`
      update commerce.support_actions set result = coalesce(result, '{}'::jsonb) || jsonb_build_object('carryingOut', now())
      where store_id = ${storeId}::uuid and id = ${id}::uuid and confirmer = 'staff' and status = 'proposed'
        and (result ->> 'carryingOut' is null or (result ->> 'carryingOut')::timestamptz < now() - make_interval(secs => ${CLAIM_SECONDS}))
      returning id
    `,
  );
  return rows.length > 0;
}

/** A request whose carry-out did not happen is open as before (a decided one is left as it was decided). */
async function release(storeId: string, id: string): Promise<void> {
  await typedRows(
    z.object({ id: col.uuid }),
    sql`
      update commerce.support_actions set result = result - 'carryingOut'
      where store_id = ${storeId}::uuid and id = ${id}::uuid and confirmer = 'staff' and status = 'proposed'
      returning id
    `,
  );
}

/**
 * Carries a request out with the function the order page (or the AI manager's tool) runs, then marks it done with the standard line for the
 * customer. Refused in plain words, the request left open, when the person may not, the request is decided or not the store's, the offer's
 * rules say no now, or the function itself refuses.
 */
export async function carryOutRequest(member: Membership, requestId: string, input: CarryOutInput, lang: AdminLang): Promise<CarryOutResult> {
  const w = SUPPORT_WORDS[lang].requests.carry;
  const no = (problem: string): CarryOutResult => ({ ok: false, problem });
  const staff = memberDesk(member);
  if (!staff.canWrite) return no(w.problems.noDecide);
  if (!memberCan(member, "orders:write")) return no(w.problems.noOrders);
  const storeId = member.store.id;
  const [facts] = await requestFacts(storeId, [requestId]);
  if (!facts) return no(w.problems.gone);
  if (facts.status !== "proposed") return no(w.problems.decided);
  const carry = isStaffRequest(facts.kind) ? (CARRY_OUT_OF[facts.kind] ?? null) : null;
  if (!carry) return no(w.problems.notCarried);
  const admin = await adminFor(storeId, facts);
  const choice = choiceOf(facts, admin, { decide: true, changeOrders: true });
  if (!choice.carryOut) return no(choice.why ? w.why[choice.why] : w.problems.notCarried);
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const money = (minor: number) => formatMoney(minor, admin?.currency ?? "EUR", locale);
  const number = facts.order_number ?? "";

  // What goes back is settled before anything is held or moved: the whole as shown, or a part within what is left.
  let amountMinor = 0;
  if (carry === "refund" || carry === "cancel") {
    if (!admin) return no(w.why.noOrder);
    // A part is a refund's only (null is the whole); one left empty is refused, never taken for the whole.
    const typed = carry === "refund" && input.amount !== null ? input.amount.trim() : null;
    if (typed !== null) {
      const parsed = parsePrice(typed, admin.currency);
      if (parsed === null || parsed <= 0) return no(fillWords(w.problems.notAmount, { typed: typed || "\"\"", currency: admin.currency }));
      if (parsed > admin.refundableMinor) return no(fillWords(w.problems.tooMuch, { amount: money(admin.refundableMinor) }));
      amountMinor = parsed;
    } else {
      if (input.expectMinor !== admin.refundableMinor) return no(w.problems.changed);
      amountMinor = admin.refundableMinor;
    }
  }

  const orderId = facts.order_id!;
  const conversationId = facts.conversation_id;

  /**
   * The request decided done, with the standard line (and an email when the customer is away); done all the same if someone decided it
   * meanwhile. After money moved nothing here throws: the person is told it is done, and to mark the request done if that step failed.
   */
  const decide = async (message: string): Promise<CarryOutResult> => {
    try {
      const decided = await decideRequest(staff, requestId, "done", null);
      if (!decided.ok) return { ok: true, message: `${message} ${w.decidedMeanwhile}`, conversationId };
      await sendRequestDecisionEmail(decided.conversationId, requestId).catch((error: unknown) => log("warn", "support.request_email_failed", { request: requestId }, error));
      return { ok: true, message, conversationId: decided.conversationId };
    } catch (error) {
      log("error", "support.carry_out_decide_failed", { request: requestId }, error);
      return { ok: true, message: `${message} ${w.notMarked}`, conversationId };
    }
  };
  const emailFailed = (error: unknown) => log("warn", "support.carry_out_email_failed", { request: requestId }, error);

  const run = async (kind: CarryOut): Promise<CarryOutResult> => {
    switch (kind) {
      case "cancel": {
        // The order page's Cancel (`cancelOrderAction`): its own reason, then the customer's cancellation email.
        const outcome = await cancelOrder(storeId, orderId, "Cancelled by the store", member.account.id);
        if (!outcome.ok) return no(outcome.problem);
        await sendCancelled(storeId, orderId, outcome.amountMinor, { unpaid: outcome.unpaid }).catch(emailFailed);
        const said = outcome.amountMinor > 0 ? fillWords(w.cancelled, { number, amount: money(outcome.amountMinor) }) : fillWords(w.cancelledFree, { number });
        const decided = await decide(said);
        // Any other open cancellation of the same order is done too, as the AI manager's cancel_order closes them.
        await closeCancelRequests(member.account, member.store, number, holderOf(member));
        return decided;
      }
      case "address": {
        // The AI manager's own tool: it checks the request again, changes the address and decides the request (the customer told).
        try {
          await carryOutAddressChangeTool({ account: member.account, store: member.store, holder: holderOf(member) }, { request: requestId });
        } catch (error) {
          if (error instanceof OwnerToolError) return no(error.message);
          throw error;
        }
        return { ok: true, message: fillWords(w.addressChanged, { number }), conversationId };
      }
      case "refund": {
        // The order page's Refund (`refundOrderAction`): money only (stock goes back on the order page when items come back), its own reason.
        const outcome = await refundOrder(storeId, orderId, { amountMinor, reason: "Refund", restock: [], toCredit: input.toCredit }, member.account.id);
        if (!outcome.ok) return no(outcome.problem);
        if (outcome.credit) {
          const credited = fillWords(outcome.credit.emailed === "sent" ? w.credited : w.creditNotEmailed, {
            amount: money(outcome.credit.amountMinor),
            number,
            code: outcome.credit.code,
          });
          return decide(credited);
        }
        await sendRefunded(storeId, orderId, outcome.refundId, outcome.amountMinor).catch(emailFailed);
        return decide(fillWords(w.refunded, { amount: money(outcome.amountMinor), number }));
      }
    }
  };

  if (!(await claim(storeId, requestId))) return no(w.problems.busy);
  let done: CarryOutResult;
  try {
    done = await run(carry);
  } catch (error) {
    await release(storeId, requestId).catch(() => undefined);
    throw error;
  }
  if (!done.ok) {
    await release(storeId, requestId).catch((error: unknown) => log("warn", "support.carry_out_release_failed", { request: requestId }, error));
    return done;
  }
  // Beside the functions' own history (the order's events, the refund, the decision's `support.request_decided`): where it was done from.
  await audit(member.account.id, storeId, "support.request_carried_out", { kind: carry, ...(carry === "refund" ? { amount_minor: amountMinor, credit: input.toCredit } : {}) }, {
    area: "support",
    target: { type: "order", id: orderId },
  }).catch((error: unknown) => log("warn", "support.carry_out_audit_failed", { request: requestId }, error));
  return done;
}
