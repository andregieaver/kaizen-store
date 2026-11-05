import { describe, expect, it } from "vitest";

import { alpha3, billingNumber, outletChoice, productFor, readOutletChoice, refNo } from "./dhl-paket";

describe("DHL Paket's pure rules (D459)", () => {
  it("books each service as the product for the destination", () => {
    expect(productFor("paket", "DE")).toBe("V01PAK");
    expect(productFor("paket", "no")).toBe("V53WPAK");
    expect(productFor("kleinpaket", "DE")).toBe("V62KP");
    expect(productFor("kleinpaket", "FR")).toBe("V66WPI");
    expect(productFor("filiale", "DE")).toBe("V01PAK");
    expect(productFor("filiale", "AT")).toBeNull();
    expect(productFor("packstation", "DE")).toBeNull();
  });

  it("builds the 14-character billing number from the EKP, the product's procedure and the participation", () => {
    expect(billingNumber("3333333333", "V01PAK")).toBe("33333333330101");
    expect(billingNumber("3333333333", "V53WPAK", "02")).toBe("33333333335302");
    expect(billingNumber("33333 33333", "V62KP", "AB")).toBe("33333333336201".replace("01", "AB"));
    expect(billingNumber("123", "V01PAK")).toBeNull();
    expect(billingNumber("3333333333", "V01PAK", "1")).toBeNull();
  });

  it("keeps an outlet's number with its postal code and city, and reads it back", () => {
    expect(readOutletChoice(outletChoice("502", "53113", "Bonn"))).toEqual({ retailId: 502, postalCode: "53113", city: "Bonn" });
    expect(readOutletChoice("Postfiliale")).toBeNull();
  });

  it("writes a reference of at least 8 characters and countries in three letters", () => {
    expect(refNo("1042")).toBe("Order 1042");
    expect(refNo("10420001")).toBe("10420001");
    expect(alpha3("de")).toBe("DEU");
    expect(alpha3("NO")).toBe("NOR");
    expect(alpha3("ZZ")).toBeNull();
  });
});
