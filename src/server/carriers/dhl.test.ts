import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { asciiText, plannedShipping } from "@/lib/dhl";

import { createDhlAdapter } from "./dhl";

const sender = { senderName: "Butikk Ærlig AS", senderStreet: "Lagerveien 2", senderPostalCode: "0150", senderCity: "Oslo", senderCountry: "NO", senderPhone: "+47 22 33 44 55" };
const context = (environment: "test" | "live" = "test") => ({ storeId: "s", environment, details: { accountNumber: "123456789", ...sender }, secrets: { apiKey: "key", apiSecret: "secret" } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const PDF = Buffer.from("%PDF-1.7 dhl label").toString("base64");

/** A stand-in for the MyDHL API: whatever the route answers. */
function dhl(routes: Record<string, (body: Record<string, unknown> | null) => Response>) {
  const calls: { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> | null }[] = [];
  const fetcher = vi.fn(async (url: string, init: RequestInit = {}) => {
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ url: String(url), method: init.method ?? "GET", headers: (init.headers ?? {}) as Record<string, string>, body });
    const route = Object.keys(routes).find((r) => String(url).includes(r));
    return route ? routes[route](body) : json({ title: "Not found", status: "404" }, 404);
  });
  return { fetcher: fetcher as unknown as typeof fetch, calls };
}

const product = (code: string, price: number, tax = 0, days = 2) => ({
  productName: code,
  productCode: code,
  totalPrice: [
    { currencyType: "BILLC", priceCurrency: "NOK", price },
    { currencyType: "PULCL", priceCurrency: "EUR", price: price / 11 },
  ],
  totalPriceBreakdown: [{ currencyType: "BILLC", priceCurrency: "NOK", priceBreakdown: [{ typeCode: "STTXA", price: tax }, { typeCode: "SPRQT", price: price - tax }] }],
  deliveryCapabilities: { totalTransitDays: days },
});
const rates = { products: [product("P", 812.5, 162.5, 2), product("H", 400, 0, 5), product("D", 300, 0, 1), product("K", 1200, 0, 1)] };

describe("DHL Express's connection", () => {
  it("checks the key, secret and account with a rate in the sender's own city, on the test host", async () => {
    const d = dhl({ "/rates": () => json(rates) });
    expect(await createDhlAdapter(d.fetcher).check(context())).toEqual({ ok: true });
    const call = d.calls[0];
    expect(call.url).toBe("https://express.api.dhl.com/mydhlapi/test/rates");
    expect(call.headers.Authorization).toBe(`Basic ${Buffer.from("key:secret").toString("base64")}`);
    expect(call.headers["x-version"]).toBe("3.4.1");
    expect(call.body).toMatchObject({ accounts: [{ typeCode: "shipper", number: "123456789" }], isCustomsDeclarable: false, unitOfMeasurement: "metric" });
  });

  it("says plainly when DHL refuses the credentials or the account", async () => {
    const refused = dhl({ "/rates": () => json({ title: "Unauthorized", status: "401" }, 401) });
    expect(await createDhlAdapter(refused.fetcher).check(context())).toMatchObject({ ok: false, problem: expect.stringMatching(/API key and secret/) });
    const account = dhl({ "/rates": () => json({ detail: "The account number is not found or invalid", title: "Bad request", status: "400" }, 400) });
    expect(await createDhlAdapter(account.fetcher).check(context())).toMatchObject({ ok: false, problem: "DHL did not accept the request: The account number is not found or invalid" });
  });

  it("looks up the city of the shopper's postal code, then prices the store's services without DHL's tax, the cheaper product of each", async () => {
    const d = dhl({ "/address-validate": () => json({ address: [{ countryCode: "SE", postalCode: "11120", cityName: "STOCKHOLM" }] }), "/rates": () => json(rates) });
    const options = await createDhlAdapter(d.fetcher).rates!(context("live"), {
      from: { name: "Shop", street: "Lagerveien 2", postalCode: "0150", city: "Oslo", country: "NO" },
      to: { name: "", street: "", postalCode: "111 20", city: "", country: "SE" },
      parcels: [{ weightGrams: 1500 }],
      currency: "SEK",
    });
    expect(options).toEqual([
      { serviceId: "express", carrier: "dhl", name: "DHL Express", priceMinor: 65000, currency: "NOK", estimate: { minDays: 2, maxDays: 2 } },
      { serviceId: "economy", carrier: "dhl", name: "DHL Economy Select", priceMinor: 40000, currency: "NOK", estimate: { minDays: 5, maxDays: 5 } },
    ]);
    expect(d.calls[0].url).toBe("https://express.api.dhl.com/mydhlapi/address-validate?type=delivery&countryCode=SE&postalCode=11120&strictValidation=false");
    expect(d.calls[1].body).toMatchObject({
      customerDetails: { shipperDetails: { postalCode: "0150", cityName: "Oslo", countryCode: "NO" }, receiverDetails: { postalCode: "11120", cityName: "STOCKHOLM", countryCode: "SE" } },
      // Norway to Sweden crosses the EU's customs border.
      isCustomsDeclarable: true,
      packages: [{ weight: 1.5 }],
    });
  });

  const request = {
    orderReference: "1042",
    serviceId: "express",
    from: { name: "Butikk Ærlig AS", street: "Lagerveien 2", postalCode: "0150", city: "Oslo", country: "NO", phone: "+47 22 33 44 55" },
    to: { name: "Søren Ødegård", street: "Storgata 1, 2. etg", postalCode: "0155", city: "Oslo", country: "NO", phone: "+4799887766", email: "soren@example.no" },
    parcels: [{ weightGrams: 2000 }],
  };

  it("books the product Rates gives the lane, gives the label in the answer to be kept, and the public tracking page", async () => {
    const d = dhl({
      "/rates": () => json({ products: [product("N", 300, 60, 1)] }),
      "/shipments": () => json({ shipmentTrackingNumber: "1234567890", trackingUrl: "https://express.api.dhl.com/mydhlapi/shipments/1234567890/tracking", documents: [{ imageFormat: "PDF", content: PDF, typeCode: "label" }] }, 201),
    });
    const booked = await createDhlAdapter(d.fetcher).book!(context(), request);
    expect({ ...booked, labelPdf: Buffer.from(booked.labelPdf!).toString() }).toEqual({
      trackingNumber: "1234567890",
      trackingUrl: "https://www.dhl.com/global-en/home/tracking.html?tracking-id=1234567890",
      consignmentNumber: "1234567890",
      labelUrl: "https://express.api.dhl.com/mydhlapi/test/shipments/1234567890",
      test: true,
      labelPdf: "%PDF-1.7 dhl label",
    });
    const shipment = d.calls.find((c) => c.url.endsWith("/shipments"))!.body!;
    expect(shipment.productCode).toBe("N");
    expect(shipment.pickup).toEqual({ isRequested: false });
    expect(shipment.outputImageProperties).toEqual({ encodingFormat: "pdf", imageOptions: [{ typeCode: "label", templateName: "ECOM26_84_001" }] });
    expect(shipment.customerDetails).toEqual({
      shipperDetails: {
        postalAddress: { postalCode: "0150", cityName: "Oslo", countryCode: "NO", addressLine1: "Lagerveien 2" },
        contactInformation: { phone: "+47 22 33 44 55", companyName: "Butikk AErlig AS", fullName: "Butikk AErlig AS" },
      },
      receiverDetails: {
        postalAddress: { postalCode: "0155", cityName: "Oslo", countryCode: "NO", addressLine1: "Storgata 1", addressLine2: "2. etg" },
        contactInformation: { phone: "+4799887766", companyName: "Soren Odegard", fullName: "Soren Odegard", email: "soren@example.no" },
      },
    });
    expect(shipment.content).toEqual({ packages: [{ weight: 2 }], isCustomsDeclarable: false, description: "Goods", incoterm: "DAP", unitOfMeasurement: "metric" });
  });

  it("declares a parcel through customs with each line, and refuses one DHL does not offer the service for", async () => {
    const abroad = { ...request, to: { ...request.to, postalCode: "10115", city: "Berlin", country: "DE" } };
    const customs = { incoterm: "DAP" as const, currency: "NOK", invoiceNumber: "F-77", invoiceDate: "2026-11-05", lines: [{ hsCode: "61091000", origin: "PT", valueMinor: 39800, description: "T-skjorte økologisk", quantity: 2, weightGrams: 400 }] };
    const d = dhl({ "/rates": () => json(rates), "/shipments": () => json({ shipmentTrackingNumber: "9", documents: [] }, 201) });
    const booked = await createDhlAdapter(d.fetcher).book!(context(), { ...abroad, customs });
    expect(booked.customs).toEqual({ declared: true, reference: null, problem: null });
    expect(booked.labelUrl).toBeNull();
    const content = d.calls.find((c) => c.url.endsWith("/shipments"))!.body!.content as Record<string, unknown>;
    expect(content).toMatchObject({ isCustomsDeclarable: true, declaredValue: 398, declaredValueCurrency: "NOK", description: "T-skjorte okologisk" });
    expect(content.exportDeclarations).toEqual([
      {
        lineItems: [{ number: 1, description: "T-skjorte okologisk", price: 199, quantity: { value: 2, unitOfMeasurement: "PCS" }, commodityCodes: [{ typeCode: "outbound", value: "61091000" }], manufacturerCountry: "PT", weight: { netValue: 0.4, grossValue: 0.4 } }],
        invoice: { number: "F-77", date: "2026-11-05" },
        exportReason: "Sale",
        exportReasonType: "commercial_purpose_or_sale",
        incoterm: "DAP",
      },
    ]);
    const none = dhl({ "/rates": () => json({ products: [product("H", 100)] }) });
    await expect(createDhlAdapter(none.fetcher).book!(context(), { ...abroad, customs })).rejects.toThrow(/does not offer DHL Express/);
    await expect(createDhlAdapter(none.fetcher).book!(context(), abroad)).rejects.toThrow(/customs/);
  });

  it("reads a waybill's events with their offsets, newest first", async () => {
    const d = dhl({
      "/tracking": () =>
        json({
          shipments: [
            {
              shipmentTrackingNumber: "1234567890",
              events: [
                { date: "2026-11-06", time: "09:12:00", GMTOffset: "+01:00", typeCode: "OK", description: "Delivered", serviceArea: [{ code: "OSL", description: "OSLO-NO" }] },
                { date: "2026-11-05", time: "17:40:00", GMTOffset: "+01:00", typeCode: "PU", description: "Shipment picked up", serviceArea: [{ code: "OSL", description: "OSLO-NO" }] },
              ],
            },
          ],
        }),
    });
    expect(await createDhlAdapter(d.fetcher).track!(context(), "1234567890")).toEqual([
      { at: "2026-11-06T09:12:00+01:00", status: "OK", description: "Delivered", location: "OSLO-NO" },
      { at: "2026-11-05T17:40:00+01:00", status: "PU", description: "Shipment picked up", location: "OSLO-NO" },
    ]);
    expect(d.calls[0].url).toBe("https://express.api.dhl.com/mydhlapi/test/shipments/1234567890/tracking?trackingView=all-checkpoints&levelOfDetail=shipment&requestGMTOffsetPerEvent=true");
    expect(await createDhlAdapter(dhl({}).fetcher).track!(context(), "000")).toEqual([]);
  });
});

describe("DHL's text and dates", () => {
  it("writes text as printable ASCII", () => {
    expect(asciiText("Ærøskøbing straße – Café", 100)).toBe("AEroskobing strasse Cafe");
    expect(asciiText("x".repeat(60), 45)).toHaveLength(45);
  });

  it("hands a parcel in today on a weekday morning, else the next weekday", () => {
    expect(plannedShipping(new Date("2026-11-05T09:00:00Z"))).toBe("2026-11-05T16:00:00 GMT+00:00");
    expect(plannedShipping(new Date("2026-11-05T15:00:00Z"))).toBe("2026-11-06T12:00:00 GMT+00:00");
    expect(plannedShipping(new Date("2026-11-06T15:00:00Z"))).toBe("2026-11-09T12:00:00 GMT+00:00");
    expect(plannedShipping(new Date("2026-11-07T09:00:00Z"))).toBe("2026-11-09T12:00:00 GMT+00:00");
  });
});
