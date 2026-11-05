import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createPostnordAdapter } from "./postnord";

const context = (environment: "test" | "live" = "test") => ({ storeId: "s", environment, details: { customerNumber: "123" }, secrets: { apiKey: "KEY" } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const points = { servicePointInformationResponse: { servicePoints: [{ servicePointId: "P1", name: "Kiosk", visitingAddress: { streetName: "Gata", postalCode: "0150", city: "Oslo", countryCode: "NO" } }] } };

describe("PostNord's connection", () => {
  it("checks the key with a service point search on the sandbox in test and the real host when live", async () => {
    const fetcher = vi.fn(async () => json(points));
    const adapter = createPostnordAdapter(fetcher as unknown as typeof fetch);
    expect(await adapter.check(context("test"))).toEqual({ ok: true });
    expect(await adapter.check(context("live"))).toEqual({ ok: true });
    const urls = fetcher.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(urls[0]).toMatch(/^https:\/\/atapi2\.postnord\.com\/rest\/businesslocation\/v5\//);
    expect(urls[0]).toContain("apikey=KEY");
    expect(urls[1]).toMatch(/^https:\/\/api2\.postnord\.com\//);
  });

  it("says plainly when the key is refused or PostNord does not answer, and never throws from the check", async () => {
    const refused = createPostnordAdapter((async () => json({}, 403)) as unknown as typeof fetch);
    expect(await refused.check(context())).toMatchObject({ ok: false, problem: expect.stringMatching(/API key/) });
    const down = createPostnordAdapter((async () => { throw new Error("network"); }) as unknown as typeof fetch);
    expect(await down.check(context())).toMatchObject({ ok: false, problem: expect.stringMatching(/did not answer/) });
  });

  it("finds service points near a postal code in the shopper's country", async () => {
    const fetcher = vi.fn(async () => json(points));
    const adapter = createPostnordAdapter(fetcher as unknown as typeof fetch);
    const found = await adapter.pickupPoints!(context(), { name: "", street: "", postalCode: "0150", city: "", country: "NO" });
    expect(found.map((p) => p.id)).toEqual(["P1"]);
    expect(String((fetcher.mock.calls[0] as unknown[])[0])).toContain("countryCode=NO&postalCode=0150");
  });

  it("follows a parcel, and has no price service and no cancel call", async () => {
    const adapter = createPostnordAdapter((async () => json({ TrackingInformationResponse: { shipments: [{ items: [{ events: [{ eventTime: "2026-10-01T10:00:00", eventDescription: "Delivered" }] }] }] } })) as unknown as typeof fetch);
    expect(await adapter.track!(context(), "123")).toMatchObject([{ description: "Delivered" }]);
    expect(adapter.rates).toBeUndefined();
    expect(adapter.cancel).toBeUndefined();
  });
});

const PDF = Buffer.from("%PDF-1.4 postnord label").toString("base64");
const booked = (itemId = "00373501093057988987") => ({
  bookingResponse: {
    bookingId: "0BQAS89SM5ZQ5K56U48IJXDZ8SGYFB",
    idInformation: [{ status: "OK", ids: [{ idType: "itemId", value: itemId }], urls: [{ type: "TRACKING", url: `https://attracking.postnord.com/se/?id=${itemId}` }] }],
  },
  labelPrintout: [{ itemIds: [{ itemIds: itemId, status: "OK" }], printout: { labelFormat: "PDF", encoding: "base64", data: PDF } }],
});

/** A stand-in for PostNord: whatever the route answers, recording each call. */
function postnord(routes: Record<string, (body: Record<string, unknown> | null) => Response>) {
  const calls: { url: string; method: string; body: Record<string, unknown> | null }[] = [];
  const fetcher = vi.fn(async (url: string, init: RequestInit = {}) => {
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ url: String(url), method: init.method ?? "GET", body });
    const route = Object.keys(routes).find((r) => String(url).includes(r));
    return route ? routes[route](body) : json({ error: { status_code: 404, message: "Request Could Not Be Processed" } }, 404);
  });
  return { fetcher: fetcher as unknown as typeof fetch, calls };
}

const sender = { senderName: "Butikk AS", senderStreet: "Akersgata 55", senderPostalCode: "0180", senderCity: "Oslo", senderCountry: "SE", senderEmail: "post@butikk.se" };
const shop = (environment: "test" | "live" = "test", extra: Record<string, string> = {}) => ({ ...context(environment), details: { customerNumber: "1111111111", ...sender, ...extra } });
const request = {
  orderReference: "1042",
  serviceId: "19",
  pickupPointId: "588462",
  from: { name: "Butikk AS", street: "Akersgata 55", postalCode: "11122", city: "Stockholm", country: "SE", email: "post@butikk.se" },
  to: { name: "Anna Svensson", street: "Upplandsgatan 42", postalCode: "11327", city: "Stockholm", country: "SE", phone: "0701234567", email: "anna@example.com" },
  parcels: [{ weightGrams: 1730 }],
};
type Shipment = { parties: Record<string, unknown>; service: unknown; dateAndTimes: unknown };
const shipmentOf = (body: Record<string, unknown> | null) => (body!.shipment as Shipment[])[0];

describe("booking with PostNord (D458)", () => {
  it("books MyPack Collect to the shopper's service point with its label in one call, and gives the label to keep", async () => {
    const p = postnord({
      "/servicepoints/ids": () => json({ servicePointInformationResponse: { servicePoints: [{ servicePointId: "588462", name: "Hemköp Sjövikshallen", visitingAddress: { streetName: "Sjövikstorget", streetNumber: "17", postalCode: "11758", city: "STOCKHOLM", countryCode: "SE" } }] } }),
      "/edi/labels/pdf": () => json(booked()),
    });
    const result = await createPostnordAdapter(p.fetcher).book!(shop(), request);
    expect({ ...result, labelPdf: Buffer.from(result.labelPdf!).toString() }).toEqual({
      trackingNumber: "00373501093057988987",
      trackingUrl: "https://attracking.postnord.com/se/?id=00373501093057988987",
      consignmentNumber: "0BQAS89SM5ZQ5K56U48IJXDZ8SGYFB",
      labelUrl: "https://atapi2.postnord.com/rest/shipment/v3/labels/ids/pdf#00373501093057988987",
      test: true,
      labelPdf: "%PDF-1.4 postnord label",
    });
    const lookup = p.calls.find((c) => c.url.includes("/servicepoints/ids"))!;
    expect(new URL(lookup.url).searchParams.get("ids")).toBe("588462");
    const booking = p.calls.find((c) => c.url.includes("/edi/labels/pdf"))!;
    expect(booking.method).toBe("POST");
    expect(booking.url).toMatch(/^https:\/\/atapi2\.postnord\.com\/rest\/shipment\/v3\/edi\/labels\/pdf\?apikey=KEY&/);
    const shipment = shipmentOf(booking.body);
    expect(shipment.service).toEqual({ basicServiceCode: "19", additionalServiceCode: ["A7"] });
    expect(shipment.parties.consignor).toMatchObject({ issuerCode: "Z12", partyIdentification: { partyId: "1111111111", partyIdType: "160" } });
    expect(shipment.parties.deliveryParty).toMatchObject({ partyIdentification: { partyId: "588462", partyIdType: "156" }, party: { nameIdentification: { name: "Hemköp Sjövikshallen" } } });
  });

  it("books the service point by its id alone when the look-up fails, and a home delivery without one", async () => {
    const p = postnord({ "/edi/labels/pdf": () => json(booked()) });
    await createPostnordAdapter(p.fetcher).book!(shop(), request);
    expect(shipmentOf(p.calls.at(-1)!.body).parties.deliveryParty).toEqual({ partyIdentification: { partyId: "588462", partyIdType: "156" } });
    await createPostnordAdapter(p.fetcher).book!(shop(), { ...request, serviceId: "17", pickupPointId: undefined });
    const home = shipmentOf(p.calls.at(-1)!.body);
    expect(home.service).toEqual({ basicServiceCode: "17" });
    expect(home.parties).not.toHaveProperty("deliveryParty");
  });

  it("says what PostNord objected to, and what is missing before calling it", async () => {
    const refused = postnord({ "/edi/labels/pdf": () => json({ compositeFault: { faults: [{ faultCode: "API-400", explanationText: "Invalid basicServiceCode for consignee country" }] } }, 400) });
    await expect(createPostnordAdapter(refused.fetcher).book!(shop(), { ...request, pickupPointId: undefined, serviceId: "18" })).rejects.toThrow("PostNord did not accept the request: Invalid basicServiceCode for consignee country");
    const none = postnord({});
    await expect(createPostnordAdapter(none.fetcher).book!(shop("live"), request)).rejects.toThrow(/application id/);
    await expect(createPostnordAdapter(none.fetcher).book!(shop("test", { senderCountry: "" }), { ...request, from: { ...request.from, country: "DE" } })).rejects.toThrow(/sender's country/);
    // Norway to Sweden crosses the EU's customs border: never booked without its lines.
    await expect(createPostnordAdapter(none.fetcher).book!(shop(), { ...request, from: { ...request.from, country: "NO", postalCode: "0180", city: "Oslo" } })).rejects.toThrow(/customs/);
    expect(none.calls).toEqual([]);
  });

  it("books a pickup after the parcel when asked, from Sweden, Denmark or Finland only", async () => {
    const p = postnord({ "/edi/labels/pdf": () => json(booked()), "/v3/pickups": () => json({ bookingId: "3SBZN", idInformation: [{ status: "OK", ids: [{ idType: "pickupId", value: "CR511599F" }] }] }, 201) });
    const collection = { date: "2026-11-06", readyTime: "10:00", closeTime: "16:00" };
    const result = await createPostnordAdapter(p.fetcher).book!(shop(), { ...request, collection });
    expect(result.collection).toEqual({ booked: true, confirmation: "CR511599F", problem: null });
    expect(p.calls.at(-1)!.body).toMatchObject({ messageFunction: "PickupBooking", shipment: [{ service: { basicServiceCode: "0", additionalServiceCode: ["p1"] } }] });
    const fromNorway = await createPostnordAdapter(p.fetcher).book!(shop("test", { senderCountry: "NO" }), {
      ...request,
      from: { ...request.from, country: "NO", postalCode: "0180", city: "Oslo" },
      to: { ...request.to, country: "NO", postalCode: "0566", city: "Oslo" },
      collection,
    });
    expect(fromNorway.trackingNumber).toBe("00373501093057988987");
    expect(fromNorway.collection).toMatchObject({ booked: false, problem: expect.stringMatching(/Sweden, Denmark and Finland/) });
    const down = postnord({ "/edi/labels/pdf": () => json(booked()), "/v3/pickups": () => json({}, 503) });
    expect((await createPostnordAdapter(down.fetcher).book!(shop(), { ...request, collection })).collection).toMatchObject({ booked: false, problem: expect.stringMatching(/did not book the pickup/) });
  });

  it("books a return label the shopper hands in at a service point, with the label to keep", async () => {
    const p = postnord({ "/returns/edi/labels/pdf": () => json(booked("00373501093057989083")) });
    const result = await createPostnordAdapter(p.fetcher).bookReturn!(shop(), { returnReference: "1042-R1", serviceId: "24", from: request.to, to: request.from, parcels: [{ weightGrams: 900 }] });
    expect(result).toMatchObject({ trackingNumber: "00373501093057989083", consignmentNumber: "0BQAS89SM5ZQ5K56U48IJXDZ8SGYFB", test: true, price: null });
    expect(Buffer.from(result.labelPdf!).toString()).toBe("%PDF-1.4 postnord label");
    const call = p.calls[0];
    expect(new URL(call.url).searchParams.get("emailQRcode")).toBe("false");
    expect(shipmentOf(call.body).service).toEqual({ basicServiceCode: "24" });
    expect(shipmentOf(call.body).parties.consignor).toMatchObject({ partyIdentification: { partyId: "1111111111" }, party: { nameIdentification: { name: "Anna Svensson" } } });
  });
});
