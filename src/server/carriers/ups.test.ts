import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createUpsAdapter, fetchUpsLabel, forgetUpsTokens } from "./ups";

const sender = { senderName: "Shop AS", senderStreet: "Lagerveien 2", senderPostalCode: "0150", senderCity: "Oslo", senderCountry: "NO", senderPhone: "+4722334455" };
const context = (environment: "test" | "live" = "test") => ({ storeId: "s", environment, details: { clientId: "cid", accountNumber: "a1b2c3", ...sender }, secrets: { clientSecret: "shh" } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const PDF = Buffer.from("%PDF-1.4 label").toString("base64");

/** A stand-in for UPS: a token, then whatever the route answers. */
function ups(routes: Record<string, (body: Record<string, unknown> | null) => Response>) {
  const calls: { url: string; method: string; headers: Record<string, string>; body: unknown }[] = [];
  const fetcher = vi.fn(async (url: string, init: RequestInit = {}) => {
    const body = typeof init.body === "string" && init.body.startsWith("{") ? (JSON.parse(init.body) as Record<string, unknown>) : (init.body ?? null);
    calls.push({ url: String(url), method: init.method ?? "GET", headers: (init.headers ?? {}) as Record<string, string>, body });
    if (String(url).endsWith("/security/v1/oauth/token")) return json({ access_token: "TOK", expires_in: "14399", token_type: "Bearer" });
    const route = Object.keys(routes).find((r) => String(url).includes(r));
    return route ? routes[route](body as Record<string, unknown> | null) : json({ response: { errors: [{ code: "x", message: "not here" }] } }, 404);
  });
  return { fetcher: fetcher as unknown as typeof fetch, calls };
}

const rated = {
  RateResponse: {
    RatedShipment: [
      { Service: { Code: "11" }, TotalCharges: { CurrencyCode: "NOK", MonetaryValue: "310.00" }, NegotiatedRateCharges: { TotalCharge: { CurrencyCode: "NOK", MonetaryValue: "249.50" } }, GuaranteedDelivery: { BusinessDaysInTransit: "3" } },
      { Service: { Code: "65" }, TotalCharges: { CurrencyCode: "NOK", MonetaryValue: "520.00" } },
      { Service: { Code: "96" }, TotalCharges: { CurrencyCode: "NOK", MonetaryValue: "9000.00" } },
    ],
  },
};

beforeEach(() => forgetUpsTokens());

describe("UPS's connection", () => {
  it("gets a token with HTTP Basic and the account as merchant id, and keeps it", async () => {
    const u = ups({ "/api/rating/": () => json(rated) });
    const adapter = createUpsAdapter(u.fetcher);
    expect(await adapter.check(context())).toEqual({ ok: true });
    expect(await adapter.check(context())).toEqual({ ok: true });
    const tokenCalls = u.calls.filter((c) => c.url.endsWith("/token"));
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0].url).toBe("https://wwwcie.ups.com/security/v1/oauth/token");
    expect(tokenCalls[0].headers.Authorization).toBe(`Basic ${Buffer.from("cid:shh").toString("base64")}`);
    expect(tokenCalls[0].headers["x-merchant-id"]).toBe("a1b2c3");
    expect(tokenCalls[0].body).toBe("grant_type=client_credentials");
    const rating = u.calls.find((c) => c.url.includes("/api/rating/"))!;
    expect(rating.url).toBe("https://wwwcie.ups.com/api/rating/v2409/Shop");
    expect(rating.headers.Authorization).toBe("Bearer TOK");
    expect(rating.headers.transId).toMatch(/^[0-9a-f]{32}$/);
    expect(rating.headers.transactionSrc).toBe("kaizenaflow");
  });

  it("calls production when live, and says plainly when the credentials are refused", async () => {
    const u = ups({ "/api/rating/": () => json(rated) });
    await createUpsAdapter(u.fetcher).check(context("live"));
    expect(u.calls[0].url).toBe("https://onlinetools.ups.com/security/v1/oauth/token");
    const refused = createUpsAdapter((async () => json({ response: { errors: [{ code: "250002", message: "Invalid Authentication Information." }] } }, 401)) as unknown as typeof fetch);
    expect(await refused.check(context())).toMatchObject({ ok: false, problem: expect.stringMatching(/client id and secret/) });
  });

  it("prices every UPS service the store offers, the negotiated rate first, without VAT", async () => {
    const u = ups({ "/api/rating/": () => json(rated) });
    const options = await createUpsAdapter(u.fetcher).rates!(context(), {
      from: { name: "Shop AS", street: "Lagerveien 2", postalCode: "0150", city: "Oslo", country: "NO" },
      to: { name: "", street: "", postalCode: "11120", city: "", country: "SE" },
      parcels: [{ weightGrams: 1234 }],
      currency: "SEK",
    });
    expect(options).toEqual([
      { serviceId: "11", carrier: "ups", name: "UPS Standard", priceMinor: 24950, currency: "NOK", needsPickupPoint: false, estimate: { minDays: 3, maxDays: 3 } },
      { serviceId: "AP", carrier: "ups", name: "UPS Standard to a UPS Access Point", priceMinor: 24950, currency: "NOK", needsPickupPoint: true, estimate: { minDays: 3, maxDays: 3 } },
      { serviceId: "65", carrier: "ups", name: "UPS Express Saver", priceMinor: 52000, currency: "NOK", needsPickupPoint: false },
    ]);
    const body = u.calls.find((c) => c.url.includes("/api/rating/"))!.body as { RateRequest: { Shipment: Record<string, unknown> } };
    expect(body.RateRequest.Shipment.Shipper).toMatchObject({ ShipperNumber: "A1B2C3", Address: { CountryCode: "NO", PostalCode: "0150" } });
    expect(body.RateRequest.Shipment.ShipTo).toMatchObject({ Address: { PostalCode: "11120", CountryCode: "SE" } });
    expect(body.RateRequest.Shipment.Package).toEqual([{ PackagingType: { Code: "02", Description: "Package" }, PackageWeight: { UnitOfMeasurement: { Code: "KGS", Description: "kg" }, Weight: "1.3" } }]);
  });

  it("finds UPS Access Points near a postal code, nearest first, by their public id", async () => {
    const u = ups({
      "/api/locations/": () =>
        json({
          LocatorResponse: {
            Response: { ResponseStatusCode: "1" },
            SearchResults: {
              DropLocation: [
                {
                  LocationID: "999",
                  AddressKeyFormat: { ConsigneeName: "Kiosk Far", AddressLine: "Gata 9", PoliticalDivision2: "Stockholm", PostcodePrimaryLow: "11122", CountryCode: "SE" },
                  Distance: { Value: "1.2", UnitOfMeasurement: { Code: "KM" } },
                  AccessPointInformation: { PublicAccessPointID: "SE00002" },
                },
                {
                  LocationID: "998",
                  AddressKeyFormat: { ConsigneeName: "Kiosk Near", AddressLine: ["Gata 1", "Hus B"], PoliticalDivision2: "Stockholm", PostcodePrimaryLow: "11120", CountryCode: "SE" },
                  Distance: { Value: "0.3", UnitOfMeasurement: { Code: "KM" } },
                  OperatingHours: { StandardHours: [{ HoursType: "10", DayOfWeek: [{ Day: "2", OpenHours: "800", CloseHours: "2000" }, { Day: "1", Open24HoursIndicator: "" }] }] },
                  AccessPointInformation: { PublicAccessPointID: "SE00001" },
                },
              ],
            },
          },
        }),
    });
    const points = await createUpsAdapter(u.fetcher).pickupPoints!(context(), { name: "", street: "", postalCode: "111 20", city: "", country: "SE" });
    expect(points.map((p) => [p.id, p.name, p.distanceMeters])).toEqual([
      ["SE00001", "Kiosk Near", 300],
      ["SE00002", "Kiosk Far", 1200],
    ]);
    expect(points[0].address).toEqual({ name: "Kiosk Near", street: "Gata 1, Hus B", postalCode: "11120", city: "Stockholm", country: "SE" });
    expect(points[0].openingHours).toBe("Mon 08:00–20:00, Sun 00:00–24:00");
    const body = u.calls.find((c) => c.url.includes("/api/locations/"))!;
    expect(body.url).toBe("https://wwwcie.ups.com/api/locations/v3/search/availabilities/64");
    expect((body.body as { LocatorRequest: { OriginAddress: unknown } }).LocatorRequest.OriginAddress).toEqual({
      AddressKeyFormat: { AddressLine: "", PoliticalDivision2: "", PoliticalDivision1: "", PostcodePrimaryLow: "11120", CountryCode: "SE" },
    });
  });

  const request = {
    orderReference: "1042",
    serviceId: "11",
    from: { name: "Shop AS", street: "Lagerveien 2", postalCode: "0150", city: "Oslo", country: "NO", phone: "+4722334455" },
    to: { name: "Kari Nordmann", street: "Storgata 1", postalCode: "0155", city: "Oslo", country: "NO", phone: "+4799887766", email: "kari@example.no" },
    parcels: [{ weightGrams: 2000, lengthMm: 300, widthMm: 200, heightMm: 100 }],
  };
  const shipped = {
    ShipmentResponse: {
      ShipmentResults: {
        ShipmentIdentificationNumber: "1ZA1B2C30412345678",
        NegotiatedRateCharges: { TotalCharge: { CurrencyCode: "NOK", MonetaryValue: "199.00" } },
        PackageResults: [{ TrackingNumber: "1ZA1B2C30412345678", ShippingLabel: { ImageFormat: { Code: "GIF" }, GraphicImage: "R0lGOD" } }],
      },
    },
  };

  it("books a shipment on the store's account and gives the tracking page and where the label is recovered", async () => {
    const u = ups({ "/api/shipments/": () => json(shipped) });
    const booked = await createUpsAdapter(u.fetcher).book!(context(), request);
    expect(booked).toEqual({
      trackingNumber: "1ZA1B2C30412345678",
      trackingUrl: "https://www.ups.com/track?tracknum=1ZA1B2C30412345678",
      consignmentNumber: "1ZA1B2C30412345678",
      labelUrl: "https://wwwcie.ups.com/api/labels/v1/recovery#1ZA1B2C30412345678",
      test: true,
    });
    const call = u.calls.find((c) => c.url.includes("/api/shipments/"))!;
    expect(call.url).toBe("https://wwwcie.ups.com/api/shipments/v2409/ship");
    const shipment = (call.body as { ShipmentRequest: { Shipment: Record<string, unknown>; LabelSpecification: unknown } }).ShipmentRequest;
    expect(shipment.Shipment.Service).toEqual({ Code: "11" });
    expect(shipment.Shipment.PaymentInformation).toEqual({ ShipmentCharge: [{ Type: "01", BillShipper: { AccountNumber: "A1B2C3" } }] });
    expect(shipment.Shipment.Description).toBeUndefined();
    expect(shipment.Shipment.Package).toEqual([
      {
        Packaging: { Code: "02", Description: "Package" },
        Dimensions: { UnitOfMeasurement: { Code: "CM", Description: "cm" }, Length: "30", Width: "20", Height: "10" },
        PackageWeight: { UnitOfMeasurement: { Code: "KGS", Description: "kg" }, Weight: "2.0" },
      },
    ]);
    expect(shipment.LabelSpecification).toMatchObject({ LabelImageFormat: { Code: "GIF" } });
  });

  it("sends a parcel to the UPS Access Point the shopper chose, held for pickup there", async () => {
    const u = ups({
      "/api/locations/": () =>
        json({ LocatorResponse: { SearchResults: { DropLocation: [{ AddressKeyFormat: { ConsigneeName: "Kiosk", AddressLine: "Gata 1", PoliticalDivision2: "Oslo", PostcodePrimaryLow: "0155", CountryCode: "NO" }, AccessPointInformation: { PublicAccessPointID: "NO00042" } }] } } }),
      "/api/shipments/": () => json(shipped),
    });
    await createUpsAdapter(u.fetcher).book!(context(), { ...request, serviceId: "AP", pickupPointId: "NO00042" });
    const shipment = (u.calls.find((c) => c.url.includes("/api/shipments/"))!.body as { ShipmentRequest: { Shipment: Record<string, unknown> } }).ShipmentRequest.Shipment;
    expect(shipment.Service).toEqual({ Code: "11" });
    expect(shipment.ShipmentIndicationType).toEqual([{ Code: "01" }]);
    expect(shipment.AlternateDeliveryAddress).toEqual({ Name: "Kiosk", AttentionName: "Kari Nordmann", UPSAccessPointID: "NO00042", Address: { AddressLine: ["Gata 1"], City: "Oslo", PostalCode: "0155", CountryCode: "NO" } });
    expect(shipment.ShipmentServiceOptions).toEqual({ Notification: [{ NotificationCode: "012", EMail: { EMailAddress: ["kari@example.no"] }, Locale: { Language: "ENG", Dialect: "GB" } }] });
  });

  it("carries a commercial invoice for a parcel through customs, and refuses one without its lines", async () => {
    const abroad = { ...request, to: { ...request.to, postalCode: "10115", city: "Berlin", country: "DE" } };
    const adapter = createUpsAdapter(ups({ "/api/shipments/": () => json(shipped) }).fetcher);
    await expect(adapter.book!(context(), abroad)).rejects.toThrow(/customs/);
    const u = ups({ "/api/shipments/": () => json(shipped) });
    const customs = { incoterm: "DDP" as const, currency: "NOK", invoiceNumber: "F-77", invoiceDate: "2026-11-05", lines: [{ hsCode: "61091000", origin: "PT", valueMinor: 39800, description: "T-shirt", quantity: 2, weightGrams: 400 }] };
    const booked = await createUpsAdapter(u.fetcher).book!(context(), { ...abroad, customs });
    expect(booked.customs).toEqual({ declared: true, reference: null, problem: null });
    const shipment = (u.calls.find((c) => c.url.includes("/api/shipments/"))!.body as { ShipmentRequest: { Shipment: Record<string, unknown> } }).ShipmentRequest.Shipment;
    expect(shipment.Description).toBe("T-shirt");
    expect((shipment.PaymentInformation as { ShipmentCharge: unknown[] }).ShipmentCharge).toEqual([
      { Type: "01", BillShipper: { AccountNumber: "A1B2C3" } },
      { Type: "02", BillShipper: { AccountNumber: "A1B2C3" } },
    ]);
    expect((shipment.ShipmentServiceOptions as { InternationalForms: unknown }).InternationalForms).toEqual({
      FormType: ["01"],
      InvoiceNumber: "F-77",
      InvoiceDate: "20261105",
      ReasonForExport: "SALE",
      CurrencyCode: "NOK",
      TermsOfShipment: "DDP",
      Product: [
        { Description: ["T-shirt"], Unit: { Number: "2", Value: "199.00", UnitOfMeasurement: { Code: "PCS", Description: "Pieces" } }, CommodityCode: "61091000", OriginCountryCode: "PT", ProductWeight: { UnitOfMeasurement: { Code: "KGS", Description: "kg" }, Weight: "0.4" } },
      ],
    });
  });

  it("says what is missing before calling UPS", async () => {
    const adapter = createUpsAdapter(ups({}).fetcher);
    await expect(adapter.book!(context(), { ...request, serviceId: "AP" })).rejects.toThrow(/Access Point is missing/);
    await expect(adapter.book!({ ...context(), details: { ...context().details, accountNumber: "12" } }, request)).rejects.toThrow(/six letters and digits/);
  });

  it("reads a parcel's events newest first, and nothing for a number UPS does not know", async () => {
    const u = ups({
      "/api/track/v1/details/1ZOK": () =>
        json({
          trackResponse: {
            shipment: [
              {
                package: [
                  {
                    activity: [
                      { date: "20261106", time: "101500", gmtDate: "20261106", gmtTime: "09:15:00", gmtOffset: "+01:00", status: { type: "D", description: "DELIVERED" }, location: { address: { city: "Oslo", countryCode: "NO" } } },
                      { date: "20261105", time: "180000", status: { type: "I", description: "Departed from Facility" }, location: { address: { city: "Alnabru" } } },
                    ],
                  },
                ],
              },
            ],
          },
        }),
    });
    const adapter = createUpsAdapter(u.fetcher);
    expect(await adapter.track!(context(), "1ZOK")).toEqual([
      { at: "2026-11-06T09:15:00Z", status: "D", description: "DELIVERED", location: "Oslo, NO" },
      { at: "2026-11-05T18:00:00", status: "I", description: "Departed from Facility", location: "Alnabru" },
    ]);
    expect(u.calls.find((c) => c.url.includes("/api/track/"))!.url).toBe("https://wwwcie.ups.com/api/track/v1/details/1ZOK?locale=en_GB");
    expect(await adapter.track!(context(), "1ZUNKNOWN")).toEqual([]);
  });

  it("recovers the label as a PDF when it is printed, and sends the token only to UPS", async () => {
    const u = ups({ "/api/labels/v1/recovery": () => json({ LabelRecoveryResponse: { LabelResults: [{ TrackingNumber: "1ZA", LabelImage: { LabelImageFormat: { Code: "PDF" }, GraphicImage: PDF } }] } }) });
    const pdf = await fetchUpsLabel(context(), "https://wwwcie.ups.com/api/labels/v1/recovery#1ZA1B2C30412345678", u.fetcher);
    expect(Buffer.from(pdf!).toString()).toBe("%PDF-1.4 label");
    const call = u.calls.find((c) => c.url.includes("/recovery"))!;
    expect(call.url).toBe("https://wwwcie.ups.com/api/labels/v1/recovery");
    expect(call.body).toMatchObject({ LabelRecoveryRequest: { TrackingNumber: "1ZA1B2C30412345678", LabelSpecification: { LabelImageFormat: { Code: "PDF" } } } });
    expect(await fetchUpsLabel(context(), "https://evil.example/api/labels/v1/recovery#1ZA", u.fetcher)).toBeNull();
    // A label of the other environment is not fetched with this one's token.
    expect(await fetchUpsLabel(context("live"), "https://wwwcie.ups.com/api/labels/v1/recovery#1ZA", u.fetcher)).toBeNull();
  });
});
