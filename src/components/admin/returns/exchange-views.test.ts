import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { exchangeOutcome } from "@/lib/exchange";
import type { ExchangePreview, ExchangeView } from "@/server/exchanges";
import type { LabelOptions } from "@/server/return-labels";

import { ReturnDetailView } from "./detail-view";
import { ExchangeCard, type ExchangeStepActions } from "./exchange-card";
import { ExchangeSettingsForm } from "./exchange-settings-form";
import { ExchangeSummary } from "./exchange-summary";
import { LabelCard } from "./label-card";
import { ReturnsQueueView } from "./queue-view";
import { actions, detail, plain, row } from "./test-fixtures";

const BAD = /\bNaN\b|Infinity|undefined|\[object|\bnull\b/;
const none = async () => ({ status: "idle" as const, messages: [] });
const steps: ExchangeStepActions = { resend: none, withdraw: none, agreement: none, process: none, paidOutside: none, cancel: none };
const builderActions = {
  preview: async () => ({ ok: false as const, message: "x", problems: [] }),
  save: async () => ({ ok: true, message: "ok" }),
  propose: async () => ({ ok: true, message: "ok" }),
  searchVariants: async () => [],
};

const exchange = (over: Partial<ExchangeView> = {}): ExchangeView => {
  const credit = over.creditMinor ?? 35_000;
  const total = over.totalMinor ?? 49_900;
  return {
    id: "55555555-5555-4555-8555-555555555555",
    seq: 1,
    status: "proposed",
    returnId: "22222222-2222-4222-8222-222222222222",
    returnNumber: "1001-R1",
    returnKind: "withdrawal",
    orderId: "33333333-3333-4333-8333-333333333333",
    orderNumber: "1001",
    currency: "NOK",
    marketSlug: "no",
    shippingKind: "free",
    shippingMinor: 0,
    deliveryAddress: { name: "Kari Nordmann", street: "Storgata 1", postalCode: "0155", city: "Oslo", country: "NO" },
    creditMinor: credit,
    totalMinor: total,
    differenceMinor: total - credit,
    creditAtProcessingMinor: null,
    differenceAtProcessingMinor: null,
    outcome: exchangeOutcome(credit, total),
    expiresAt: "2026-10-12T21:59:00.000Z",
    confirmedAt: null,
    confirmedBy: null,
    confirmedChannel: null,
    exchangeOrderId: null,
    exchangeOrderNumber: null,
    exchangeOrderStatus: null,
    remainderRefundId: null,
    madeBy: "66666666-6666-4666-8666-666666666666",
    createdAt: "2026-10-05T10:00:00.000Z",
    processedAt: null,
    settledAt: null,
    endedAt: null,
    lines: [{ n: 1, variantId: "77777777-7777-4777-8777-777777777777", sku: "MUG-BLUE", title: "Blue mug", quantity: 1, listPriceMinor: 49_900, unitPriceMinor: 49_900, totalMinor: 49_900 }],
    terms: null,
    ...over,
  };
};

const preview = (over: Partial<ExchangePreview> = {}): ExchangePreview => ({
  ok: true,
  block: null,
  problems: [],
  currency: "NOK",
  marketSlug: "no",
  credit: { amountMinor: 35_000, working: [{ key: "goods", amountMinor: 30_000 }, { key: "shipping", amountMinor: 5_000 }], final: false, returnShippingMinor: 0 },
  lines: [
    {
      variantId: "77777777-7777-4777-8777-777777777777",
      title: "Blue mug",
      sku: "MUG-BLUE",
      quantity: 2,
      listPriceMinor: 15_000,
      unitPriceMinor: 12_000,
      totalMinor: 24_000,
      taxMinor: 4_800,
      rate: 0.25,
      measure: null,
      stock: { state: "backorder", inStock: 0, backorderDays: 7 },
    },
  ],
  subtotalMinor: 24_000,
  shippingMinor: 0,
  taxMinor: 4_800,
  totalMinor: 24_000,
  vatPerRate: [{ rate: 0.25, taxMinor: 4_800 }],
  outcome: exchangeOutcome(35_000, 24_000),
  ...over,
});

const card = (props: Partial<Parameters<typeof ExchangeCard>[0]> = {}) => {
  const html = renderToString(
    h(ExchangeCard, {
      base: "/admin/s",
      detail: detail(),
      exchange: null,
      block: null,
      canWrite: true,
      mayRecordOutside: true,
      builder: null,
      builderActions,
      stepActions: steps,
      timeZone: "Europe/Oslo",
      today: "2026-10-05",
      ...props,
    }),
  );
  const text = plain(html);
  expect(text).not.toMatch(BAD);
  return { html, text };
};

describe("the exchange card", () => {
  it("shows the customer's wish first, with their words", () => {
    const { text } = card({ detail: detail({ exchangeWish: { at: "2026-10-05T10:00:00.000Z", note: "Size M instead" } }) });
    expect(text).toContain("Customer asked for an exchange");
    expect(text).toContain("Size M instead");
  });

  it("says why a return cannot be exchanged, in words", () => {
    expect(card({ block: "vat_kind" }).text).toContain("reverse charge or IOSS");
    expect(card({ block: "off" }).text).toContain("Exchanges are off in the return settings.");
  });

  it("draws nothing for an ended or refunded return that never had an exchange or a wish", () => {
    expect(card({ block: "refunded" }).html).toBe("");
    expect(card({ block: "ended" }).html).toBe("");
  });

  it("offers the builder with the credit when the return can be exchanged", () => {
    const { text } = card({
      detail: detail({ kind: "return" }),
      builder: {
        initial: { lines: [], shipping: "free", shippingPrice: "", address: { name: "Kari", street: "Storgata 1", postalCode: "0155", city: "Oslo", country: "NO", phone: "" } },
        initialPreview: preview({ lines: [], outcome: null, problems: [{ code: "no_lines" }] }),
        hasEmail: true,
      },
    });
    expect(text).toContain("Propose an exchange");
    expect(text).toContain("Add a product");
    expect(text).toContain("Send to the customer");
    expect(text).toContain("Create a link to share");
    expect(text).toContain("Save as draft");
    expect(text).toContain("The customer's credit");
    expect(text).toMatch(/350.00/);
    // The empty builder's own "no lines" is not shown as a problem.
    expect(text).not.toContain("Add at least one replacement.•");
  });

  it("shows a proposal that is out, with its outcome, and the steps it can take", () => {
    const { text } = card({ exchange: exchange() });
    expect(text).toContain("Proposal 1");
    expect(text).toContain("Proposed");
    expect(text).toContain("Blue mug");
    expect(text).toContain("Payment to collect");
    expect(text).toMatch(/149.00/);
    expect(text).toContain("Send again");
    expect(text).toContain("Withdraw the proposal");
    // A withdrawal is only exchanged on the customer's own confirmation: no staff-recorded agreement.
    expect(text).not.toContain("Record the customer's agreement");
    // No second builder while a proposal is out.
    expect(text).not.toContain("Propose another exchange");
    // A withdrawal's proposal goes by email only, never as a link staff could press themselves (review finding).
    expect(text).not.toContain("Create a new link to share");
  });

  it("offers no link to share for a withdrawal's proposal, only the email (review finding)", () => {
    const { text } = card({
      builder: {
        initial: { lines: [], shipping: "free", shippingPrice: "", address: { name: "Kari", street: "Storgata 1", postalCode: "0155", city: "Oslo", country: "NO", phone: "" } },
        initialPreview: preview({ lines: [], outcome: null, problems: [{ code: "no_lines" }] }),
        hasEmail: true,
      },
    });
    expect(text).toContain("Send to the customer");
    expect(text).not.toContain("Create a link to share");
    expect(text).toContain("goes by email to the order");
    const voluntary = card({ detail: detail({ kind: "return" }), exchange: exchange({ returnKind: "return" }) }).text;
    expect(voluntary).toContain("Create a new link to share");
  });

  it("offers recording the agreement for a voluntary return", () => {
    const { text } = card({ detail: detail({ kind: "return" }), exchange: exchange({ returnKind: "return" }) });
    expect(text).toContain("Record the customer's agreement");
    expect(text).toContain("By phone");
  });

  it("offers processing a confirmed exchange where the refund would be", () => {
    const { text } = card({ detail: detail({ actions: ["process_exchange", "cancel_exchange", "close"] }), exchange: exchange({ status: "confirmed", confirmedBy: "customer" }) });
    expect(text).toContain("Process the exchange");
    expect(text).toContain("Cancel the exchange and refund instead");
    expect(text).toContain("The customer confirmed it");
  });

  it("says to wait for the goods when processing is not offered yet", () => {
    const { text } = card({ detail: detail({ actions: ["close"] }), exchange: exchange({ status: "confirmed" }) });
    expect(text).not.toContain("Process the exchange");
    expect(text).toContain("mark them first");
  });

  it("offers the pay link again and money taken outside for a processed exchange with a difference", () => {
    const x = exchange({ status: "processed", exchangeOrderId: "88888888-8888-4888-8888-888888888888", exchangeOrderNumber: "1042", creditAtProcessingMinor: 35_000 });
    const { html, text } = card({ detail: detail({ actions: ["cancel_exchange"] }), exchange: x });
    expect(text).toContain("Waiting for payment");
    expect(text).toContain("Order 1042 is made");
    expect(html).toContain('href="/admin/s/orders/88888888-8888-4888-8888-888888888888"');
    expect(text).toContain("Record as paid outside Kaizen");
    expect(text).toContain("Cancel the exchange and refund instead");
    expect(card({ detail: detail({ actions: ["cancel_exchange"] }), exchange: x, mayRecordOutside: false }).text).toContain("Only the owner can record a payment");
  });

  it("offers Try again for a processed exchange whose refund did not go through", () => {
    const x = exchange({ status: "processed", totalMinor: 20_000, creditMinor: 35_000, exchangeOrderId: "88888888-8888-4888-8888-888888888888", exchangeOrderNumber: "1042" });
    expect(card({ exchange: x }).text).toContain("Try again");
  });

  it("shows a settled exchange with its order, and nothing to press", () => {
    const x = exchange({ status: "settled", totalMinor: 35_000, exchangeOrderId: "88888888-8888-4888-8888-888888888888", exchangeOrderNumber: "1042" });
    const { text } = card({ exchange: x, block: "refunded" });
    expect(text).toContain("Exchanged: order 1042.");
    expect(text).toContain("Even exchange");
    expect(text).not.toContain("Send again");
    expect(text).not.toContain("Withdraw the proposal");
  });

  it("offers staff without orders:write nothing to press", () => {
    const { text } = card({ exchange: exchange(), canWrite: false });
    expect(text).toContain("Proposal 1");
    expect(text).not.toContain("Send again");
  });
});

describe("the exchange summary", () => {
  it("shows the server's working, prices, stock, VAT and the outcome in the order's currency", () => {
    const text = plain(renderToString(h(ExchangeSummary, { preview: preview() })));
    expect(text).not.toMatch(BAD);
    expect(text).toContain("What the customer paid for the returned goods");
    expect(text).toContain("The credit can still change");
    expect(text).toContain("2 × Blue mug");
    expect(text).toContain("Would be backordered (about 7 days)");
    expect(text).toContain("lowered from");
    expect(text).toContain("VAT 25 % included");
    expect(text).toMatch(/Refund due to the customer: .*110\.00/);
    expect(text).toContain("credit note for the returned items");
  });

  it("writes a euro view's amounts in euro", () => {
    const text = plain(renderToString(h(ExchangeSummary, { preview: preview({ currency: "EUR" }) })));
    expect(text).toContain("€");
    expect(text).not.toContain("kr");
  });

  it("lists the problems and why the return cannot be exchanged", () => {
    const text = plain(renderToString(h(ExchangeSummary, { preview: preview({ ok: false, block: "test_mode", problems: [{ code: "price_up" }] }) })));
    expect(text).toContain("Stripe's test mode");
    expect(text).toContain("never raised above its price");
  });
});

const labelOptions = (over: Partial<LabelOptions> = {}): LabelOptions => ({ block: null, carrier: { id: "bring", name: "Posten / Bring" }, service: "9300", weightGrams: 1200, payer: "shopper", ...over });
const labelCard = (props: Partial<Parameters<typeof LabelCard>[0]> = {}) => {
  const html = renderToString(h(LabelCard, { detail: detail(), options: labelOptions(), printHref: "/admin/s/returns/r/label", book: none, canWrite: true, timeZone: "Europe/Oslo", ...props }));
  const text = plain(html);
  expect(text).not.toMatch(BAD);
  return { html, text };
};

describe("the return shipping card", () => {
  it("offers booking with the carrier, the weight estimated, and says who pays", () => {
    const { html, text } = labelCard();
    expect(text).toContain("Book a return label with Posten / Bring");
    expect(html).toContain('value="1200"');
    expect(text).toContain("only if the parcel came back with this label");
    expect(labelCard({ options: labelOptions({ payer: "store" }) }).text).toContain("nothing is taken off the refund");
  });

  it("says why a label cannot be booked", () => {
    const { text } = labelCard({ options: labelOptions({ block: "no_return_address" }) });
    expect(text).not.toContain("Book a return label with Posten");
    expect(text).toContain("Add the return address");
  });

  it("shows a booked label with tracking, cost, the print link and no second booking", () => {
    const booked = detail({
      label: { source: "carrier", carrierId: "bring", service: "9300", consignmentNumber: "C1", trackingNumber: "TRK123", trackingUrl: "https://tracking.bring.com/x", costMinor: 9_900, costCarrier: { amountMinor: 9_900, currency: "NOK", vatIncluded: true }, test: false, bookedAt: "2026-10-05T10:00:00.000Z", tries: 1 },
    });
    const { html, text } = labelCard({ detail: booked });
    expect(text).toContain("TRK123");
    expect(text).toMatch(/99.00 will be taken off the refund/);
    expect(html).toContain('href="/admin/s/returns/r/label"');
    expect(text).toContain("Print label");
    expect(text).not.toContain("Book again");
  });

  it("marks a test label and lets it be booked again", () => {
    const test = detail({
      label: { source: "carrier", carrierId: "bring", service: "9300", consignmentNumber: null, trackingNumber: "T", trackingUrl: null, costMinor: null, costCarrier: null, test: true, bookedAt: "2026-10-05T10:00:00.000Z", tries: 1 },
    });
    const { text } = labelCard({ detail: test, options: labelOptions({ block: null }) });
    expect(text).toContain("A test label was booked: it cannot be used.");
    expect(text).toContain("Not priced by the carrier");
    expect(text).toContain("Book again with Posten / Bring");
  });

  it("says a failed booking leaves pasting a label, and draws nothing once the goods are back without a label", () => {
    expect(labelCard({ detail: detail({ label: { ...detail().label, tries: 2 } }) }).text).toContain("Booking did not go through (2 tries)");
    expect(labelCard({ detail: detail({ status: "received" }) }).html).toBe("");
  });
});

describe("the exchange and label settings", () => {
  it("draws the switches, the carriers and the services, and nothing editable for staff", () => {
    const draw = (canEdit: boolean, carriers = [{ id: "bring", name: "Posten / Bring", ready: true }]) =>
      renderToString(h(ExchangeSettingsForm, { values: { exchanges: true, labelCarrier: "bring", labelService: null, labelAuto: false }, carriers, canEdit, action: none, integrationsHref: "/admin/s/integrations" }));
    const html = draw(true);
    const text = plain(html);
    expect(text).not.toMatch(BAD);
    expect(text).toContain("Offer exchanges");
    expect(text).toContain("Posten / Bring");
    expect(text).toContain("9300");
    expect(text).toContain("Book withdrawals' return labels automatically");
    expect(text).toContain("Save exchanges and labels");
    expect(plain(draw(false))).not.toContain("Save exchanges and labels");
    expect(plain(draw(true, []))).toContain("No connected carrier books return labels yet");
  });
});

describe("the queue and the return page", () => {
  it("marks exchanges and failed labels in the queue, and filters by them", () => {
    const html = renderToString(
      h(ReturnsQueueView, {
        base: "/admin/s/returns",
        filter: { status: "open", kind: "all", q: "", overdue: false },
        exchange: "waiting_payment",
        queue: { rows: [row({ exchange: "waiting_payment", labelFailed: true })], total: 1, page: 1, pageSize: 25 },
        counts: { open: 1, requested: 0, overdue: 0, acknowledgementPending: 0 },
        timeZone: "Europe/Oslo",
      }),
    );
    const text = plain(html);
    expect(text).toContain("Exchange: payment to collect");
    expect(text).toContain("Label not booked");
    expect(html).toContain('name="exchange"');
    expect(text).toContain("Clear");
  });

  it("places the cards on the return's page and words an exchanged return's credit", () => {
    const d = detail({ outcome: "exchanged" as never, refund: { ...detail().refund, recorded: true, amountMinor: 35_000 } });
    const text = plain(
      renderToString(h(ReturnDetailView, { base: "/admin/s", detail: d, preview: null, actions, timeZone: "Europe/Oslo", today: "2026-10-05", exchangeCard: h("p", null, "EXCHANGE-SLOT"), labelCard: h("p", null, "LABEL-SLOT") })),
    );
    expect(text).toContain("EXCHANGE-SLOT");
    expect(text).toContain("LABEL-SLOT");
    expect(text).toContain("Exchanged");
    expect(text).toContain("Credit, used for the exchange");
  });
});
