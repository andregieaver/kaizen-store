import { describe, expect, it } from "vitest";

import {
  bookingBody,
  bookingProblems,
  coverageBody,
  errorKey,
  helthjemHost,
  helthjemProblem,
  isHelthjemUrl,
  labelUrl,
  parseBooking,
  parseServicePoints,
  parseToken,
  parseTracking,
  servicePointsBody,
  shipmentNumber,
  solutionFor,
  solutionId,
  tokenBody,
  trackingUrl,
} from "./helthjem";
import type { BookingRequest } from "./shipping-carriers";

// The answers below follow the examples in Helthjem's OpenAPI description.
const nearby = {
  freightProducts: [
    {
      freightProductId: 55,
      servicePoints: [
        {
          servicePointExternalId: "30694",
          servicePointName: "Joker Toftes Gate",
          openingHours: [{ day: "MONDAY", from1: "08:00", to1: "20:00" }, { day: "SUNDAY", from1: "", to1: "" }],
          visitingAddress: { postalCode: "0556", countryCode: "NO", streetNumber: "12", streetName: "TOFTES GATE", postalName: "OSLO" },
          deliveryAddress: { postalCode: "0556", countryCode: "NO", streetNumber: "12", streetName: "TOFTES GATE", postalName: "OSLO" },
        },
      ],
    },
    { freightProductId: 3, servicePoints: [{ servicePointExternalId: "30694", servicePointName: "Duplicate" }, { servicePointExternalId: "PN-9", servicePointName: "Kiwi", visitingAddress: { streetName: "Gata", postalCode: "0150", postalName: "OSLO", countryCode: "NO" } }, { servicePointName: "No id" }] },
  ],
};

const request: BookingRequest = {
  orderReference: "ORD-1",
  serviceId: "home",
  from: { name: "Shop AS", street: "Akersgata 55", postalCode: "0180", city: "Oslo", country: "NO", phone: "22334455" },
  to: { name: "Kari Nordmann", street: "Fjellgata 48", postalCode: "0566", city: "Oslo", country: "NO", phone: "53582094", email: "kari@example.com" },
  parcels: [{ weightGrams: 1200, widthMm: 120, heightMm: 125, lengthMm: 300 }],
};

describe("hosts, solutions and the token", () => {
  it("uses the pre-production API unless the store is live", () => {
    expect(helthjemHost("live")).toBe("https://api.helthjem.no");
    expect(helthjemHost("test")).toBe("https://api.pre.helthjem.no");
    expect(isHelthjemUrl("https://api.helthjem.no/parcels/v1/labels/x")).toBe(true);
    expect(isHelthjemUrl("https://api.pre.helthjem.no/parcels/v1/labels/x")).toBe(true);
    expect(isHelthjemUrl("https://api.helthjem.no.evil.example/x")).toBe(false);
    expect(isHelthjemUrl("http://api.helthjem.no/x")).toBe(false);
  });

  it("reads the store's own transport solutions", () => {
    expect(solutionId(" 114 ")).toBe(114);
    expect(solutionId("abc")).toBeNull();
    expect(solutionId(undefined)).toBeNull();
    expect(solutionFor("home", { homeSolutionId: "2", collectSolutionId: "86" })).toBe(2);
    expect(solutionFor("collect", { homeSolutionId: "2", collectSolutionId: "86" })).toBe(86);
    expect(solutionFor("collect", { homeSolutionId: "2" })).toBeNull();
  });

  it("asks for a token with the client credentials and reads what comes back", () => {
    expect(tokenBody("id", "secret")).toEqual({ client_id: "id", client_secret: "secret", grant_type: "client_credentials" });
    expect(parseToken({ token: "abc", expires_in: 86400, token_type: "Bearer" })).toEqual({ token: "abc", expiresIn: 86400 });
    expect(parseToken({ token: "abc" })).toEqual({ token: "abc", expiresIn: 3600 });
    expect(parseToken({})).toBeNull();
  });
});

describe("coverage and service points", () => {
  it("asks about an address for a transport solution", () => {
    expect(coverageBody({ shopId: 16, solution: 2, name: "Ola", address: "Herslebs gate 2F", zipCode: "0561", city: "Oslo", country: "no", weightGrams: 1000 })).toEqual({
      shopId: 16,
      transportSolutionId: 2,
      customerName: "Ola",
      address: "Herslebs gate 2F",
      zipCode: "0561",
      postalName: "Oslo",
      countryCode: "NO",
      weight: 1000,
    });
    expect(errorKey({ errorKey: "no.carrier.support", statusCode: 400 })).toBe("no.carrier.support");
    expect(errorKey(null)).toBe("");
  });

  it("asks for service points near a postal code, with the street and city only when known", () => {
    expect(servicePointsBody({ shopId: 16, solution: 86, zipCode: "0561", country: "NO" })).toEqual({ shopId: 16, transportSolutionId: 86, zipCode: "0561", countryCode: "NO" });
    expect(servicePointsBody({ shopId: 16, solution: 86, street: "Gata 1", zipCode: "0561", city: "Oslo", country: "NO" })).toMatchObject({ streetAddress: "Gata 1", postalName: "Oslo" });
  });

  it("reads the points of every freight product, once each, without those that have no id", () => {
    const points = parseServicePoints(nearby);
    expect(points.map((p) => p.id)).toEqual(["30694", "PN-9"]);
    expect(points[0]).toEqual({
      id: "30694",
      name: "Joker Toftes Gate",
      address: { name: "Joker Toftes Gate", street: "TOFTES GATE 12", postalCode: "0556", city: "OSLO", country: "NO" },
      openingHours: "Mon 08:00–20:00",
    });
    expect(parseServicePoints(null)).toEqual([]);
  });
});

describe("the booking", () => {
  it("says in plain words what is missing before anything is sent", () => {
    expect(bookingProblems(request, 114, 16)).toEqual([]);
    const missing = bookingProblems({ ...request, serviceId: "collect", to: { ...request.to, phone: "", email: "" }, from: { ...request.from, street: "" } }, null, null);
    expect(missing).toHaveLength(6);
    expect(missing.join(" ")).toMatch(/shop id/);
    expect(missing.join(" ")).toMatch(/service point/);
  });

  it("is for the home: the consignee and the consignor, the parcels in centimetres", () => {
    expect(bookingBody(request, 16, 114)).toEqual({
      shopId: 16,
      transportSolutionId: 114,
      shipmentId: null,
      desiredDeliveryDate: null,
      messageToCarrier: null,
      messageToConsignee: null,
      parties: [
        { type: "consignee", name: "Kari Nordmann", countryCode: "NO", postalName: "Oslo", zipCode: "0566", address: "Fjellgata 48", coaddress: "", phone1: "53582094", phone2: null, email: "kari@example.com", reference: "ORD-1" },
        { type: "consignor", name: "Shop AS", countryCode: "NO", postalName: "Oslo", zipCode: "0180", address: "Akersgata 55", phone1: "22334455", phone2: null, email: "", reference: "ORD-1", coaddress: null },
      ],
      items: [{ itemNumber: 1, trackingReference: "", weight: 1200, width: 12, height: 13, length: 30, contents: "Goods" }],
    });
  });

  it("names the service point the shopper chose as a third party", () => {
    const body = bookingBody({ ...request, serviceId: "collect", pickupPointId: "30694" }, 16, 86);
    expect(body.parties.at(-1)).toEqual({ type: "servicePoint", id: "30694", countryCode: "NO" });
    expect(bookingProblems({ ...request, serviceId: "collect" }, 86, 16)).toEqual(["The customer's service point is missing."]);
  });

  it("is read back as the shipment number, with and without Helthjem's prefix", () => {
    expect(shipmentNumber("(401)70724763442660381")).toBe("70724763442660381");
    expect(parseBooking({ orderId: 224204075, shipmentId: "(401)70724763442660381", freightProductId: 1 })).toEqual({ ok: true, shipmentId: "(401)70724763442660381", shipmentNumber: "70724763442660381", orderId: "224204075", freightProductId: 1 });
    expect(parseBooking({})).toMatchObject({ ok: false });
  });
});

describe("labels and tracking", () => {
  it("has the label's address on the shipment, only for Helthjem's own hosts", () => {
    expect(labelUrl("https://api.helthjem.no", "(401)7072")).toBe("https://api.helthjem.no/parcels/v1/labels/(401)7072/unified-large");
    expect(trackingUrl("https://api.helthjem.no", "(401)7072")).toBe("https://api.helthjem.no/parcels/v1/tracking/fetch/7072/EN/false");
  });

  it("lists events newest first with what happened and where", () => {
    const events = parseTracking([
      {
        shipmentNumber: "7072",
        items: [
          {
            events: [
              { eventTime: "2026-06-05 09:00:00", eventTimeUtc: "2026-06-05T07:00:00Z", eventType: { apiKey: "001", description: "Registered" }, locationContext: "Testbutikken" },
              { eventTime: "2026-06-06 10:00:00", eventType: { apiKey: "010", description: "Delivered" }, message: "Delivered to the doormat" },
              { eventType: { apiKey: "x", description: "No time" } },
            ],
          },
        ],
      },
    ]);
    expect(events).toEqual([
      { at: "2026-06-06T10:00:00", status: "010", description: "Delivered to the doormat" },
      { at: "2026-06-05T07:00:00Z", status: "001", description: "Registered", location: "Testbutikken" },
    ]);
    expect(parseTracking([])).toEqual([]);
    expect(parseTracking(null)).toEqual([]);
  });
});

describe("what to tell the owner", () => {
  it("is plain for each kind of failure", () => {
    expect(helthjemProblem(400, { errorKey: "no.carrier.support" })).toMatch(/does not deliver to that address/);
    expect(helthjemProblem(403, { errorKey: "no.access.shop.id" })).toMatch(/shop id/);
    expect(helthjemProblem(401)).toMatch(/client id and secret/);
    expect(helthjemProblem(503)).toMatch(/not answering/);
    expect(helthjemProblem(400, { errorKey: "zipCode.required" })).toContain("zipCode.required");
  });
});
