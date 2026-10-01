import { describe, expect, it } from "vitest";

import { parseServicePoints, parseTracking, postnordHost, postnordProblem, postnordService, servicePointsUrl, trackingUrl } from "./postnord";

// The answers below are written as PostNord's documentation describes its Business Location v5 and Track and Trace v5 answers.
const servicePoints = {
  servicePointInformationResponse: {
    servicePoints: [
      {
        servicePointId: "NO-1001",
        name: "Kiwi Sentrum",
        routeDistance: 320,
        visitingAddress: { streetName: "Storgata", streetNumber: "9", postalCode: "0155", city: "OSLO", countryCode: "NO" },
        deliveryAddress: { streetName: "Postboks", streetNumber: "1", postalCode: "0001", city: "OSLO", countryCode: "NO" },
        openingHours: [
          { day: "MO", from1: "0900", to1: "1800" },
          { day: "TU", from1: "0900", to1: "1800" },
        ],
      },
      { servicePointId: "NO-1002", name: "Joker", distance: "1400", deliveryAddress: { streetName: "Lillegata", postalCode: "0156", city: "OSLO", countryCode: "NO" } },
      { name: "No id" },
    ],
  },
};

describe("PostNord's hosts and addresses", () => {
  it("uses the sandbox unless the store is live", () => {
    expect(postnordHost("live")).toBe("https://api2.postnord.com");
    expect(postnordHost("test")).toBe("https://atapi2.postnord.com");
  });

  it("builds the service point search and the tracking address with the key as apikey", () => {
    const url = new URL(servicePointsUrl("https://api2.postnord.com", "k e y", "no", "0150", 3));
    expect(url.pathname).toBe("/rest/businesslocation/v5/servicepoints/nearest/byaddress");
    expect(Object.fromEntries(url.searchParams)).toEqual({ apikey: "k e y", returnType: "json", countryCode: "NO", postalCode: "0150", numberOfServicePoints: "3" });
    const track = new URL(trackingUrl("https://atapi2.postnord.com", "key", "84971563697SE"));
    expect(track.pathname).toBe("/rest/shipment/v5/trackandtrace/findByIdentifier.json");
    expect(track.searchParams.get("id")).toBe("84971563697SE");
  });

  it("knows its services", () => {
    expect(postnordService("17")).toMatchObject({ needsPickupPoint: true });
    expect(postnordService("19")).toMatchObject({ needsPickupPoint: false });
    expect(postnordService("999")).toBeNull();
  });
});

describe("service points", () => {
  it("are read with their address, distance and opening hours, and those without an id are left out", () => {
    const points = parseServicePoints(servicePoints);
    expect(points.map((p) => p.id)).toEqual(["NO-1001", "NO-1002"]);
    expect(points[0]).toEqual({
      id: "NO-1001",
      name: "Kiwi Sentrum",
      address: { name: "Kiwi Sentrum", street: "Storgata 9", postalCode: "0155", city: "OSLO", country: "NO" },
      openingHours: "Mon 09:00–18:00, Tue 09:00–18:00",
      distanceMeters: 320,
    });
    // The delivery address stands in when there is no visiting address; distance may be given as text.
    expect(points[1]).toMatchObject({ address: { street: "Lillegata", postalCode: "0156" }, distanceMeters: 1400 });
  });

  it("are none when the answer is empty or not what was expected", () => {
    expect(parseServicePoints(null)).toEqual([]);
    expect(parseServicePoints({ servicePointInformationResponse: {} })).toEqual([]);
    expect(parseServicePoints({ servicePoints: [{ servicePointId: "x", name: "Direct" }] })).toHaveLength(1);
  });
});

describe("tracking", () => {
  const answer = {
    TrackingInformationResponse: {
      shipments: [
        {
          items: [
            {
              events: [
                { eventTime: "2026-10-01T09:00:00", eventCode: "EN_ROUTE", eventDescription: "The parcel is on its way", location: { displayName: "Oslo terminal" } },
                { eventTime: "2026-10-02T08:30:00", eventCode: "DELIVERED", eventDescription: "Delivered", location: { city: "Bergen" } },
                { eventDescription: "No time" },
              ],
            },
          ],
        },
      ],
    },
  };

  it("lists events newest first, with where they were", () => {
    expect(parseTracking(answer)).toEqual([
      { at: "2026-10-02T08:30:00", status: "DELIVERED", description: "Delivered", location: "Bergen" },
      { at: "2026-10-01T09:00:00", status: "EN_ROUTE", description: "The parcel is on its way", location: "Oslo terminal" },
    ]);
  });

  it("has none for a number PostNord does not know", () => {
    expect(parseTracking({ TrackingInformationResponse: { shipments: [] } })).toEqual([]);
    expect(parseTracking("nonsense")).toEqual([]);
  });
});

describe("what to tell the owner", () => {
  it("is plain for each kind of failure", () => {
    expect(postnordProblem(403)).toMatch(/API key/);
    expect(postnordProblem(429)).toMatch(/slow down/);
    expect(postnordProblem(503)).toMatch(/not answering/);
    expect(postnordProblem(400)).toContain("400");
  });
});
