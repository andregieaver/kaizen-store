import { z } from "zod";

/**
 * The chargeback assistant (D417): the evidence Stripe takes for a dispute, drafted by code from the order's own records so the owner reads
 * it, changes what they need and sends it. Only Stripe's text fields are used (no files): who bought, where it went, what was bought, how it
 * was delivered, the terms accepted at checkout, what was refunded, and the customer's own messages, each written from a fact the store
 * holds, never guessed. A field with no fact behind it is left empty for the owner to fill or leave. Pure: the facts are read in
 * `src/server/dispute-evidence.ts`.
 */

/** Stripe's evidence fields this assistant fills, in the order the page shows them. */
export const EVIDENCE_FIELDS = [
  "customer_name",
  "customer_email_address",
  "billing_address",
  "shipping_address",
  "product_description",
  "shipping_carrier",
  "shipping_tracking_number",
  "shipping_date",
  "refund_policy_disclosure",
  "refund_refusal_explanation",
  "uncategorized_text",
] as const;
export type EvidenceField = (typeof EVIDENCE_FIELDS)[number];
export type Evidence = Record<EvidenceField, string>;

/** Stripe's limit for one text field, and for all of them together. */
export const EVIDENCE_FIELD_MAX = 20_000;
export const EVIDENCE_TOTAL_MAX = 150_000;
/** The short fields: a name, an address, a carrier, a number, a date. */
export const SHORT_FIELDS: ReadonlySet<EvidenceField> = new Set(["customer_name", "customer_email_address", "shipping_carrier", "shipping_tracking_number", "shipping_date"]);
export const SHORT_MAX = 500;
/** How long a field may be: a short one or a long one. */
export const fieldMax = (field: EvidenceField): number => (SHORT_FIELDS.has(field) ? SHORT_MAX : EVIDENCE_FIELD_MAX);

/** At most this many of the customer's own messages go into the evidence, the latest. */
export const EVIDENCE_MESSAGES_MAX = 20;

export const evidenceInput = z
  .object(Object.fromEntries(EVIDENCE_FIELDS.map((f) => [f, z.string().max(fieldMax(f), "This field is longer than Stripe takes.")])) as Record<EvidenceField, z.ZodString>)
  .superRefine((value, ctx) => {
    const total = EVIDENCE_FIELDS.reduce((sum, f) => sum + value[f].length, 0);
    if (total > EVIDENCE_TOTAL_MAX) ctx.addIssue({ code: "custom", message: "The evidence is longer than Stripe takes in all. Shorten the longest field." });
  });

export type EvidenceFacts = {
  /** Stripe's reason for the dispute (`fraudulent`, `product_not_received`, `product_unacceptable`, …), or null. */
  reason: string | null;
  orderNumber: string;
  placedAt: string;
  /** The order's total as it was paid, already written as money. */
  total: string;
  customerName: string;
  email: string;
  billing: string;
  shipping: string;
  /** The order's goods: "2 × Blue mug". */
  lines: readonly { title: string; quantity: number }[];
  /** Parcels sent (not undone): the carrier's name, its tracking number, when it left, and when it arrived when known. */
  parcels: readonly { carrier: string; tracking: string; sentAt: string; deliveredAt: string | null }[];
  /** When the order was marked delivered, and by what: the carrier's tracking, staff, or a handover. */
  delivered: { at: string; by: "carrier" | "staff" | "handover" } | null;
  /** The record of the terms the customer accepted at checkout (D158). */
  terms: { acceptedAt: string; mode: "checkbox" | "link"; titles: readonly string[] } | null;
  /** The store's return window in days (14 is the EU's withdrawal period). */
  returnDays: number;
  refunds: readonly { amount: string; at: string }[];
  /** Paid orders the same customer placed here before this one, and how many of them were disputed. */
  earlierOrders: number;
  earlierDisputes: number;
  /** The customer's own messages to the store (support), oldest first, already cut to `EVIDENCE_MESSAGES_MAX`. */
  messages: readonly { at: string; text: string }[];
};

const day = (iso: string) => iso.slice(0, 10);
const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The evidence as drafted from the facts; the owner reads and changes it before it is sent. English: Stripe passes it to banks. */
export function draftEvidence(f: EvidenceFacts): Evidence {
  const lastParcel = f.parcels[f.parcels.length - 1];
  const goods = f.lines.map((l) => `${l.quantity} × ${l.title}`).join("; ");
  const delivery =
    f.delivered?.by === "carrier"
      ? `The carrier's tracking shows it delivered on ${day(f.delivered.at)}.`
      : f.delivered?.by === "handover"
        ? `It was handed over to the customer on ${day(f.delivered.at)}.`
        : f.delivered
          ? `It was marked delivered on ${day(f.delivered.at)}.`
          : "";
  const parcels = f.parcels.map((p) => `${p.carrier || "Parcel"} ${p.tracking}, sent ${day(p.sentAt)}${p.deliveredAt ? `, delivered ${day(p.deliveredAt)}` : ""}`);
  const summary = [
    `Order ${f.orderNumber}, placed on ${day(f.placedAt)} and paid ${f.total}: ${goods || "see the order"}.`,
    f.billing && f.shipping && f.billing === f.shipping ? "The billing and shipping addresses are the same." : "",
    f.earlierOrders > 0
      ? `The customer has placed ${f.earlierOrders} earlier paid order${f.earlierOrders === 1 ? "" : "s"} with us${f.earlierDisputes === 0 ? " without disputing any" : `, ${f.earlierDisputes} of them disputed`}.`
      : "",
    f.terms
      ? `At checkout on ${day(f.terms.acceptedAt)} the customer ${f.terms.mode === "checkbox" ? "ticked that they accept" : "was shown and accepted by ordering"} our ${f.terms.titles.join(", ") || "terms of sale"}.`
      : "",
    parcels.length > 0 ? `Shipped: ${parcels.join("; ")}.` : "",
    delivery,
    f.refunds.length > 0 ? `Refunded so far: ${f.refunds.map((r) => `${r.amount} on ${day(r.at)}`).join("; ")}.` : "No refund has been asked for or made on this order.",
    f.messages.length > 0 ? ["The customer's messages to us:", ...f.messages.map((m) => `[${day(m.at)}] ${cut(m.text.replace(/\s+/g, " ").trim(), 1_000)}`)].join("\n") : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    customer_name: cut(f.customerName, SHORT_MAX),
    customer_email_address: cut(f.email, SHORT_MAX),
    billing_address: cut(f.billing, EVIDENCE_FIELD_MAX),
    shipping_address: cut(f.shipping, EVIDENCE_FIELD_MAX),
    product_description: cut(goods, EVIDENCE_FIELD_MAX),
    shipping_carrier: cut(lastParcel?.carrier ?? "", SHORT_MAX),
    shipping_tracking_number: cut(f.parcels.map((p) => p.tracking).filter(Boolean).join(", "), SHORT_MAX),
    shipping_date: lastParcel ? day(f.parcels[0].sentAt) : "",
    refund_policy_disclosure: cut(
      `Customers may withdraw from the purchase within ${Math.max(14, f.returnDays)} days of receiving the goods and return them for a refund, as our terms of sale say${f.terms ? "; the customer accepted them at checkout" : ""}.${f.refunds.length === 0 ? " The customer did not ask to withdraw or return." : ""}`,
      EVIDENCE_FIELD_MAX,
    ),
    // Why no refund was due is the owner's to say: never guessed.
    refund_refusal_explanation: "",
    uncategorized_text: cut(summary, EVIDENCE_FIELD_MAX),
  };
}

/** Which fields matter most for a reason, to show first: what a bank looks for in such a dispute. */
export function keyFields(reason: string | null): EvidenceField[] {
  switch (reason) {
    case "product_not_received":
      return ["shipping_carrier", "shipping_tracking_number", "shipping_date", "shipping_address"];
    case "fraudulent":
    case "unrecognized":
      return ["customer_name", "billing_address", "shipping_address", "uncategorized_text"];
    case "product_unacceptable":
      return ["product_description", "refund_policy_disclosure", "uncategorized_text"];
    case "credit_not_processed":
      return ["refund_policy_disclosure", "refund_refusal_explanation", "uncategorized_text"];
    default:
      return ["uncategorized_text"];
  }
}

/** The evidence as Stripe takes it: the fields with something in them, trimmed. */
export function stripeEvidence(evidence: Evidence): Partial<Evidence> {
  return Object.fromEntries(EVIDENCE_FIELDS.map((f) => [f, evidence[f].trim()]).filter(([, v]) => v !== "")) as Partial<Evidence>;
}

// ---------------------------------------------------------------------------
// Customers who return a lot
// ---------------------------------------------------------------------------

/** A customer who returns often (D417): at least this many orders with a return or a refund in the last year, and at least this share of their orders. */
export const RETURNER_MIN_RETURNED = 3;
export const RETURNER_MIN_SHARE = 0.5;

/** Whether a customer's last year of orders makes them one who returns often. */
export function returnsOften(history: { orders: number; returned: number }): boolean {
  return history.returned >= RETURNER_MIN_RETURNED && history.orders > 0 && history.returned / history.orders >= RETURNER_MIN_SHARE;
}
