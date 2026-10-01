import { describe, expect, it } from "vitest";

import {
  availabilityBody,
  formatWindow,
  isPorterbuddyUrl,
  orderBody,
  orderProblems,
  parseAvailability,
  parseDays,
  parseHours,
  parseLabelInfo,
  parseOrder,
  parseStatus,
  pickupWindows,
  porterbuddyHost,
  porterbuddyProblem,
  splitPhone,
  splitStreet,
} from "./porterbuddy";
import type { BookingRequest, ShippingAddress } from "./shipping-carriers";

// The answers below are the examples in Porterbuddy's API reference.
const availability = {
  deliveryWindows: [
    { product: "delivery", start: "2025-02-13T17:30:00+01:00", end: "2025-02-13T19:30:00+01:00", price: { fractionalDenomination: 14900, currency: "NOK" }, expiresAt: "2025-02-13T13:00:13+01:00", token: "tok-1", consolidated: false },
    { product: "delivery", start: "2025-02-13T19:30:00+01:00", end: "2025-02-13T21:30:00+01:00", price: { fractionalDenomination: 14900, currency: "NOK" }, displayPrice: { fractionalDenomination: "19900", currency: "NOK" }, expiresAt: "2025-02-13T13:00:11+01:00", token: "tok-2", consolidated: false },
    { product: "large", start: "2025-02-14T17:30:00+01:00", end: "2025-02-14T19:30:00+01:00", price: { fractionalDenomination: 29900, currency: "NOK" }, expiresAt: "2025-02-14T13:00:00+01:00", token: "tok-3" },
    { product: "delivery", start: "2025-02-14T19:30:00+01:00", end: "2025-02-14T21:30:00+01:00", price: { fractionalDenomination: 14900, currency: "NOK" } },
  ],
  flags: ["CONSOLIDATION_ENABLED"],
};

const sender: ShippingAddress = { name: "Nils Johansen", street: "Keysers Gate 3", postalCode: "0165", city: "Oslo", country: "NO", phone: "+47 651 27 865", email: "sender@example.com" };
const recipient: ShippingAddress = { name: "Roger Olsen", street: "Høyenhallveien 25", postalCode: "0678", city: "Oslo", country: "NO", phone: "65789832", email: "roger@example.com" };

describe("addresses and phone numbers", () => {
  it("splits a street into its name and number", () => {
    expect(splitStreet("Keysers Gate 3")).toEqual({ streetName: "Keysers Gate", streetNumber: "3" });
    expect(splitStreet("Storgata 10 B")).toEqual({ streetName: "Storgata", streetNumber: "10B" });
    expect(splitStreet("Høyenhallveien 25d")).toEqual({ streetName: "Høyenhallveien", streetNumber: "25d" });
    expect(splitStreet("Torggata, 12")).toEqual({ streetName: "Torggata", streetNumber: "12" });
    expect(splitStreet("Kirkeveien")).toEqual({ streetName: "Kirkeveien", streetNumber: "" });
  });

  it("splits a phone number into country code and number", () => {
    expect(splitPhone("+47 651 27 865")).toEqual({ code: "+47", number: "65127865" });
    expect(splitPhone("0046 70 123 45 67")).toEqual({ code: "+46", number: "701234567" });
    expect(splitPhone("65789832")).toEqual({ code: "+47", number: "65789832" });
    expect(splitPhone("(+45) 12 34 56 78")).toEqual({ code: "+45", number: "12345678" });
  });
});

describe("when the goods are ready", () => {
  it("reads opening hours and days, with sensible defaults", () => {
    expect(parseHours("9:00 - 17:30")).toEqual({ from: "09:00", to: "17:30" });
    expect(parseHours("17:00-09:00")).toBeNull();
    expect(parseHours("late")).toBeNull();
    expect(parseDays("1-5")).toEqual([1, 2, 3, 4, 5]);
    expect(parseDays("1,2,3,4,6")).toEqual([1, 2, 3, 4, 6]);
    expect(parseDays("whenever")).toEqual([1, 2, 3, 4, 5]);
  });

  it("makes a window for each day the store is open, the first starting after the parcel can be ready", () => {
    // Thursday 13 Feb 2025, 14:00 in Oslo (13:00 UTC); open 10:00-17:00 Monday to Friday.
    const now = Date.parse("2025-02-13T13:00:00Z");
    const windows = pickupWindows(now, { hours: "10:00-17:00", days: "1-5", timeZone: "Europe/Oslo", prepMinutes: 30, count: 3 });
    expect(windows).toEqual([
      { start: "2025-02-13T13:30:00.000Z", end: "2025-02-13T16:00:00.000Z" },
      { start: "2025-02-14T09:00:00.000Z", end: "2025-02-14T16:00:00.000Z" },
      // Saturday and Sunday are closed.
      { start: "2025-02-17T09:00:00.000Z", end: "2025-02-17T16:00:00.000Z" },
    ]);
  });

  it("leaves out today when it is too late to be ready before closing", () => {
    const now = Date.parse("2025-02-13T15:50:00Z");
    const windows = pickupWindows(now, { hours: "10:00-17:00", days: "1-5", timeZone: "Europe/Oslo", count: 1 });
    expect(windows[0].start).toBe("2025-02-14T09:00:00.000Z");
  });
});

describe("the availability request", () => {
  it("asks for the windows between two addresses, for the parcels", () => {
    const body = availabilityBody({
      from: sender,
      to: { name: "", street: "", postalCode: "0678", city: "", country: "NO" },
      pickupWindows: [{ start: "2025-02-13T13:30:00.000Z", end: "2025-02-13T16:00:00.000Z" }],
      products: ["delivery"],
      parcels: [{ weightGrams: 2000, widthMm: 300, heightMm: 255, lengthMm: 450 }],
    });
    expect(body).toEqual({
      pickupWindows: [{ start: "2025-02-13T13:30:00.000Z", end: "2025-02-13T16:00:00.000Z" }],
      originAddress: { streetName: "Keysers Gate", streetNumber: "3", postalCode: "0165", city: "Oslo", country: "Norway" },
      destinationAddress: { postalCode: "0678", country: "Norway" },
      products: ["delivery"],
      parcels: [{ weightGrams: 2000, widthCm: 30, heightCm: 26, depthCm: 45 }],
    });
  });
});

describe("the delivery windows an answer holds", () => {
  const now = Date.parse("2025-02-13T10:00:00Z");

  it("are options with their price, times and token; the shopper's price already has VAT", () => {
    const options = parseAvailability(availability, now);
    expect(options.map((o) => [o.serviceId, o.window?.token, o.priceMinor, o.includesVat === true])).toEqual([
      ["delivery", "tok-1", 14900, false],
      ["delivery", "tok-2", 19900, true],
      ["large", "tok-3", 29900, false],
    ]);
    expect(options[0]).toMatchObject({ carrier: "porterbuddy", name: "Porterbuddy delivery", currency: "NOK", window: { start: "2025-02-13T17:30:00+01:00", end: "2025-02-13T19:30:00+01:00", expiresAt: "2025-02-13T13:00:13+01:00" } });
  });

  it("leave out a window without a token or that has expired, and an empty list is none", () => {
    // tok-1 and tok-2 expire at 12:00 UTC: after that only the next day's windows are good.
    const later = Date.parse("2025-02-13T12:30:00Z");
    expect(parseAvailability(availability, later).map((o) => o.window?.token)).toEqual(["tok-3"]);
    expect(parseAvailability({ deliveryWindows: [] }, now)).toEqual([]);
    expect(parseAvailability(null, now)).toEqual([]);
  });
});

describe("the order", () => {
  const request: BookingRequest = {
    orderReference: "NJ12345",
    serviceId: "delivery",
    from: sender,
    to: recipient,
    parcels: [{ weightGrams: 2000 }],
    window: { start: "2025-02-13T17:30:00+01:00", end: "2025-02-13T19:30:00+01:00", token: "tok-1", expiresAt: "2025-02-13T13:00:13+01:00" },
  };

  it("is placed for the window with its token, from the sender to the recipient", () => {
    expect(orderBody(request)).toEqual({
      origin: { name: "Nils Johansen", address: { streetName: "Keysers Gate", streetNumber: "3", postalCode: "0165", city: "Oslo", country: "Norway" }, email: "sender@example.com", phoneCountryCode: "+47", phoneNumber: "65127865" },
      destination: {
        name: "Roger Olsen",
        address: { streetName: "Høyenhallveien", streetNumber: "25", postalCode: "0678", city: "Oslo", country: "Norway" },
        email: "roger@example.com",
        phoneCountryCode: "+47",
        phoneNumber: "65789832",
        deliveryWindow: { start: "2025-02-13T17:30:00+01:00", end: "2025-02-13T19:30:00+01:00", token: "tok-1" },
        verifications: { deliveryVerification: "CONTACTLESS" },
      },
      parcels: [{ description: "Parcel", weightGrams: 2000 }],
      product: "delivery",
      orderReference: "NJ12345",
    });
  });

  it("says in plain words what is missing before anything is sent", () => {
    expect(orderProblems(request)).toEqual([]);
    const missing = orderProblems({ ...request, window: undefined, from: { ...sender, street: "Keysers Gate", email: "" }, to: { ...recipient, street: "Kirkeveien", phone: "", email: "" } });
    expect(missing).toHaveLength(6);
    expect(missing.join(" ")).toMatch(/window/);
    expect(missing.join(" ")).toMatch(/street number/);
  });

  it("is read back with its number, pickup time and links", () => {
    expect(
      parseOrder({
        orderId: "1702918291025",
        pickupTime: "2025-02-13T15:00:00+02:00",
        _links: { labelInfo: { href: "https://api.porterbuddy-test.com/order/1702918291025/label" }, userInformation: { href: "https://www.porterbuddy-test.com/orders/recipient_tracking/abc" } },
      }),
    ).toEqual({ ok: true, orderId: "1702918291025", pickupTime: "2025-02-13T15:00:00+02:00", labelInfoUrl: "https://api.porterbuddy-test.com/order/1702918291025/label", trackingUrl: "https://www.porterbuddy-test.com/orders/recipient_tracking/abc" });
    expect(parseOrder({})).toMatchObject({ ok: false });
  });

  it("has a label document address only on https", () => {
    expect(parseLabelInfo({ shipmentLabelUrl: "https://api.porterbuddy-test.com/order/1/label/abc" })).toBe("https://api.porterbuddy-test.com/order/1/label/abc");
    expect(parseLabelInfo({ shipmentLabelUrl: "http://evil.example/x" })).toBeNull();
    expect(parseLabelInfo({})).toBeNull();
  });

  it("is followed by its status", () => {
    expect(parseStatus({ orderId: "1", orderStatus: "ready", statusUpdatedAt: "2021-03-25T10:30:35.742857Z" })).toEqual([{ at: "2021-03-25T10:30:35.742857Z", status: "ready", description: "Order ready" }]);
    expect(parseStatus({})).toEqual([]);
  });
});

describe("hosts, addresses and problems", () => {
  it("uses the test API unless the store is live, and only ever calls Porterbuddy's own hosts", () => {
    expect(porterbuddyHost("live")).toBe("https://api.porterbuddy.com");
    expect(porterbuddyHost("test")).toBe("https://api.porterbuddy-test.com");
    expect(isPorterbuddyUrl("https://api.porterbuddy.com/order/1/label")).toBe(true);
    expect(isPorterbuddyUrl("https://api.porterbuddy-test.com/order/1/label")).toBe(true);
    expect(isPorterbuddyUrl("https://api.porterbuddy.com.evil.example/x")).toBe(false);
    expect(isPorterbuddyUrl("http://api.porterbuddy.com/x")).toBe(false);
  });

  it("tells the owner plainly what went wrong", () => {
    expect(porterbuddyProblem(403)).toMatch(/API key/);
    expect(porterbuddyProblem(422)).toMatch(/address/);
    expect(porterbuddyProblem(503)).toMatch(/not answering/);
  });

  it("writes a window for people in the store's time zone", () => {
    expect(formatWindow({ start: "2025-02-13T16:30:00Z", end: "2025-02-13T18:30:00Z" }, "en-GB", "Europe/Oslo")).toBe("Thu 13 Feb, 17:30–19:30");
  });
});
