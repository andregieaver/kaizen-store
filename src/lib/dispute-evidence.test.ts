import { describe, expect, it } from "vitest";

import {
  draftEvidence,
  EVIDENCE_FIELD_MAX,
  EVIDENCE_FIELDS,
  EVIDENCE_TOTAL_MAX,
  evidenceInput,
  fieldMax,
  keyFields,
  returnsOften,
  SHORT_MAX,
  stripeEvidence,
  type EvidenceFacts,
} from "./dispute-evidence";

const facts = (over: Partial<EvidenceFacts> = {}): EvidenceFacts => ({
  reason: "product_not_received",
  orderNumber: "1042",
  placedAt: "2026-10-01T09:30:00.000Z",
  total: "NOK 499.00",
  customerName: "Kari Nordmann",
  email: "kari@example.com",
  billing: "Kari Nordmann, Storgata 1, 0155 Oslo, NO",
  shipping: "Kari Nordmann, Storgata 1, 0155 Oslo, NO",
  lines: [
    { title: "Blue mug", quantity: 2 },
    { title: "Tote", quantity: 1 },
  ],
  parcels: [{ carrier: "Posten", tracking: "70712345", sentAt: "2026-10-02T12:00:00.000Z", deliveredAt: "2026-10-04T10:00:00.000Z" }],
  delivered: { at: "2026-10-04T10:00:00.000Z", by: "carrier" },
  terms: { acceptedAt: "2026-10-01T09:29:00.000Z", mode: "checkbox", titles: ["Terms of sale"] },
  returnDays: 30,
  refunds: [],
  earlierOrders: 2,
  earlierDisputes: 0,
  messages: [{ at: "2026-10-05T08:00:00.000Z", text: "Thanks,  the mugs\\narrived   fine!" }],
  ...over,
});

describe("the evidence drafted from an order (D417)", () => {
  it("fills Stripe's fields from the order's own facts", () => {
    const e = draftEvidence(facts());
    expect(e.customer_name).toBe("Kari Nordmann");
    expect(e.customer_email_address).toBe("kari@example.com");
    expect(e.product_description).toBe("2 × Blue mug; 1 × Tote");
    expect(e.shipping_carrier).toBe("Posten");
    expect(e.shipping_tracking_number).toBe("70712345");
    expect(e.shipping_date).toBe("2026-10-02");
    expect(e.refund_policy_disclosure).toBe(
      "Customers may withdraw from the purchase within 30 days of receiving the goods and return them for a refund, as our terms of sale say; the customer accepted them at checkout. The customer did not ask to withdraw or return.",
    );
    expect(e.uncategorized_text).toContain("Order 1042, placed on 2026-10-01 and paid NOK 499.00: 2 × Blue mug; 1 × Tote.");
    expect(e.uncategorized_text).toContain("The billing and shipping addresses are the same.");
    expect(e.uncategorized_text).toContain("The customer has placed 2 earlier paid orders with us without disputing any.");
    expect(e.uncategorized_text).toContain("At checkout on 2026-10-01 the customer ticked that they accept our Terms of sale.");
    expect(e.uncategorized_text).toContain("Shipped: Posten 70712345, sent 2026-10-02, delivered 2026-10-04.");
    expect(e.uncategorized_text).toContain("The carrier's tracking shows it delivered on 2026-10-04.");
    // The customer's own words, on one line each and dated.
    expect(e.uncategorized_text).toContain("The customer's messages to us:\n[2026-10-05] Thanks, the mugs\\narrived fine!");
  });

  it("never writes why no refund was due: that is the owner's to say", () => {
    expect(draftEvidence(facts()).refund_refusal_explanation).toBe("");
    expect(draftEvidence(facts({ reason: "credit_not_processed" })).refund_refusal_explanation).toBe("");
  });

  it("leaves a field empty when the store holds no fact for it, and says nothing it does not know", () => {
    const e = draftEvidence(facts({ parcels: [], delivered: null, terms: null, earlierOrders: 0, messages: [], billing: "Somewhere else 2", returnDays: 7 }));
    expect(e.shipping_carrier).toBe("");
    expect(e.shipping_tracking_number).toBe("");
    expect(e.shipping_date).toBe("");
    expect(e.uncategorized_text).not.toMatch(/delivered|Shipped|checkout|earlier|messages|addresses are the same/);
    // The EU's 14 days are the least a consumer gets, whatever the store's own window says.
    expect(e.refund_policy_disclosure).toMatch(/^Customers may withdraw from the purchase within 14 days/);
    expect(e.refund_policy_disclosure).not.toContain("accepted them at checkout");
  });

  it("says how it was delivered by what recorded it, and lists refunds made", () => {
    expect(draftEvidence(facts({ delivered: { at: "2026-10-04T10:00:00.000Z", by: "handover" } })).uncategorized_text).toContain("It was handed over to the customer on 2026-10-04.");
    expect(draftEvidence(facts({ delivered: { at: "2026-10-04T10:00:00.000Z", by: "staff" } })).uncategorized_text).toContain("It was marked delivered on 2026-10-04.");
    const refunded = draftEvidence(facts({ refunds: [{ amount: "NOK 100.00", at: "2026-10-06T10:00:00.000Z" }] }));
    expect(refunded.uncategorized_text).toContain("Refunded so far: NOK 100.00 on 2026-10-06.");
    expect(refunded.refund_policy_disclosure).not.toContain("did not ask to withdraw");
    expect(draftEvidence(facts({ earlierOrders: 3, earlierDisputes: 1 })).uncategorized_text).toContain("3 earlier paid orders with us, 1 of them disputed.");
  });

  it("keeps each field inside Stripe's limits", () => {
    const long = "x".repeat(EVIDENCE_FIELD_MAX * 2);
    const e = draftEvidence(facts({ customerName: long, billing: long, messages: Array.from({ length: 20 }, () => ({ at: "2026-10-05T08:00:00.000Z", text: long })) }));
    expect(e.customer_name.length).toBe(SHORT_MAX);
    expect(e.billing_address.length).toBe(EVIDENCE_FIELD_MAX);
    expect(e.uncategorized_text.length).toBeLessThanOrEqual(EVIDENCE_FIELD_MAX);
    expect(evidenceInput.safeParse(e).success).toBe(true);
  });
});

describe("what a bank looks at first", () => {
  it("puts the fields that answer the reason first", () => {
    expect(keyFields("product_not_received")).toEqual(["shipping_carrier", "shipping_tracking_number", "shipping_date", "shipping_address"]);
    expect(keyFields("fraudulent")).toEqual(["customer_name", "billing_address", "shipping_address", "uncategorized_text"]);
    expect(keyFields("credit_not_processed")).toContain("refund_refusal_explanation");
    expect(keyFields(null)).toEqual(["uncategorized_text"]);
    for (const reason of ["product_not_received", "fraudulent", "unrecognized", "product_unacceptable", "credit_not_processed", "general", null]) {
      expect(keyFields(reason).every((f) => (EVIDENCE_FIELDS as readonly string[]).includes(f))).toBe(true);
    }
  });
});

describe("the evidence as it is sent", () => {
  it("sends only the fields with something in them, trimmed", () => {
    const e = { ...draftEvidence(facts()), shipping_date: "  2026-10-02 ", refund_refusal_explanation: "   " };
    const sent = stripeEvidence(e);
    expect(sent.shipping_date).toBe("2026-10-02");
    expect("refund_refusal_explanation" in sent).toBe(false);
  });

  it("refuses a field longer than Stripe takes", () => {
    const base = Object.fromEntries(EVIDENCE_FIELDS.map((f) => [f, ""]));
    expect(evidenceInput.safeParse({ ...base, customer_name: "x".repeat(SHORT_MAX + 1) }).success).toBe(false);
    expect(evidenceInput.safeParse({ ...base, uncategorized_text: "x".repeat(EVIDENCE_FIELD_MAX + 1) }).success).toBe(false);
    // The fields' own limits keep the whole within Stripe's total, so the whole is never what refuses.
    expect(EVIDENCE_FIELDS.reduce((sum, f) => sum + fieldMax(f), 0)).toBeLessThanOrEqual(EVIDENCE_TOTAL_MAX);
  });
});

describe("customers who return a lot", () => {
  it("are those with at least three returned orders that make at least half of their year's orders", () => {
    expect(returnsOften({ orders: 4, returned: 3 })).toBe(true);
    expect(returnsOften({ orders: 6, returned: 3 })).toBe(true);
    expect(returnsOften({ orders: 7, returned: 3 })).toBe(false);
    expect(returnsOften({ orders: 2, returned: 2 })).toBe(false);
    expect(returnsOften({ orders: 0, returned: 0 })).toBe(false);
  });
});
