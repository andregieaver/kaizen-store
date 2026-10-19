import { describe, expect, it } from "vitest";

import {
  capabilityStates,
  excludedTypes,
  methodInfo,
  methodOn,
  methodStateOf,
  PAYMENT_CAPABILITIES,
  PAYMENT_METHODS,
  stateReason,
  SWITCHABLE_METHODS,
} from "./payment-methods";

describe("payment methods per country (D291)", () => {
  it("asks for cards first, the base methods, and the European bank methods, each once", () => {
    expect(PAYMENT_CAPABILITIES[0]).toBe("card_payments");
    expect(PAYMENT_CAPABILITIES).toEqual(expect.arrayContaining(["klarna_payments", "link_payments", "mobilepay_payments", "ideal_payments", "bancontact_payments", "blik_payments", "eps_payments", "p24_payments", "sepa_debit_payments"]));
    expect(new Set(PAYMENT_CAPABILITIES).size).toBe(PAYMENT_CAPABILITIES.length);
    expect(SWITCHABLE_METHODS.some((m) => m.type === "card")).toBe(false);
    expect(PAYMENT_METHODS.filter((m) => m.delayed).map((m) => m.type)).toEqual(["sepa_debit"]);
  });

  it("leaves out of a country's checkout exactly the methods switched off for it, never cards, and ignores what it does not know", () => {
    const choices = [
      { market: "NO", method: "klarna", enabled: false },
      { market: "NO", method: "link", enabled: true },
      { market: "NO", method: "card", enabled: false },
      { market: "NO", method: "swish", enabled: false },
      { market: "DE", method: "sepa_debit", enabled: false },
      { market: "NO", method: "ideal", enabled: false },
    ];
    expect(excludedTypes(choices, "NO")).toEqual(["ideal", "klarna"]);
    expect(excludedTypes(choices, "DE")).toEqual(["sepa_debit"]);
    expect(excludedTypes(choices, "SE")).toEqual([]);
    expect(methodOn(choices, "NO", "klarna")).toBe(false);
    expect(methodOn(choices, "NO", "link")).toBe(true);
    expect(methodOn(choices, "NO", "card")).toBe(true);
    expect(methodOn(choices, "SE", "klarna")).toBe(true);
    expect(methodOn(choices, "NO", "swish")).toBe(false);
  });

  it("reads Stripe's capability states as Stripe gave them and says each in words", () => {
    const states = capabilityStates({
      card_payments: { status: "active" },
      ideal_payments: { status: "pending" },
      blik_payments: { status: "inactive", status_details: [{ code: "unsupported_country" }] },
      something_else: { status: "active" },
    });
    expect(states).toEqual({
      card_payments: { status: "active", reason: null },
      ideal_payments: { status: "pending", reason: null },
      blik_payments: { status: "inactive", reason: "unsupported_country" },
    });
    expect(methodStateOf(states, methodInfo("card")!)).toBe("active");
    expect(methodStateOf(states, methodInfo("ideal")!)).toBe("pending");
    expect(methodStateOf(states, methodInfo("blik")!)).toBe("unavailable");
    expect(methodStateOf(states, methodInfo("eps")!)).toBe("requested");
    expect(methodStateOf(null, methodInfo("eps")!)).toBe("not_read");
    expect(stateReason("unsupported_country")).toMatch(/your country/);
    expect(stateReason("some_new_code")).toBe("some_new_code");
    expect(stateReason(null)).toBeNull();
  });
});
