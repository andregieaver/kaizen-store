import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { FormState } from "@/components/admin/action-form";
import type { ConversationRequest, RequestChoice } from "@/server/support-carry-out";

import { ConversationRequests, RequestActions } from "./request-actions";

/** What a person reads: comment markers out, entities made plain. */
const html = (element: Parameters<typeof renderToString>[0]) =>
  renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

const act = async (): Promise<FormState> => ({ status: "ok", messages: [] });
const ORDER = "11111111-2222-4333-8444-555555555555";
const choice = (over: Partial<RequestChoice> = {}): RequestChoice => ({ verified: true, carryOut: null, why: null, money: null, address: null, ...over });
const request = (over: Partial<ConversationRequest> = {}): ConversationRequest => ({
  id: "6f1e4c2a-1b2c-4d3e-8f90-123456789abc",
  kind: "refund",
  summary: "A refund for order 1042",
  details: "The teapot arrived broken.",
  orderNumber: "1042",
  orderId: ORDER,
  createdAt: "2026-11-17T09:00:00Z",
  choice: choice(),
  ...over,
});
const draw = (r: Omit<ConversationRequest, "summary" | "details" | "createdAt">, carryOut = true) =>
  html(h(RequestActions, { request: r, choice: r.choice, base: "/admin/demo", carryOut: carryOut ? act : null, decide: act }));

describe("a request's actions (ecosystem plan E2.7)", () => {
  it("offers a refund of what is left, all or part, to the payment or as store credit, beside Done and Decline", () => {
    const out = draw(request({ choice: choice({ carryOut: "refund", money: { minor: 5000, currency: "NOK" } }) }));
    expect(out).toMatch(/Refund NOK\s?50\.00/);
    expect(out).toContain("Everything");
    expect(out).toContain("Part of it");
    expect(out).toContain("Store credit");
    expect(out).toContain('name="expectMinor" value="5000"');
    expect(out).toContain("Done");
    expect(out).toContain("Decline");
    expect(out).toContain("The person asking is the order's own customer.");
    // Carried out here: the old advice to do it on the order page first is not given.
    expect(out).not.toContain("Do the work in the store's own screens first");
  });

  it("names the order and what goes back for a cancellation, and the new address for an address change", () => {
    const cancel = draw(request({ kind: "cancel_order", choice: choice({ carryOut: "cancel", money: { minor: 5000, currency: "NOK" } }) }));
    expect(cancel).toContain("Cancel order 1042");
    expect(cancel).toMatch(/Refunds NOK\s?50\.00 to the customer's payment/);
    const address = draw(
      request({ kind: "change_address", choice: choice({ carryOut: "address", address: { name: "Ana Berg", line1: "Nygata 5", postalCode: "0150", city: "Oslo" } }) }),
    );
    expect(address).toContain("New delivery address: Ana Berg, Nygata 5, 0150 Oslo");
    expect(address).toContain("Change the address");
  });

  it("keeps Done and Decline only for an exception, a person who may not change orders, and says why one is not carried out", () => {
    const exception = draw(request({ kind: "exception", choice: choice() }));
    expect(exception).not.toContain("Refund");
    expect(exception).toContain("Do the work in the store's own screens first");
    const noRight = draw(request({ choice: choice({ carryOut: "refund", money: { minor: 5000, currency: "NOK" } }) }), false);
    expect(noRight).not.toMatch(/Refund NOK/);
    const why = draw(request({ choice: choice({ why: "paidOutside", verified: false }) }));
    expect(why).toContain("It was paid outside Kaizena Flow");
    expect(why).toContain(`href="/admin/demo/orders/${ORDER}"`);
    expect(why).toContain("Not confirmed as the order's customer.");
  });
});

describe("a conversation's open requests above the reply box (E2.7)", () => {
  it("lists what was asked with its order, and links the Requests page where the inbox cannot decide", () => {
    const out = html(h(ConversationRequests, { store: { slug: "demo" }, requests: [request()], acts: null, onDone: () => {} }));
    expect(out).toContain("Waiting for you");
    expect(out).toContain("The teapot arrived broken.");
    expect(out).toContain(`href="/admin/demo/orders/${ORDER}"`);
    expect(out).toContain('href="/admin/demo/support/requests"');
    expect(out).not.toContain("Decline");
  });

  it("shows nothing without open requests or a store", () => {
    expect(html(h(ConversationRequests, { store: { slug: "demo" }, requests: [], acts: null, onDone: () => {} }))).toBe("");
    expect(html(h(ConversationRequests, { store: null, requests: [request()], acts: null, onDone: () => {} }))).toBe("");
  });
});
