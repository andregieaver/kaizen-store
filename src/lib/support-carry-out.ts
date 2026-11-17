import type { StaffRequestKind } from "./support-actions";

/**
 * Staff act from the conversation (ecosystem plan E2.7, D713), pure: which request the support inbox and the Requests page offer to
 * *carry out* for a person, and why one they might expect is not offered. Carrying out runs the order page's own functions
 * (`src/server/support-carry-out.ts`); this only decides what to offer, so a person never presses a button the function would refuse.
 * A kind no existing function carries out safely (an exception, anything else) keeps Done and Decline only.
 */

/** What *Carry it out* does: cancel the order, change its delivery address, or refund it. */
export type CarryOut = "cancel" | "address" | "refund";

/** The kinds code can carry out, and how. */
export const CARRY_OUT_OF: Readonly<Partial<Record<StaffRequestKind, CarryOut>>> = {
  cancel_order: "cancel",
  change_address: "address",
  refund: "refund",
};

/** Why a request that could be carried out is not, now: each is a sentence in the inbox's words (`requests.carry.why`). */
export type CarryOutWhy =
  | "noOrder"
  | "notVerified"
  | "noAddress"
  | "sent"
  | "held"
  | "notPaid"
  | "cancelled"
  | "nothingToRefund"
  | "paidOutside"
  | "changeWaiting"
  | "notThroughUs";

/** What is known of a request and its order, as the server read it (the order page's own figures). */
export type RequestFacts = {
  kind: StaffRequestKind;
  /** The person asking is the order's own customer: signed in on the chat, or confirmed from the order's address (D685). */
  verified: boolean;
  /** An address change came with a full new address. */
  hasAddress: boolean;
  /** The order the customer named, when it is the store's (never a restricted or anonymised one). */
  order: {
    status: string;
    /** Some of it is sent (a parcel that stands). */
    sent: boolean;
    held: boolean;
    /** A change to it waits for the customer's payment (D174). */
    editPending: boolean;
    /** What is left to refund, as the order page counts it. */
    refundableMinor: number;
    /** Kaizena Flow can refund it (paid through its payments). */
    canRefund: boolean;
    /** Paid outside Kaizena Flow (D173): a refund of it is recorded on the order page by whoever paid the customer back. */
    paidOutside: boolean;
  } | null;
};

/** Who is asking: deciding requests is `support:write`, changing orders `orders:write`. */
export type CarryOutReach = { decide: boolean; changeOrders: boolean };

export type CarryOutOffer = { carryOut: CarryOut | null; why: CarryOutWhy | null };

const NONE: CarryOutOffer = { carryOut: null, why: null };
const refuse = (why: CarryOutWhy): CarryOutOffer => ({ carryOut: null, why });
const offer = (carryOut: CarryOut): CarryOutOffer => ({ carryOut, why: null });

/**
 * What a request offers a person: a carry-out, or why not. Nothing (no reason either) for a kind code does not carry out, or for a person
 * who may not decide requests or change orders: they see Done and Decline, or only the request. The rules are the functions' own, read
 * first: a cancellation is of a paid order with nothing sent (`cancelOrder()`), an address change of a paid order not sent or held, for
 * the order's own customer (`carryOutAddressChangeTool()`), a refund of what is left through Kaizena Flow's payments (`refundOrder()`).
 * Money taken outside Kaizena Flow is refunded on the order page, where it is recorded by whoever paid the customer back.
 */
export function carryOutOffer(facts: RequestFacts, reach: CarryOutReach): CarryOutOffer {
  const carry = CARRY_OUT_OF[facts.kind] ?? null;
  if (!carry || !reach.decide || !reach.changeOrders) return NONE;
  const order = facts.order;
  if (!order) return refuse("noOrder");
  switch (carry) {
    case "cancel":
      if (order.status === "cancelled") return refuse("cancelled");
      if (order.status === "fulfilled" || order.sent) return refuse("sent");
      if (order.status !== "paid") return refuse("notPaid");
      if (order.paidOutside) return refuse("paidOutside");
      if (order.editPending) return refuse("changeWaiting");
      return offer("cancel");
    case "address":
      if (!facts.hasAddress) return refuse("noAddress");
      if (!facts.verified) return refuse("notVerified");
      if (order.held) return refuse("held");
      if (order.status === "fulfilled" || order.sent) return refuse("sent");
      if (order.status === "cancelled") return refuse("cancelled");
      if (order.status !== "paid" && order.status !== "authorized") return refuse("notPaid");
      return offer("address");
    case "refund":
      if (order.paidOutside) return refuse("paidOutside");
      if (!order.canRefund) return refuse("notThroughUs");
      if (order.refundableMinor <= 0) return refuse("nothingToRefund");
      if (order.editPending) return refuse("changeWaiting");
      return offer("refund");
  }
}

/** The request's facts that change what is offered: a new AI request or a decision in the transcript asks the server for the requests again. */
export const changesRequests = (message: { author: string; kind: string | null; tools: readonly string[] }): boolean =>
  (message.author === "ai" && message.tools.includes("request_staff_action")) ||
  (message.author === "system" && (message.kind === "request_done" || message.kind === "request_declined"));
