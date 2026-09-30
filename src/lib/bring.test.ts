import { describe, expect, it } from "vitest";

import {
  amountToMinor,
  bookingBody,
  bringHeaders,
  bringProblem,
  parseBooking,
  parsePickupPoints,
  parseShippingGuide,
  parseTracking,
  pickupPointsUrl,
  shippingGuideBody,
  trackingApiUrl,
} from "./bring";

describe("amountToMinor", () => {
  it("reads Bring's decimal strings exactly", () => {
    expect(amountToMinor("228.77")).toBe(22877);
    expect(amountToMinor("285,96")).toBe(28596);
    expect(amountToMinor("1 234.5")).toBe(123450);
    expect(amountToMinor("100")).toBe(10000);
    expect(amountToMinor(57.19)).toBe(5719);
    expect(amountToMinor("10.005")).toBe(1001);
    expect(amountToMinor("abc")).toBeNull();
    expect(amountToMinor(undefined)).toBeNull();
  });
});

describe("Shipping Guide", () => {
  it("asks for every service with the customer number, in grams", () => {
    const body = shippingGuideBody({
      fromCountry: "NO",
      fromPostalCode: "0150",
      toCountry: "NO",
      toPostalCode: "1337",
      parcels: [{ weightGrams: 1250.4, lengthCm: 30 }, { weightGrams: 0 }],
      customerNumber: "12345",
    });
    expect(body.consignments[0].products).toEqual([
      { id: "5800", customerNumber: "12345" },
      { id: "5600", customerNumber: "12345" },
      { id: "3584", customerNumber: "12345" },
    ]);
    expect(body.consignments[0].packages).toEqual([{ id: "1", grossWeight: 1250, length: 30 }, { id: "2", grossWeight: 1 }]);
    expect(body).toMatchObject({ withPrice: true, withExpectedDelivery: true, language: "NO" });
  });

  const answer = {
    consignments: [
      {
        consignmentId: "1",
        products: [
          {
            id: "5600",
            guiInformation: { displayName: "Pakke levert hjem" },
            price: { listPrice: { currencyCode: "NOK", priceWithoutAdditionalServices: { amountWithoutVAT: "228.77", amountWithVAT: "285.96" } } },
            expectedDelivery: { workingDays: "1" },
          },
          {
            id: "5800",
            price: {
              listPrice: { currencyCode: "NOK", priceWithoutAdditionalServices: { amountWithoutVAT: "120.00" } },
              netPrice: { currencyCode: "NOK", priceWithoutAdditionalServices: { amountWithoutVAT: "99.50" } },
            },
          },
          { id: "3584", errors: [{ code: "X", description: "The parcel is too heavy for the mailbox." }] },
        ],
      },
    ],
  };

  it("reads services and what they cost the store, preferring the agreement's own price", () => {
    const { options, problems } = parseShippingGuide(answer);
    expect(options).toEqual([
      { serviceId: "5600", carrier: "bring", name: "Pakke levert hjem", priceMinor: 22877, currency: "NOK", estimate: { minDays: 1, maxDays: 1 } },
      { serviceId: "5800", carrier: "bring", name: "Pakke til hentested", priceMinor: 9950, currency: "NOK", needsPickupPoint: true },
    ]);
    expect(problems).toEqual(["The parcel is too heavy for the mailbox."]);
  });

  it("gives nothing for an answer it does not understand", () => {
    expect(parseShippingGuide(null)).toEqual({ options: [], problems: [] });
    expect(parseShippingGuide({ consignments: [{ products: [{ id: "5600" }] }] }).options).toEqual([]);
  });
});

describe("Pickup Point", () => {
  it("builds the address and reads the points, with opening hours and distance", () => {
    expect(pickupPointsUrl("no", "0150", 5)).toBe("https://api.bring.com/pickuppoint/api/pickuppoint/NO/postalCode/0150?numberOfResponses=5");
    const points = parsePickupPoints({
      pickupPoint: [
        {
          id: "123",
          name: "Kiwi Sentrum",
          address: "Storgata 1",
          postalCode: "0150",
          city: "OSLO",
          countryCode: "NO",
          distance: "0.4",
          openingHours: [{ day: "MONDAY", opening: "0800", closing: "2000" }, { day: "SUNDAY", opening: "", closing: "" }],
        },
        { name: "no id" },
      ],
    });
    expect(points).toEqual([
      {
        id: "123",
        name: "Kiwi Sentrum",
        address: { name: "Kiwi Sentrum", street: "Storgata 1", postalCode: "0150", city: "OSLO", country: "NO" },
        openingHours: "Mon 08:00–20:00",
        distanceMeters: 400,
      },
    ]);
    expect(parsePickupPoints([{ id: "9" }])[0].id).toBe("9");
    expect(parsePickupPoints(null)).toEqual([]);
  });
});

describe("Booking", () => {
  const request = {
    orderReference: "K-1001",
    serviceId: "5800",
    from: { name: "Shop AS", street: "Lagerveien 2", postalCode: "0150", city: "Oslo", country: "NO", phone: "+4711111111" },
    to: { name: "Kari Nordmann", street: "Gata 5", postalCode: "1337", city: "Sandvika", country: "NO", email: "kari@example.com" },
    parcels: [{ weightGrams: 1500, lengthMm: 300, widthMm: 200, heightMm: 100 }],
    pickupPointId: "123",
  };

  it("builds Booking v2's request with the product, parties, pickup point and packages", () => {
    const body = bookingBody(request, "12345", new Date("2026-10-01T10:00:00Z"));
    const c = body.consignments[0];
    expect(body.schemaVersion).toBe(1);
    expect(c.shippingDateTime).toBe("2026-10-01T11:00:00.000Z");
    expect(c.product).toEqual({ id: "5800", customerNumber: "12345" });
    expect(c.parties.sender).toMatchObject({ name: "Shop AS", addressLine: "Lagerveien 2", postalCode: "0150", city: "Oslo", countryCode: "NO", contact: { phoneNumber: "+4711111111" } });
    expect(c.parties.recipient).toMatchObject({ name: "Kari Nordmann", contact: { email: "kari@example.com" } });
    expect(c.parties.pickupPoint).toEqual({ id: "123", countryCode: "NO" });
    expect(c.packages).toEqual([{ weightInKg: 1.5, dimensions: { lengthInCm: 30, widthInCm: 20, heightInCm: 10 } }]);
  });

  it("leaves the pickup point out when there is none", () => {
    const body = bookingBody({ ...request, pickupPointId: undefined, serviceId: "5600" }, "1");
    expect(body.consignments[0].parties).not.toHaveProperty("pickupPoint");
  });

  it("reads the tracking number and links, only trusting https links", () => {
    const parsed = parseBooking({
      consignments: [
        {
          confirmation: { consignmentNumber: "70438200001234567" },
          packages: [{ packageNumber: "370000000000000001" }],
          links: { labels: "https://api.bring.com/labels/api/x.pdf", tracking: "http://insecure.example/track" },
          errors: [],
        },
      ],
    });
    expect(parsed).toEqual({ ok: true, consignmentNumber: "70438200001234567", trackingNumber: "370000000000000001", trackingUrl: null, labelUrl: "https://api.bring.com/labels/api/x.pdf" });
  });

  it("reports what Bring objected to", () => {
    expect(parseBooking({ consignments: [{ errors: [{ code: "BOOK-1", messages: [{ lang: "en", message: "Unknown customer number" }] }] }] })).toEqual({ ok: false, problem: "Unknown customer number" });
    expect(parseBooking({})).toMatchObject({ ok: false });
  });
});

describe("Tracking", () => {
  it("reads events newest first", () => {
    expect(trackingApiUrl("A B")).toBe("https://api.bring.com/tracking/api/v2/tracking.json?q=A%20B&lang=en");
    const events = parseTracking({
      consignmentSet: [
        {
          packageSet: [
            {
              eventSet: [
                { status: "IN_TRANSIT", description: "On its way", displayDate: "17.11.2022", displayTime: "08:30", city: "OSLO" },
                { status: "DELIVERED", description: "Delivered", displayDate: "18.11.2022", displayTime: "14:05", city: "SANDVIKA" },
              ],
            },
          ],
        },
      ],
    });
    expect(events.map((e) => e.status)).toEqual(["DELIVERED", "IN_TRANSIT"]);
    expect(events[0]).toEqual({ at: "2022-11-18T14:05", status: "DELIVERED", description: "Delivered", location: "SANDVIKA" });
    expect(parseTracking({ consignmentSet: [{ error: { code: 404 } }] })).toEqual([]);
  });
});

describe("headers and problems", () => {
  it("send the store's own user and key and say who is asking", () => {
    expect(bringHeaders({ apiUid: "me@shop.no", apiKey: "k", clientUrl: "https://kaizen.example" })).toMatchObject({
      "X-Mybring-API-Uid": "me@shop.no",
      "X-Mybring-API-Key": "k",
      "X-Bring-Client-URL": "https://kaizen.example",
      Accept: "application/json",
    });
  });

  it("explain failures in plain words", () => {
    expect(bringProblem(401)).toMatch(/user or key/);
    expect(bringProblem(429)).toMatch(/slow down/);
    expect(bringProblem(503)).toMatch(/not answering/);
    expect(bringProblem(400)).toContain("400");
  });
});
