import { describe, expect, it } from "vitest";

import { isKnownMethod, methodsForMarket, validateStripeCredentials } from "./payment-methods";

describe("payment methods", () => {
  it("offers national methods only where Stripe supports them", () => {
    expect(methodsForMarket("SE").map((m) => m.id)).toContain("swish");
    expect(methodsForMarket("NO").map((m) => m.id)).not.toContain("swish");
    expect(isKnownMethod("DK", "mobilepay")).toBe(true);
    expect(isKnownMethod("NO", "mobilepay")).toBe(false);
    expect(isKnownMethod("NO", "bitcoin")).toBe(false);
  });
});

describe("validateStripeCredentials", () => {
  it("accepts keys that match the mode", () => {
    expect(
      validateStripeCredentials("test", {
        publishableKey: "pk_test_abc",
        secretKey: "sk_test_abc",
        webhookSecret: "whsec_abc",
      }),
    ).toEqual([]);
    expect(validateStripeCredentials("live", { secretKey: "rk_live_abc" })).toEqual([]);
  });

  it("refuses test keys in live mode and the other way round", () => {
    expect(validateStripeCredentials("live", { publishableKey: "pk_test_abc" })).toHaveLength(1);
    expect(validateStripeCredentials("test", { secretKey: "sk_live_abc" })).toHaveLength(1);
  });

  it("refuses malformed values", () => {
    expect(validateStripeCredentials("test", { webhookSecret: "abc" })).toHaveLength(1);
    expect(validateStripeCredentials("test", { secretKey: "sk_test_ab c" })).toHaveLength(1);
  });

  it("ignores fields left empty", () => {
    expect(validateStripeCredentials("test", {})).toEqual([]);
  });
});
