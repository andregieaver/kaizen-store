import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { t } from "@/lib/i18n";
import { timeline } from "@/lib/return-status";
import type { ShopperReturn } from "@/server/returns";

import { OrderReturns, offersWithdrawal, withdrawHref } from "./order-returns";
import { ReturnStatusView, type StatusExtras } from "./return-status-view";

/** What a person reads: comment markers gone, entities and no-break spaces made plain. */
const html = (element: Parameters<typeof renderToString>[0]) =>
  renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/[  ]/g, " ");

const ret = (over: Partial<ShopperReturn> = {}): ShopperReturn => ({
  number: "1042-R1",
  kind: "withdrawal",
  status: "approved",
  orderNumber: "1042",
  orderId: "6f1f3a1e-2b7c-4e0e-9a55-0c4c7a1d9b10",
  currency: "NOK",
  steps: timeline("withdrawal", "approved"),
  lines: [{ title: "Lampe", quantity: 2, decision: "accept", declineReason: null }],
  instructions: "Pack it in the box it came in.",
  returnAddress: { name: "Demo AS", street: "Storgata 1", postalCode: "0150", city: "Oslo", country: "NO" },
  labelUrl: null,
  whoPaysReturn: "shopper",
  nothingSent: false,
  decisionNote: null,
  outcome: null,
  refundMinor: null,
  refundedAt: null,
  confirmedAt: "2026-10-02T20:30:00.000Z",
  sendBackBy: "2026-10-16",
  refundBy: "2026-10-16T20:30:00.000Z",
  acknowledgementReference: "1042-R1",
  createdAt: "2026-10-02T20:30:00.000Z",
  timeZone: "Europe/Oslo",
  exchangeWishAt: null,
  exchange: null,
  label: { source: null, carrierId: null, service: null, consignmentNumber: null, trackingNumber: null, trackingUrl: null, costMinor: null, test: false, bookedAt: null },
  returnShippingMinor: 0,
  ...over,
});

const view = (r: ShopperReturn, lang = "en", locale = "en-GB") => html(h(ReturnStatusView, { m: t(lang).returns, ret: r, locale }));

describe("a return's status page (D153)", () => {
  it("shows where the return stands, what to do next, where to send it and who pays", () => {
    const out = view(ret());
    expect(out).toContain("Return 1042-R1");
    expect(out).toContain("Order 1042 · Withdrawal");
    expect(out).toContain("Send the goods back");
    expect(out).toContain("Send the goods back no later than 16 October 2026.");
    expect(out).toContain("Pack it in the box it came in.");
    expect(out).toContain("Storgata 1");
    expect(out).toContain("You pay for sending the goods back.");
    expect(out).toContain("The store refunds you no later than 16 October 2026.");
    expect(out).toContain("The store may wait with the refund until it has the goods back");
    expect(out).toContain('aria-current="step"');
    expect(view(ret({ whoPaysReturn: "store" }))).toContain("The store pays for sending the goods back.");
  });

  it("says there is nothing to send back for a withdrawal made before the goods were sent, and does not tell the shopper to send anything", () => {
    const out = view(ret({ nothingSent: true }));
    expect(out).toContain("Nothing to send back");
    expect(out).toContain("The goods had not been sent when you withdrew");
    expect(out).not.toContain("Send the goods back no later than");
    expect(out).not.toContain("Pack it in the box it came in.");
    expect(out).not.toContain("The store may wait with the refund");
    expect(out).toContain("The store refunds you no later than 16 October 2026.");
  });

  it("shows nothing about the shopper beyond the order number: no email, no home address", () => {
    const out = view(ret());
    expect(out).not.toMatch(/@/);
    expect(out).not.toMatch(/kari|nordmann/i);
    // The store's address is the store's, the only address on the page.
    expect(out.match(/<address/g)).toHaveLength(1);
  });

  it("shows a refund with its amount and day, and a return closed with none", () => {
    const refunded = view(
      ret({ status: "closed", steps: timeline("withdrawal", "closed"), outcome: "refunded", refundMinor: 19900, refundedAt: "2026-10-08T10:00:00.000Z", instructions: null }),
      "en",
      "en-GB",
    );
    expect(refunded).toMatch(/NOK\s?199\.00 was refunded on 8 October 2026\./);
    expect(refunded).not.toContain("Pack it in the box");
    expect(refunded).not.toContain("The store refunds you no later than");
    expect(view(ret({ status: "closed", steps: timeline("withdrawal", "closed"), outcome: "no_refund" }))).toContain("The return was closed without a refund.");
  });

  it("shows a declined voluntary return with the store's reason, and a line that was not accepted with its reason", () => {
    const out = view(
      ret({
        kind: "return",
        status: "declined",
        steps: timeline("return", "declined"),
        decisionNote: "We only take unopened goods back.",
        confirmedAt: null,
        sendBackBy: null,
        refundBy: null,
        acknowledgementReference: null,
        lines: [
          { title: "Lampe", quantity: 1, decision: "decline", declineReason: "Opened and used" },
          { title: "Kopp med navn", quantity: 1, decision: "decline", declineReason: "excluded_by_law" },
        ],
      }),
    );
    expect(out).toContain("Declined");
    expect(out).toContain("We only take unopened goods back.");
    expect(out).toContain("Not accepted: Opened and used");
    // The system's own reason is written out in the shopper's language, not shown as a code.
    expect(out).toContain("Not accepted: The law excludes this kind of goods from the right of withdrawal.");
    expect(out).not.toContain("excluded_by_law");
    expect(out).not.toContain("Send the goods back no later than");
  });

  it("opens a return label only when it is an https address", () => {
    expect(view(ret({ labelUrl: "https://carrier.example/label/1" }))).toContain('href="https://carrier.example/label/1"');
    for (const bad of ["javascript:alert(1)", "http://carrier.example/x", "//carrier.example/x", "https://a b"]) {
      expect(view(ret({ labelUrl: bad })), bad).not.toContain("Open the return label");
    }
  });

  it("is written in the market's language", () => {
    expect(view(ret(), "nb", "nb-NO")).toContain("Send varene tilbake senest 16. oktober 2026.");
    expect(view(ret(), "sv", "sv-SE")).toContain("Skicka tillbaka varorna senast 16 oktober 2026.");
    expect(view(ret(), "da", "da-DK")).toContain("Send varerne tilbage senest 16. oktober 2026.");
    // A language with no text of its own reads English, key by key.
    expect(view(ret(), "xx", "en")).toContain("Send the goods back");
  });
});

describe("a return's status page: the label and the exchange (D239)", () => {
  const all = t("en");
  const extras = (over: Partial<StatusExtras> = {}): StatusExtras => ({
    words: { exchange: all.exchange, returnLabel: all.returnLabel, exchangeWish: all.exchangeWish },
    labelRoute: "/s/demo/no/returns/abc/label",
    carrierName: "Posten / Bring",
    wishForm: null,
    ...over,
  });
  const drawn = (r: ShopperReturn, e: StatusExtras = extras(), lang = "en", locale = "en-GB") =>
    html(h(ReturnStatusView, { m: t(lang).returns, ret: r, locale, extras: e }));
  const booked = { source: "carrier" as const, carrierId: "bring", service: "9300", consignmentNumber: "70438101", trackingNumber: "370438101", trackingUrl: "https://tracking.bring.com/tracking/370438101", costMinor: 9900, test: false, bookedAt: "2026-10-03T10:00:00.000Z" };

  it("prints a booked label through Kaizena Flow's label route, never the carrier's address, with the carrier, tracking and who pays", () => {
    const out = drawn(ret({ label: booked }));
    expect(out).toContain("Your return label");
    expect(out).toContain('href="/s/demo/no/returns/abc/label"');
    expect(out).toContain("Print your return label");
    expect(out).toContain("Carrier: Posten / Bring");
    expect(out).toContain("370438101");
    expect(out).toContain('href="https://tracking.bring.com/tracking/370438101"');
    // Before the refund: the cost is taken off only if the parcel goes with this label (nothing is taken off at booking).
    expect(out).toMatch(/If you send the parcel with this label, its cost, NOK\s?99\.00, is taken off your refund\./);
    expect(out).not.toContain("The cost of the label");
    // Refunded with the label taken off: what was taken off.
    expect(drawn(ret({ label: booked, refundMinor: 10_000, returnShippingMinor: 9900 }))).toMatch(/The cost of the label, NOK\s?99\.00, is taken off your refund\./);
    // Refunded with nothing taken off (the parcel came another way): no sentence.
    expect(drawn(ret({ label: booked, refundMinor: 19_900, returnShippingMinor: 0 }))).not.toContain("is taken off your refund");
    expect(out).not.toContain("This is a test label");
    // The store pays: nothing is taken off, and it says so.
    const free = drawn(ret({ label: booked, whoPaysReturn: "store", returnShippingMinor: 0 }));
    expect(free).toContain("Return shipping is free for you.");
    expect(free).not.toContain("is taken off your refund");
    // Not priced by the carrier: no sentence about a cost.
    expect(drawn(ret({ label: { ...booked, costMinor: null } }))).not.toContain("is taken off your refund");
  });

  it("says a test label cannot be used, and shows no label once the return has ended", () => {
    const test = drawn(ret({ label: { ...booked, test: true } }));
    expect(test).toContain("This is a test label and cannot be used.");
    // A test label cost the store nothing and cannot be used: nothing about its cost is said, before or after the refund (finding: test label deduction).
    expect(test).not.toContain("is taken off your refund");
    expect(drawn(ret({ label: { ...booked, test: true }, refundMinor: 19_900, returnShippingMinor: 9900 }))).not.toContain("is taken off your refund");
    const ended = drawn(ret({ label: booked, status: "closed", steps: timeline("withdrawal", "closed") }));
    expect(ended).not.toContain("Print your return label");
  });

  it("keeps a pasted label as D153 drew it", () => {
    const out = drawn(ret({ labelUrl: "https://carrier.example/label/1", label: { ...booked, source: "pasted", carrierId: null } }));
    expect(out).toContain('href="https://carrier.example/label/1"');
    expect(out).not.toContain("/returns/abc/label");
  });

  it("offers the wish form when the page gives it, and says a wish was sent", () => {
    expect(drawn(ret(), extras({ wishForm: h("form", { "data-wish": "1" }) }))).toContain('data-wish="1"');
    const sent = drawn(ret({ exchangeWishAt: "2026-10-03T10:00:00.000Z" }));
    expect(sent).toContain(all.exchangeWish.sent);
    expect(drawn(ret())).not.toContain(all.exchangeWish.sent);
  });

  it("says where the exchange stands, in plain words, and never links its page (its token is kept as a hash)", () => {
    const x = (status: string, differenceMinor = 14900) =>
      ret({ exchange: { id: "x1", status, creditMinor: 50000, totalMinor: 50000 + differenceMinor, differenceMinor, expiresAt: "2026-10-14T10:30:00.000Z", exchangeOrderId: status === "settled" ? "o2" : null, exchangeOrderNumber: status === "settled" ? "1050" : null } });
    const proposed = drawn(x("proposed"));
    expect(proposed).toContain("Exchange proposed");
    expect(proposed).toMatch(/You pay NOK\s?149\.00/);
    expect(proposed).toContain(all.exchange.status.inEmail);
    expect(proposed).not.toContain("/account/exchange/");
    expect(drawn(x("confirmed", -5000))).toMatch(/Exchange confirmed[\s\S]*We refund you NOK\s?50\.00/);
    const waiting = drawn(x("processed"));
    expect(waiting).toContain("Waiting for your payment");
    expect(waiting).toContain(all.exchange.status.payInEmail);
    expect(drawn(x("settled"))).toContain("Exchanged: order 1050");
    for (const status of ["expired", "cancelled"]) expect(drawn(x(status))).toContain(all.exchange.status.lapsed);
    expect(drawn(x("superseded"))).toContain(all.exchange.states.refunded);
    expect(drawn(x("declined_by_customer"))).toContain(all.exchange.declined);
    // With an exchange under way, the wish form is not drawn even if given.
    expect(drawn(x("proposed"), extras({ wishForm: h("form", { "data-wish": "1" }) }))).not.toContain('data-wish="1"');
  });

  it("is said in Norwegian, Swedish and Danish", () => {
    for (const lang of ["nb", "sv", "da"]) {
      const all = t(lang);
      const e = extras({ words: { exchange: all.exchange, returnLabel: all.returnLabel, exchangeWish: all.exchangeWish } });
      expect(drawn(ret({ label: booked }), e, lang, "nb-NO"), lang).toContain(all.returnLabel.print);
    }
  });
});

describe("the order pages' way into the function (D153)", () => {
  const m = t("en").returns;
  const base = "/s/demo/no";
  const paid = { number: "1042", status: "paid", ships: true, company: null };

  it("builds the address from the order number and, on the order page, its key", () => {
    expect(withdrawHref(base, "1042", "cs_abc")).toBe("/s/demo/no/withdraw?order=1042&key=cs_abc");
    expect(withdrawHref(base, "A 1/2", null)).toBe("/s/demo/no/withdraw?order=A+1%2F2");
  });

  it("offers it for a paid order of goods for a consumer, and for nothing else", () => {
    expect(offersWithdrawal(paid)).toBe(true);
    expect(offersWithdrawal({ ...paid, status: "fulfilled" })).toBe(true);
    expect(offersWithdrawal({ ...paid, status: "pending_payment" })).toBe(false);
    expect(offersWithdrawal({ ...paid, status: "cancelled" })).toBe(false);
    expect(offersWithdrawal({ ...paid, ships: false })).toBe(false);
    expect(offersWithdrawal({ ...paid, company: { name: "A AS" } })).toBe(false);
  });

  it("draws the button with the order filled in, and the order's returns with their status", () => {
    const out = html(
      h(OrderReturns, {
        m,
        base,
        order: paid,
        orderKey: "cs_abc",
        returns: [{ number: "1042-R1", kind: "withdrawal", status: "in_transit", token: "t".repeat(64) }],
      }),
    );
    expect(out).toContain('href="/s/demo/no/withdraw?order=1042&key=cs_abc"');
    expect(out).toContain("Withdraw from the contract or return goods");
    expect(out).toContain(`href="/s/demo/no/returns/${"t".repeat(64)}"`);
    expect(out).toContain("1042-R1");
    expect(out).toContain("Withdrawal · On its way back");
  });

  it("draws nothing for an order with neither, and still lists returns when the order can no longer be withdrawn from", () => {
    expect(renderToString(h(OrderReturns, { m, base, order: { ...paid, ships: false }, orderKey: null, returns: [] }))).toBe("");
    const out = html(
      h(OrderReturns, { m, base, order: { ...paid, status: "cancelled" }, orderKey: null, returns: [{ number: "1042-R1", kind: "return", status: "declined", token: "t".repeat(64) }] }),
    );
    expect(out).not.toContain("/withdraw");
    expect(out).toContain("Return request · Declined");
  });
});
