import { describe, expect, it } from "vitest";

import {
  checkoutMethods,
  cleanPayer,
  MOLLIE_SCOPES,
  minorOfAmount,
  mollieAmount,
  mollieAnswer,
  mollieAuthorizeUrl,
  mollieFee,
  mollieLocale,
  mollieRefundStatus,
  mollieState,
  webhookPaymentId,
} from "./mollie";

describe("connecting Mollie (D292)", () => {
  it("sends the owner to Mollie with Kaizena Flow's app, its return address, the state and only the scopes it needs", () => {
    const url = new URL(mollieAuthorizeUrl({ clientId: "app_123", redirectUri: "https://kaizenaflow.com/api/integrations/mollie/callback", state: "s1" }));
    expect(url.origin + url.pathname).toBe("https://my.mollie.com/oauth2/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "app_123",
      redirect_uri: "https://kaizenaflow.com/api/integrations/mollie/callback",
      state: "s1",
      scope: MOLLIE_SCOPES.join(" "),
      response_type: "code",
      approval_prompt: "auto",
    });
    expect(MOLLIE_SCOPES).toContain("refunds.write");
    expect(MOLLIE_SCOPES.some((s) => s.startsWith("customers") || s.startsWith("mandates") || s.startsWith("subscriptions"))).toBe(false);
  });

  it("reads only a payment id from a webhook's body", () => {
    expect(webhookPaymentId("id=tr_WDqYK6vllg")).toBe("tr_WDqYK6vllg");
    expect(webhookPaymentId("id=re_abc123")).toBeNull();
    expect(webhookPaymentId("id=tr_../../x")).toBeNull();
    expect(webhookPaymentId("")).toBeNull();
  });
});

describe("amounts and states", () => {
  it("writes and reads amounts in the currency's own decimals", () => {
    expect(mollieAmount(24900, "nok")).toEqual({ currency: "NOK", value: "249.00" });
    expect(mollieAmount(2165, "EUR")).toEqual({ currency: "EUR", value: "21.65" });
    expect(minorOfAmount({ currency: "EUR", value: "21.65" })).toBe(2165);
    expect(minorOfAmount({ currency: "EUR", value: "21.65" }, "NOK")).toBeNull();
    expect(minorOfAmount(null)).toBeNull();
  });

  it("says where a payment stands in the words every provider's answer comes to", () => {
    expect(mollieState("paid")).toBe("paid");
    expect(mollieState("failed")).toBe("failed");
    expect(mollieState("canceled")).toBe("expired");
    expect(mollieState("expired")).toBe("expired");
    expect(mollieState("authorized")).toBe("unsettled");
    expect(mollieState("open")).toBe("open");
    expect(mollieState("pending")).toBe("open");
    expect(mollieAnswer({ id: "tr_1", status: "paid" })).toEqual({ provider: "mollie", reference: "tr_1", state: "paid", shopper: null });
    expect(mollieRefundStatus("refunded")).toBe("succeeded");
    expect(mollieRefundStatus("queued")).toBe("pending");
    expect(mollieRefundStatus("processing")).toBe("pending");
    expect(mollieRefundStatus("failed")).toBe("failed");
    expect(mollieRefundStatus("canceled")).toBe("failed");
  });

  it("keeps Kaizena Flow's fee within half of the payment, and says when it was capped", () => {
    expect(mollieFee(10000, 150)).toEqual({ feeMinor: 150, capped: false });
    expect(mollieFee(100, 99)).toEqual({ feeMinor: 50, capped: true });
    expect(mollieFee(10000, null)).toBeNull();
    expect(mollieFee(10000, 0)).toBeNull();
    expect(mollieFee(1, 1)).toBeNull();
  });
});

describe("what a checkout offers", () => {
  it("lists Mollie's active methods less the pay-later ones and what the owner switched off for the country, never cards", () => {
    const active = ["creditcard", "ideal", "paypal", "klarna", "vipps", "banktransfer", "przelewy24"];
    expect(checkoutMethods(active, [])).toEqual(["creditcard", "ideal", "paypal", "vipps", "przelewy24"]);
    expect(checkoutMethods(active, ["ideal", "p24", "card"])).toEqual(["creditcard", "paypal", "vipps"]);
    expect(checkoutMethods(null, ["ideal"])).toBeNull();
  });

  it("speaks the shopper's language on Mollie's page", () => {
    expect(mollieLocale("nb-NO")).toBe("nb_NO");
    expect(mollieLocale("en-NO")).toBe("en_US");
    expect(mollieLocale("de-AT")).toBe("de_AT");
    expect(mollieLocale("sv")).toBe("sv_SE");
    expect(mollieLocale("xx-YY")).toBe("en_US");
  });

  it("asks who pays, and the address only when goods are sent", () => {
    const typed = { name: "  Kari  Nordmann ", email: "kari@example.no", phone: "", line1: "Storgata 5", line2: "", postalCode: "0182", city: "Oslo" };
    expect(cleanPayer(typed, { address: true, phone: false })).toEqual({
      ok: true,
      payer: { name: "Kari Nordmann", email: "kari@example.no", phone: "", address: { line1: "Storgata 5", line2: "", postalCode: "0182", city: "Oslo" } },
    });
    expect(cleanPayer({ ...typed, line1: "" }, { address: false, phone: false })).toMatchObject({ ok: true, payer: { address: null } });
    expect(cleanPayer({ ...typed, line1: "" }, { address: true, phone: false })).toEqual({ ok: false, problem: "address" });
    expect(cleanPayer({ ...typed, email: "kari@" }, { address: false, phone: false })).toEqual({ ok: false, problem: "email" });
    expect(cleanPayer({ ...typed, name: " " }, { address: false, phone: false })).toEqual({ ok: false, problem: "name" });
    expect(cleanPayer(typed, { address: false, phone: true })).toEqual({ ok: false, problem: "phone" });
    expect(cleanPayer({ ...typed, phone: "+47 400 00 000" }, { address: false, phone: true })).toMatchObject({ ok: true });
  });
});
