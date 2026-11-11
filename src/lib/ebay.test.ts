import { describe, expect, it } from "vitest";

import { ebayAmount, ebaySettingsInput, inventoryItemBody, minorOfEbay, ordersFilter, readEbayOrder } from "./ebay";

describe("eBay's pure parts (D555)", () => {
  it("turns minor units into eBay's decimal strings and back without floating point", () => {
    expect(ebayAmount(1290)).toBe("12.90");
    expect(ebayAmount(5)).toBe("0.05");
    expect(ebayAmount(-250)).toBe("-2.50");
    expect(minorOfEbay("30.7")).toBe(3070);
    expect(minorOfEbay("0.05")).toBe(5);
    expect(minorOfEbay("nonsense")).toBe(0);
  });

  it("sends a title of at most 80 characters, https pictures only, and the GTIN as an EAN", () => {
    const body = inventoryItemBody({ sku: "S", title: "x".repeat(100), description: "", imageUrls: ["http://a.example/1.jpg", "https://a.example/2.jpg"], gtin: "7071234567890", quantity: 3.7, priceMinor: 100, currency: "EUR" });
    expect(body.product.title).toHaveLength(80);
    expect(body.product.imageUrls).toEqual(["https://a.example/2.jpg"]);
    expect(body.product).toMatchObject({ ean: ["7071234567890"] });
    expect(body.availability.shipToLocationAvailability.quantity).toBe(3);
  });

  it("asks only for orders not yet sent, and reads one with what is missing left out", () => {
    expect(ordersFilter(new Date("2026-11-11T08:00:00.000Z"))).toBe("creationdate:[2026-11-11T08:00:00.000Z..],orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}");
    const read = readEbayOrder({ orderId: "1", creationDate: "2026-11-11T09:00:00Z", lineItems: [{ lineItemId: "a", quantity: 1 }], cancelStatus: { cancelState: "NONE_REQUESTED" } });
    expect(read).toMatchObject({ externalId: "1", cancelled: false, totalMinor: 0, currency: "EUR", shipTo: {}, lines: [{ lineItemId: "a", sku: null, quantity: 1 }] });
    expect(readEbayOrder({ orderId: "2", creationDate: "2026-11-11T09:00:00Z", lineItems: [], cancelStatus: { cancelState: "CANCELED" } }).cancelled).toBe(true);
  });

  it("takes the seller's policy numbers and refuses what eBay would not", () => {
    expect(ebaySettingsInput.safeParse({ marketplace: "EBAY_FR", fulfillmentPolicyId: "123456", paymentPolicyId: "123457", returnPolicyId: "123458", merchantLocationKey: "lager-1", categoryId: "20625" }).success).toBe(true);
    expect(ebaySettingsInput.safeParse({ marketplace: "EBAY_FR", fulfillmentPolicyId: "abc", paymentPolicyId: "1", returnPolicyId: "1", merchantLocationKey: "x y", categoryId: "x" }).success).toBe(false);
  });
});
