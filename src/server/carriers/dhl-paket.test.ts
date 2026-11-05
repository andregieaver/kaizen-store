import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createDhlPaketAdapter, fetchDhlPaketLabel, forgetDhlPaketTokens } from "./dhl-paket";

const sender = { senderName: "Mein Shop GmbH", senderStreet: "Sträßchensweg 10", senderPostalCode: "53113", senderCity: "Bonn", senderCountry: "DE", senderPhone: "+49 228 1234", senderEmail: "versand@shop.de" };
const context = (environment: "test" | "live" = "test", details: Record<string, string> = {}) => ({
  storeId: "s",
  environment,
  details: { username: "user-valid", ekp: "3333333333", ...sender, ...details },
  secrets: { apiKey: "app-key", apiSecret: "app-secret", password: "SandboxPasswort2023!" },
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const PDF = Buffer.from("%PDF-1.4 dhl paket").toString("base64");

/** A stand-in for DHL's Post & Parcel Germany APIs: a token, then whatever the route answers. */
function dhl(routes: Record<string, (body: unknown, url: string) => Response>) {
  const calls: { url: string; method: string; headers: Record<string, string>; body: unknown }[] = [];
  const fetcher = vi.fn(async (url: string, init: RequestInit = {}) => {
    const raw = typeof init.body === "string" ? init.body : null;
    const body = raw && raw.startsWith("{") ? JSON.parse(raw) : raw;
    calls.push({ url: String(url), method: init.method ?? "GET", headers: (init.headers ?? {}) as Record<string, string>, body });
    if (String(url).includes("/auth/ropc/v1/token")) return json({ access_token: "TOK", token_type: "Bearer", expires_in: 1799 });
    const route = Object.keys(routes).find((r) => String(url).includes(r));
    return route ? routes[route](body, String(url)) : json({ title: "Not Found", status: 404, detail: "The requested resource was not found." }, 404);
  });
  return { fetcher: fetcher as unknown as typeof fetch, calls };
}

const made = (shipmentNo = "00340434161094042557") => ({
  status: { title: "OK", status: 200 },
  items: [{ shipmentNo, sstatus: { title: "OK", status: 200 }, label: { b64: PDF, fileFormat: "PDF" }, validationMessages: [{ property: "product", validationMessage: "Warenpost was corrected to DHL Kleinpaket.", validationState: "Warning" }] }],
});

const request = {
  orderReference: "1042",
  serviceId: "paket",
  from: { name: "Mein Shop GmbH", street: "Sträßchensweg 10", postalCode: "53113", city: "Bonn", country: "DE", phone: "+49 228 1234", email: "versand@shop.de" },
  to: { name: "Maria Musterfrau", street: "Kurt-Schumacher-Str. 20", postalCode: "53113", city: "Bonn", country: "DE", phone: "0151 2345", email: "maria@example.de" },
  parcels: [{ weightGrams: 1200, lengthMm: 300, widthMm: 200, heightMm: 100 }],
};

beforeEach(() => forgetDhlPaketTokens());

describe("DHL Paket's connection", () => {
  it("gets a token by the password grant with the app and the portal user, and keeps it", async () => {
    const d = dhl({ "/shipping/v2/orders": () => json(made()) });
    const adapter = createDhlPaketAdapter(d.fetcher);
    expect(await adapter.check(context())).toEqual({ ok: true });
    expect(await adapter.check(context())).toEqual({ ok: true });
    const tokens = d.calls.filter((c) => c.url.includes("/token"));
    expect(tokens).toHaveLength(1);
    expect(tokens[0].url).toBe("https://api-sandbox.dhl.com/parcel/de/account/auth/ropc/v1/token");
    expect(Object.fromEntries(new URLSearchParams(String(tokens[0].body)))).toEqual({ grant_type: "password", username: "user-valid", password: "SandboxPasswort2023!", client_id: "app-key", client_secret: "app-secret" });
    const check = d.calls.find((c) => c.url.includes("/orders"))!;
    // A check only validates: nothing is booked.
    expect(check.url).toBe("https://api-sandbox.dhl.com/parcel/de/shipping/v2/orders?validate=true");
    expect(check.headers.Authorization).toBe("Bearer TOK");
    expect((check.body as { shipments: { billingNumber: string }[] }).shipments[0].billingNumber).toBe("33333333330101");
  });

  it("calls production when live, and says plainly what DHL refused", async () => {
    const d = dhl({ "/shipping/v2/orders": () => json(made()) });
    await createDhlPaketAdapter(d.fetcher).check(context("live"));
    expect(d.calls[0].url).toBe("https://api-eu.dhl.com/parcel/de/account/auth/ropc/v1/token");
    const refused = createDhlPaketAdapter((async () => json({ title: "Unauthorized", status: 401 }, 401)) as unknown as typeof fetch);
    expect(await refused.check(context())).toMatchObject({ ok: false, problem: expect.stringMatching(/API key and secret or the Business Customer Portal user/) });
    const billing = dhl({
      "/shipping/v2/orders": () =>
        json({ status: { title: "Bad Request", status: 400 }, items: [{ sstatus: { status: 400 }, validationMessages: [{ property: "billingNumber", validationMessage: "Invalid billing number.", validationState: "Error" }] }] }, 400),
    });
    expect(await createDhlPaketAdapter(billing.fetcher).check(context())).toEqual({ ok: false, problem: "DHL did not accept the request: billingNumber: Invalid billing number." });
    expect(await createDhlPaketAdapter(dhl({}).fetcher).check(context("test", { ekp: "12" }))).toMatchObject({ ok: false, problem: expect.stringMatching(/EKP/) });
    expect(await createDhlPaketAdapter(dhl({}).fetcher).check(context("test", { senderCountry: "AT" }))).toMatchObject({ ok: false, problem: expect.stringMatching(/from Germany/) });
  });

  it("books a parcel to the door on the store's billing number and hands on the label DHL gives", async () => {
    const d = dhl({ "/shipping/v2/orders": () => json(made()) });
    const booked = await createDhlPaketAdapter(d.fetcher).book!(context("test", { participation: "02" }), request);
    expect({ ...booked, labelPdf: Buffer.from(booked.labelPdf!).toString() }).toEqual({
      trackingNumber: "00340434161094042557",
      trackingUrl: "https://www.dhl.de/en/privatkunden/pakete-empfangen/verfolgen.html?piececode=00340434161094042557",
      consignmentNumber: "00340434161094042557",
      labelUrl: "https://api-sandbox.dhl.com/parcel/de/shipping/v2/orders?shipment=00340434161094042557&profile=STANDARD_GRUPPENPROFIL&docFormat=PDF&includeDocs=include",
      test: true,
      labelPdf: "%PDF-1.4 dhl paket",
    });
    const call = d.calls.find((c) => c.url.includes("/shipping/v2/orders"))!;
    expect(call.url).toBe("https://api-sandbox.dhl.com/parcel/de/shipping/v2/orders?includeDocs=include&docFormat=PDF");
    expect(call.body).toEqual({
      profile: "STANDARD_GRUPPENPROFIL",
      shipments: [
        {
          product: "V01PAK",
          billingNumber: "33333333330102",
          refNo: "Order 1042",
          shipper: { name1: "Mein Shop GmbH", addressStreet: "Sträßchensweg 10", postalCode: "53113", city: "Bonn", country: "DEU", email: "versand@shop.de" },
          // Within Germany the recipient's phone is never sent.
          consignee: { name1: "Maria Musterfrau", addressStreet: "Kurt-Schumacher-Str. 20", postalCode: "53113", city: "Bonn", country: "DEU", email: "maria@example.de" },
          details: { weight: { uom: "g", value: 1200 }, dim: { uom: "mm", length: 300, width: 200, height: 100 } },
        },
      ],
    });
  });

  it("books a small parcel as Kleinpaket at home and Warenpost International abroad, and refuses one too heavy", async () => {
    const d = dhl({ "/shipping/v2/orders": () => json(made()) });
    const adapter = createDhlPaketAdapter(d.fetcher);
    await adapter.book!(context(), { ...request, serviceId: "kleinpaket", parcels: [{ weightGrams: 800 }] });
    expect((d.calls.at(-1)!.body as { shipments: { product: string; billingNumber: string }[] }).shipments[0]).toMatchObject({ product: "V62KP", billingNumber: "33333333336201" });
    const abroad = { ...request, serviceId: "kleinpaket", to: { ...request.to, postalCode: "1010", city: "Wien", country: "AT" }, parcels: [{ weightGrams: 800 }] };
    await adapter.book!(context(), abroad);
    const sent = (d.calls.at(-1)!.body as { shipments: Record<string, unknown>[] }).shipments[0];
    expect(sent).toMatchObject({ product: "V66WPI", billingNumber: "33333333336601", consignee: { country: "AUT", phone: "0151 2345" }, services: { endorsement: "RETURN" } });
    // Austria is in the EU's customs union with Germany: no declaration.
    expect(sent.customs).toBeUndefined();
    await expect(adapter.book!(context(), { ...request, serviceId: "kleinpaket", parcels: [{ weightGrams: 1500 }] })).rejects.toThrow(/at most 1 kg/);
  });

  it("declares a parcel through customs with each line, value and weight a piece", async () => {
    const d = dhl({ "/shipping/v2/orders": () => json(made()) });
    const adapter = createDhlPaketAdapter(d.fetcher);
    const toOslo = { ...request, to: { ...request.to, postalCode: "0150", city: "Oslo", country: "NO" } };
    await expect(adapter.book!(context(), toOslo)).rejects.toThrow(/customs/);
    const customs = { incoterm: "DDP" as const, currency: "EUR", invoiceNumber: "RE-77", invoiceDate: "2026-11-05", lines: [{ hsCode: "61091000", origin: "PT", valueMinor: 3998, description: "T-Shirt", quantity: 2, weightGrams: 400 }] };
    const booked = await adapter.book!(context(), { ...toOslo, customs });
    expect(booked.customs).toEqual({ declared: true, reference: null, problem: null });
    const sent = (d.calls.at(-1)!.body as { shipments: Record<string, unknown>[] }).shipments[0];
    expect(sent).toMatchObject({ product: "V53WPAK", billingNumber: "33333333335301", services: { endorsement: "RETURN", postalDeliveryDutyPaid: true } });
    expect(sent.customs).toEqual({
      exportType: "COMMERCIAL_GOODS",
      invoiceNo: "RE-77",
      postalCharges: { currency: "EUR", value: 0 },
      items: [{ itemDescription: "T-Shirt", packagedQuantity: 2, hsCode: "61091000", countryOfOrigin: "PRT", itemValue: { currency: "EUR", value: 19.99 }, itemWeight: { uom: "g", value: 200 } }],
    });
  });

  it("finds post offices and Paketshops near the shopper in Germany, and none elsewhere", async () => {
    const d = dhl({
      "/find-by-address": () =>
        json({
          locations: [
            {
              name: "Paketshop Kiosk am Markt",
              location: { ids: [{ locationId: "8007-4140501", provider: "parcel" }], keyword: "Paketshop", keywordId: "433", type: "servicepoint" },
              distance: 640,
              place: { address: { countryCode: "DE", postalCode: "53111", addressLocality: "Bonn", streetAddress: "Markt 2" } },
            },
            {
              name: "Postfiliale 502",
              location: { ids: [{ locationId: "8003-4008202", provider: "parcel" }], keyword: "Postfiliale", keywordId: "502", type: "postoffice" },
              distance: 255,
              place: { address: { countryCode: "DE", postalCode: "53113", addressLocality: "Bonn", streetAddress: "Charles-de-Gaulle-Str. 20" } },
              openingHours: [{ opens: "08:00:00", closes: "18:00:00", dayOfWeek: "https://schema.org/Monday" }],
            },
            { name: "No number", location: { type: "postoffice" }, place: { address: { postalCode: "53113", addressLocality: "Bonn" } } },
          ],
        }),
    });
    const adapter = createDhlPaketAdapter(d.fetcher);
    const points = await adapter.pickupPoints!(context(), { name: "", street: "", postalCode: "53113", city: "", country: "DE" });
    expect(points).toEqual([
      {
        id: "502~53113~Bonn",
        name: "Postfiliale 502",
        address: { name: "Postfiliale 502", street: "Charles-de-Gaulle-Str. 20", postalCode: "53113", city: "Bonn", country: "DE" },
        openingHours: "Mon 08:00–18:00",
        distanceMeters: 255,
      },
      { id: "433~53111~Bonn", name: "Paketshop Kiosk am Markt", address: { name: "Paketshop Kiosk am Markt", street: "Markt 2", postalCode: "53111", city: "Bonn", country: "DE" }, distanceMeters: 640 },
    ]);
    const asked = new URL(d.calls[0].url);
    expect(asked.origin + asked.pathname).toBe("https://api.dhl.com/location-finder/v1/find-by-address");
    expect(asked.searchParams.getAll("locationType")).toEqual(["postoffice", "servicepoint"]);
    expect(asked.searchParams.get("serviceType")).toBe("parcel:pick-up");
    expect(d.calls[0].headers["DHL-API-Key"]).toBe("app-key");
    expect(await adapter.pickupPoints!(context(), { name: "", street: "", postalCode: "1010", city: "", country: "AT" })).toEqual([]);
  });

  it("sends a parcel to the outlet the shopper chose, addressed by their email", async () => {
    const d = dhl({ "/shipping/v2/orders": () => json(made()) });
    const adapter = createDhlPaketAdapter(d.fetcher);
    await adapter.book!(context(), { ...request, serviceId: "filiale", pickupPointId: "502~53113~Bonn" });
    expect((d.calls.at(-1)!.body as { shipments: Record<string, unknown>[] }).shipments[0].consignee).toEqual({ name: "Maria Musterfrau", retailID: 502, email: "maria@example.de", postalCode: "53113", city: "Bonn", country: "DEU" });
    await expect(adapter.book!(context(), { ...request, serviceId: "filiale", pickupPointId: "502~53113~Bonn", to: { ...request.to, email: undefined } })).rejects.toThrow(/email/);
    await expect(adapter.book!(context(), { ...request, serviceId: "filiale", to: { ...request.to, country: "AT" }, pickupPointId: "502~53113~Bonn" })).rejects.toThrow(/within Germany/);
  });

  it("says what DHL refused in a shipment, and asks for a collection when told, keeping the shipment either way", async () => {
    const refused = dhl({
      "/shipping/v2/orders": () =>
        json({ status: { title: "Bad Request", status: 400 }, items: [{ sstatus: { status: 400 }, validationMessages: [{ property: "consignee.postalCode", validationMessage: "The postal code is not valid.", validationState: "Error" }] }] }, 400),
    });
    await expect(createDhlPaketAdapter(refused.fetcher).book!(context(), request)).rejects.toThrow("DHL did not accept the request: consignee.postalCode: The postal code is not valid.");
    const d = dhl({
      "/shipping/v2/orders": () => json(made()),
      "/transportation/pickup/v1/orders": () => json({ confirmation: { type: "ORDERPICKUP", value: { orderID: "PU-123", pickupDate: "2026-11-06", freeOfCharge: false, pickupType: "EZA", confirmedShipments: [] } } }, 201),
    });
    const booked = await createDhlPaketAdapter(d.fetcher).book!(context(), { ...request, collection: { date: "2026-11-06", readyTime: "09:00", closeTime: "17:00" } });
    expect(booked.collection).toEqual({ booked: true, confirmation: "PU-123", problem: null });
    const pickup = d.calls.find((c) => c.url.includes("/pickup/"))!;
    expect(pickup.url).toBe("https://api-sandbox.dhl.com/parcel/de/transportation/pickup/v1/orders");
    expect(pickup.headers.Authorization).toBe(`Basic ${Buffer.from("user-valid:SandboxPasswort2023!").toString("base64")}`);
    expect(pickup.headers["dhl-api-key"]).toBe("app-key");
    expect(pickup.body).toEqual({
      customerDetails: { billingNumber: "33333333330101" },
      pickupLocation: { pickupAddress: { name1: "Mein Shop GmbH", addressStreet: "Sträßchensweg", addressHouse: "10", postalCode: "53113", city: "Bonn", country: "DE" }, businessHours: [{ timeFrom: "09:00", timeUntil: "17:00" }] },
      contactPerson: { name: "Mein Shop GmbH", phone: "+49 228 1234", email: "versand@shop.de" },
      pickupDetails: { pickupDate: { type: "Date", value: "2026-11-06" } },
      shipmentDetails: { shipments: [{ transportationType: "PAKET", shipmentNo: "00340434161094042557", customerReference: "1042" }] },
    });
    const notTaken = dhl({ "/shipping/v2/orders": () => json(made()), "/transportation/pickup/v1/orders": () => json([{ errorCode: 456, title: "Unknown billingnumber", detail: "33333333330101" }], 422) });
    const stillBooked = await createDhlPaketAdapter(notTaken.fetcher).book!(context(), { ...request, collection: { date: "2026-11-06", readyTime: "09:00", closeTime: "17:00" } });
    expect(stillBooked.trackingNumber).toBe("00340434161094042557");
    expect(stillBooked.collection).toEqual({ booked: false, confirmation: null, problem: "Unknown billingnumber: 33333333330101" });
  });

  it("cancels a shipment before the day's closing, and says when DHL will not", async () => {
    const d = dhl({ "/shipping/v2/orders": () => json({ status: { title: "OK", status: 200 }, items: [{ shipmentNo: "0034", sstatus: { title: "OK", status: 200 } }] }) });
    expect(await createDhlPaketAdapter(d.fetcher).cancel!(context(), { trackingNumber: "0034", consignmentNumber: "0034" })).toEqual({ ok: true });
    const call = d.calls.find((c) => c.method === "DELETE")!;
    expect(call.url).toBe("https://api-sandbox.dhl.com/parcel/de/shipping/v2/orders?profile=STANDARD_GRUPPENPROFIL&shipment=0034");
    const closed = dhl({ "/shipping/v2/orders": () => json({ status: { title: "Bad Request", status: 400 }, items: [{ shipmentNo: "0034", sstatus: { title: "Bad Request", status: 400, detail: "Shipment is already manifested." } }] }, 400) });
    expect(await createDhlPaketAdapter(closed.fetcher).cancel!(context(), { trackingNumber: "0034", consignmentNumber: null })).toEqual({
      ok: false,
      problem: "DHL did not cancel the shipment: Shipment is already manifested. A shipment is cancelled only before the day's closing.",
    });
  });

  it("books a DHL Retoure label from the customer to the store's returns receiver", async () => {
    const d = dhl({ "/shipping/returns/v1/orders": () => json({ shipmentNo: "999990000001", label: { b64: PDF }, routingCode: "40327653113+99000933090010", sstatus: { title: "Created", status: 201 } }, 201) });
    const booked = await createDhlPaketAdapter(d.fetcher).bookReturn!(context("test", { returnReceiverId: "deu" }), {
      returnReference: "1042-R1",
      serviceId: "retoure",
      from: { name: "Maria Musterfrau", street: "Kurt-Schumacher-Str. 20", postalCode: "53113", city: "Bonn", country: "DE", email: "maria@example.de" },
      to: { name: "Mein Shop GmbH", street: "Frankenstraße 298", postalCode: "45133", city: "Essen", country: "DE" },
      parcels: [{ weightGrams: 900 }],
    });
    expect(booked).toMatchObject({ trackingNumber: "999990000001", labelUrl: null, test: true });
    expect(Buffer.from(booked.labelPdf!).toString()).toBe("%PDF-1.4 dhl paket");
    const call = d.calls.find((c) => c.url.includes("/returns/"))!;
    expect(call.url).toBe("https://api-sandbox.dhl.com/parcel/de/shipping/returns/v1/orders?labelType=SHIPMENT_LABEL&docFormat=PDF");
    expect(call.body).toEqual({
      receiverId: "deu",
      customerReference: "1042-R1",
      shipmentReference: "1042-R1",
      shipper: { name1: "Maria Musterfrau", addressStreet: "Kurt-Schumacher-Str.", addressHouse: "20", postalCode: "53113", city: "Bonn", email: "maria@example.de" },
      itemWeight: { uom: "g", value: 900 },
    });
  });

  it("reads a shipment's unified tracking events newest first, and nothing for a number DHL does not know", async () => {
    const d = dhl({
      "/track/shipments": (_body, url) =>
        url.includes("trackingNumber=nope")
          ? json({ type: "about:blank", title: "No result found", status: 404, detail: "No shipment with given tracking number found." }, 404)
          : json({
          shipments: [
            {
              id: "0034",
              service: "parcel-de",
              events: [
                { timestamp: "2026-11-05T18:02:00+01:00", statusCode: "transit", status: "In transit", description: "The shipment has been processed in the parcel center.", location: { address: { addressLocality: "Köln" } } },
                { timestamp: "2026-11-06T11:40:00+01:00", statusCode: "delivered", status: "Delivered", description: "The shipment has been delivered." },
              ],
            },
          ],
        }),
    });
    const adapter = createDhlPaketAdapter(d.fetcher);
    expect(await adapter.track!(context("live"), "0034")).toEqual([
      { at: "2026-11-06T11:40:00+01:00", status: "delivered", description: "The shipment has been delivered." },
      { at: "2026-11-05T18:02:00+01:00", status: "transit", description: "The shipment has been processed in the parcel center.", location: "Köln" },
    ]);
    expect(d.calls[0].url).toBe("https://api-eu.dhl.com/track/shipments?trackingNumber=0034&service=parcel-de&language=en");
    expect(d.calls[0].headers["DHL-API-Key"]).toBe("app-key");
    expect(await adapter.track!(context(), "nope")).toEqual([]);
  });

  it("fetches a label again only from DHL's own host for the store's environment", async () => {
    const d = dhl({ "/shipping/v2/orders": () => json({ items: [{ shipmentNo: "0034", label: { b64: PDF } }] }) });
    const url = "https://api-sandbox.dhl.com/parcel/de/shipping/v2/orders?shipment=0034&profile=STANDARD_GRUPPENPROFIL&docFormat=PDF&includeDocs=include";
    expect(Buffer.from((await fetchDhlPaketLabel(context(), url, d.fetcher))!).toString()).toBe("%PDF-1.4 dhl paket");
    expect(await fetchDhlPaketLabel(context("live"), url, d.fetcher)).toBeNull();
    expect(await fetchDhlPaketLabel(context(), "https://evil.example/parcel/de/shipping/v2/orders?shipment=0034", d.fetcher)).toBeNull();
  });
});
