import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AcknowledgementForm, ApproveForm, CloseForm, DayStepForm, DeclineForm, InspectForm, RefundPanel, type InspectLine } from "./step-forms";
import { plain, preview } from "./test-fixtures";

const action = async () => ({ status: "idle" as const, messages: [] });
const draw = (element: ReturnType<typeof h>) => {
  const html = renderToString(element);
  const text = plain(html);
  expect(text).not.toMatch(/\bNaN\b|Infinity|undefined|\[object/);
  return { html, text };
};

const defaults = { instructions: "Pack it well.", labelUrl: "", address: null };

describe("the refund panel", () => {
  const panel = (over: Partial<Parameters<typeof RefundPanel>[0]> = {}) =>
    draw(
      h(RefundPanel, {
        action,
        preview: preview(),
        recalculate: async () => ({ ok: true as const, preview: preview() }),
        currency: "NOK",
        locale: "en-GB",
        lines: [{ lineId: "l1", title: "White mug", quantity: 2, restock: 2 }],
        whoPays: "shopper",
        ...over,
      }),
    );

  it("shows each row of the working and the sum before the button, which says the amount", () => {
    const { html, text } = panel();
    expect(text).toContain("What the customer paid for the returned goods");
    expect(text.replace(/\s/g, "")).toContain("NOK300.00");
    expect(text).toContain("Original standard delivery");
    expect(text).toContain("To refund");
    expect(text).toContain("Refund NOK 350.00");
    expect(html).toContain('value="350,00"');
  });

  it("asks for a reason only when the amount is changed: it starts as what was worked out", () => {
    const { html, text } = panel();
    expect(text).toContain("A note, if you want one");
    expect(html).not.toMatch(/name="reason"[^>]*required/);
  });

  it("writes a deduction and return shipping as negative rows", () => {
    const { text } = panel({
      preview: preview({
        working: [
          { key: "goods", amountMinor: 30_000 },
          { key: "deductions", amountMinor: -2_000 },
          { key: "return_shipping", amountMinor: -9_900 },
        ],
        amountMinor: 18_100,
        returnShippingMinor: 9_900,
      }),
    });
    expect(text.replace(/\s/g, "")).toContain("−NOK20.00");
    expect(text.replace(/\s/g, "")).toContain("−NOK99.00");
    expect(text).toContain("Return shipping the customer pays");
  });

  it("does not ask for return shipping when the store pays it", () => {
    const { html, text } = panel({ whoPays: "store" });
    expect(text).toContain("You pay for return shipping");
    expect(html).not.toContain('name="shipping"');
    expect(text).not.toContain("Work it out again");
  });

  it("says when the sum was held down to what is left, or to nothing", () => {
    expect(panel({ preview: preview({ cappedBy: "refundable" }) }).text).toContain("held to what is left");
    expect(panel({ preview: preview({ cappedBy: "zero", amountMinor: 0 }) }).text).toContain("nothing is refunded");
  });

  it("says how much is left to refund, and puts stock back by line", () => {
    const { html, text } = panel();
    expect(text).toContain("At most NOK 350.00 is left to refund");
    expect(html).toContain('name="restock:l1"');
    expect(html).toMatch(/name="restock:l1"[^>]*max="2"|max="2"[^>]*name="restock:l1"/);
  });

  it("records a refund made outside Kaizen's Stripe as that", () => {
    const { text } = panel({ preview: preview({ canRefund: false }) });
    expect(text).toContain("Record as refunded outside");
    expect(text).toContain("not paid through Kaizen's Stripe");
  });

  it("leaves out the stock fieldset when nothing physical came back", () => {
    expect(panel({ lines: [] }).html).not.toContain("restock:");
  });
});

describe("the step forms", () => {
  it("ask a declined return for a reason the customer is emailed", () => {
    const { html, text } = draw(h(DeclineForm, { action }));
    expect(text).toContain("the customer is emailed this");
    expect(html).toMatch(/<textarea[^>]*name="reason"[^>]*required|<textarea[^>]*required[^>]*name="reason"/);
  });

  it("approve with instructions, an address and an https label", () => {
    const { html, text } = draw(h(ApproveForm, { action, defaults }));
    expect(text).toContain("Pack it well.");
    for (const name of ["addressName", "addressStreet", "addressPostalCode", "addressCity", "addressCountry", "labelUrl"]) expect(html, name).toContain(`name="${name}"`);
    expect(text).toContain("starting with https://");
    expect(text).toContain("Approve the return");
  });

  it("date a step with a day that cannot be in the future", () => {
    const { html, text } = draw(h(DayStepForm, { action, button: "Mark as received", help: "the day they arrived", today: "2026-10-05", successMessage: "ok" }));
    expect(html).toContain('max="2026-10-05"');
    expect(text).toContain("Mark as received");
  });

  const line = (over: Partial<InspectLine> = {}): InspectLine => ({
    lineId: "l1",
    title: "White mug",
    sku: "MUG",
    quantity: 2,
    condition: null,
    restock: false,
    deduction: "",
    deductionNote: "",
    physical: true,
    valueLabel: "NOK 300.00",
    ...over,
  });

  it("inspect each line: a condition, whether it goes back in stock, and a deduction with what it is for", () => {
    const { html, text } = draw(h(InspectForm, { action, lines: [line(), line({ lineId: "l2", title: "E-book", physical: false })], currency: "NOK", changing: false }));
    for (const name of ["condition:l1", "restock:l1", "deduction:l1", "deductionNote:l1", "condition:l2"]) expect(html, name).toContain(`name="${name}"`);
    expect(text).toContain("at most NOK 300.00");
    // A digital line never goes back into stock.
    expect(html).not.toContain('name="restock:l2"');
    expect(text).toContain("Not put back in stock: it is not a physical product.");
    expect(text).toContain("never more than the goods are worth");
  });

  it("show what was inspected, to be corrected", () => {
    const { html } = draw(h(InspectForm, { action, lines: [line({ condition: "used", restock: true, deduction: "20,00", deductionNote: "Worn" })], currency: "NOK", changing: true }));
    expect(html).toContain('value="20,00"');
    expect(html).toContain('value="Worn"');
    expect(html).toMatch(/<option value="used" selected/);
    expect(html).toMatch(/name="restock:l1"[^>]*checked|checked[^>]*name="restock:l1"/);
  });

  it("ask a withdrawal that was not refunded to be closed on purpose", () => {
    expect(draw(h(CloseForm, { action, needsConfirm: true })).html).toContain('name="confirmNoRefund"');
    expect(draw(h(CloseForm, { action, needsConfirm: false })).html).not.toContain("confirmNoRefund");
  });

  it("send the acknowledgement again", () => {
    expect(draw(h(AcknowledgementForm, { action })).text).toContain("Send the acknowledgement again");
  });
});
