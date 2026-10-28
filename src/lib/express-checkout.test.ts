import { describe, expect, it } from "vitest";

import { expressFits, klarnaMessagingFits, registrableHost, walletDomainOf, walletWordOf, type ExpressLine } from "./express-checkout";

const goods: ExpressLine = { delivery: "physical", plan: null, booking: null, giftCard: null, hostId: null };

describe("which baskets an express payment can pay (D373)", () => {
  it("takes goods sent by post, bought once", () => {
    expect(expressFits([goods, { ...goods }])).toBe(true);
  });

  it("refuses an empty basket and any line the checkout page must ask about", () => {
    expect(expressFits([])).toBe(false);
    expect(expressFits([goods, { ...goods, delivery: "digital" }])).toBe(false);
    expect(expressFits([{ ...goods, delivery: "service", booking: { startsAt: "x" } }])).toBe(false);
    expect(expressFits([{ ...goods, plan: { id: "p" } }])).toBe(false);
    expect(expressFits([{ ...goods, giftCard: { recipient: null } }])).toBe(false);
    expect(expressFits([{ ...goods, hostId: "h" }])).toBe(false);
  });
});

describe("the wallets on each address", () => {
  const at = "2026-10-28T12:00:00.000Z";
  const domain = walletDomainOf(
    {
      domain_name: "shop.example",
      enabled: true,
      apple_pay: { status: "inactive", status_details: { error_message: "x".repeat(300) } },
      google_pay: { status: "active" },
      link: null,
      klarna: { status: "something new" },
    },
    at,
  );

  it("keeps only the four wallets' known states, the reason cut short", () => {
    expect(Object.keys(domain.wallets)).toEqual(["apple_pay", "google_pay"]);
    expect(domain.wallets.apple_pay?.reason).toHaveLength(200);
    expect(domain.checkedAt).toBe(at);
  });

  it("says never read, not registered, switched off, or the state", () => {
    expect(walletWordOf(null, "shop.example", "apple_pay")).toBe("not_read");
    expect(walletWordOf({}, "shop.example", "apple_pay")).toBe("not_registered");
    expect(walletWordOf({ "shop.example": { ...domain, enabled: false } }, "shop.example", "google_pay")).toBe("off");
    expect(walletWordOf({ "shop.example": domain }, "shop.example", "google_pay")).toBe("active");
    expect(walletWordOf({ "shop.example": domain }, "shop.example", "apple_pay")).toBe("inactive");
    expect(walletWordOf({ "shop.example": domain }, "shop.example", "link")).toBe("not_read");
  });

  it("registers public names only", () => {
    expect(registrableHost("https://Shop.Example.com:443/path")).toBe("shop.example.com");
    expect(registrableHost("http://localhost:3000")).toBeNull();
    expect(registrableHost("https://127.0.0.1")).toBeNull();
    expect(registrableHost("not a url")).toBeNull();
  });
});

describe("Klarna's line under a price", () => {
  it("is drawn only in currencies and countries Stripe's element takes", () => {
    expect(klarnaMessagingFits("nok", "no")).toBe(true);
    expect(klarnaMessagingFits("EUR", "DE")).toBe(true);
    expect(klarnaMessagingFits("ISK", "IS")).toBe(false);
    expect(klarnaMessagingFits("EUR", "EE")).toBe(false);
  });
});
