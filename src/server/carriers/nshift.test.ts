import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { addonCodes, isNshiftUrl, nshiftProblem, parseCheckout } from "@/lib/nshift";

import { createNshiftAdapter, fetchNshiftLabel } from "./nshift";

const sender = { senderName: "Butikk AS", senderStreet: "Lagerveien 2", senderPostalCode: "0150", senderCity: "Oslo", senderCountry: "NO", senderPhone: "+4722334455", senderEmail: "post@butikk.no" };
const context = (environment: "test" | "live" = "test", details: Record<string, string> = {}) => ({
  storeId: "s",
  environment,
  details: { apiKeyId: "KEYID00000000000", senderQuickId: "1", checkoutId: "ece27d51-614d-4339-9728-4113e16b87ff", ...sender, ...details },
  secrets: { apiKey: "SECRET000000000000000000" },
});
const json = (body: unknown, status = 200) => new Response(body === null ? null : JSON.stringify(body), { status });
const PDF = Buffer.from("%PDF-1.4 nshift label").toString("base64");

/** A stand-in for nShift's REST API: whatever the route answers. */
function nshift(routes: Record<string, (body: Record<string, unknown> | null, method: string) => Response>) {
  const calls: { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> | null }[] = [];
  const fetcher = vi.fn(async (url: string, init: RequestInit = {}) => {
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    const method = init.method ?? "GET";
    calls.push({ url: String(url), method, headers: (init.headers ?? {}) as Record<string, string>, body });
    const route = Object.keys(routes).find((r) => String(url).includes(r));
    return route ? routes[route](body, method) : json({ code: "NOT_FOUND", message: "Not found" }, 404);
  });
  return { fetcher: fetcher as unknown as typeof fetch, calls };
}

const checkout = {
  deliveryCheckoutId: "ece27d51-614d-4339-9728-4113e16b87ff+37",
  options: [
    {
      id: "grp-home",
      name: "Hjemlevering",
      carrierId: null,
      priceValue: null,
      subOptions: [
        { id: "opt-home", name: "PostNord Parcel", serviceId: "P18", partnerId: "PLAB", priceDescription: "79 kr", priceValue: 79, subOptions: [], agents: [] },
        { id: "opt-home-2", name: "PostNord Parcel (evening)", serviceId: "P18", partnerId: "PLAB", priceValue: 99, subOptions: [], agents: [] },
      ],
      agents: [],
    },
    {
      id: "opt-collect",
      name: "MyPack Collect",
      serviceId: "P19",
      partnerId: "PLAB",
      priceValue: 49.5,
      subOptions: [],
      agents: [
        { id: "74383", name: "Kiwi Storgata", address1: "Storgata 1", address2: null, zipCode: "0155", city: "OSLO", country: "NO" },
        { id: "43333", name: "Rema 1000 Torggata", address1: "Torggata 2", zipCode: "0181", city: "OSLO", country: "NO" },
      ],
    },
    { id: "opt-free", name: "No price", serviceId: "BPAK", priceValue: null, subOptions: [], agents: [] },
  ],
};

describe("nShift's connection", () => {
  it("sends the API key as nShift's bearer token, and checks it with the store's delivery checkout", async () => {
    const n = nshift({ "/delivery-checkouts/": () => json(checkout) });
    expect(await createNshiftAdapter(n.fetcher).check(context())).toEqual({ ok: true });
    const asked = new URL(n.calls[0].url);
    expect(`${asked.origin}${asked.pathname}`).toBe("https://api.unifaun.com/rs-extapi/v1/delivery-checkouts/ece27d51-614d-4339-9728-4113e16b87ff");
    expect(Object.fromEntries(asked.searchParams)).toEqual({ language: "no", currency: "NOK", tocountry: "NO", tozipcode: "0150", fromcountry: "NO", fromzipcode: "0150", tocity: "Oslo" });
    expect(n.calls[0].headers.Authorization).toBe("Bearer KEYID00000000000-SECRET000000000000000000");
  });

  it("checks the key with the account's carriers when there is no checkout, and says plainly what nShift refused", async () => {
    const n = nshift({ "/meta/lists/partners": () => json([]) });
    expect(await createNshiftAdapter(n.fetcher).check(context("test", { checkoutId: "" }))).toEqual({ ok: true });
    expect(n.calls[0].url).toBe("https://api.unifaun.com/rs-extapi/v1/meta/lists/partners?language=en");
    const refused = nshift({ "/delivery-checkouts/": () => json(null, 401) });
    expect(await createNshiftAdapter(refused.fetcher).check(context())).toMatchObject({ ok: false, problem: expect.stringMatching(/API key/) });
    const unlicensed = nshift({ "/delivery-checkouts/": () => json(null, 403) });
    expect(await createNshiftAdapter(unlicensed.fetcher).check(context())).toMatchObject({ ok: false, problem: expect.stringMatching(/licence/) });
    const noCheckout = nshift({ "/delivery-checkouts/": () => json({ code: "MISSING", message: "Can't find deliverycheckout" }, 400) });
    expect(await createNshiftAdapter(noCheckout.fetcher).check(context())).toMatchObject({ ok: false, problem: expect.stringMatching(/delivery checkout/) });
  });

  it("offers the delivery checkout's options with nShift's service codes, the store's prices and each option's own pickup points", async () => {
    const n = nshift({ "/delivery-checkouts/": () => json(checkout) });
    const options = await createNshiftAdapter(n.fetcher).rates!(context(), {
      from: { name: "Butikk AS", street: "Lagerveien 2", postalCode: "0150", city: "Oslo", country: "NO" },
      to: { name: "", street: "", postalCode: "0155", city: "", country: "NO" },
      parcels: [{ weightGrams: 1250 }],
      currency: "NOK",
    });
    expect(options.map((o) => [o.serviceId, o.name, o.priceMinor, o.currency, o.includesVat, o.needsPickupPoint])).toEqual([
      ["P18", "PostNord Parcel", 7900, "NOK", true, false],
      ["P19", "MyPack Collect", 4950, "NOK", true, true],
    ]);
    const collect = options[1] as (typeof options)[number] & { pickupPoints: { id: string; name: string; address: unknown }[] };
    expect(collect.pickupPoints.map((p) => [p.id, p.name])).toEqual([
      ["74383", "Kiwi Storgata"],
      ["43333", "Rema 1000 Torggata"],
    ]);
    expect(collect.pickupPoints[0].address).toEqual({ name: "Kiwi Storgata", street: "Storgata 1", postalCode: "0155", city: "OSLO", country: "NO" });
    expect(new URL(n.calls[0].url).searchParams.get("weight")).toBe("1.25");
    // Without a checkout id there is nothing to offer, and nShift is not asked.
    const none = nshift({});
    expect(await createNshiftAdapter(none.fetcher).rates!(context("test", { checkoutId: "" }), { from: context().details as never, to: { name: "", street: "", postalCode: "0155", city: "", country: "NO" }, parcels: [], currency: "NOK" })).toEqual([]);
    expect(none.calls).toHaveLength(0);
  });

  const request = {
    orderReference: "1042",
    parcelReference: "1042-2",
    serviceId: "P19",
    pickupPointId: "74383",
    from: { name: "Butikk AS", street: "Lagerveien 2", postalCode: "0150", city: "Oslo", country: "NO", phone: "+4722334455", email: "post@butikk.no" },
    to: { name: "Kari Nordmann", street: "Fjellgata 48", postalCode: "0566", city: "Oslo", country: "NO", phone: "+4799887766", email: "kari@example.no" },
    parcels: [{ weightGrams: 1800 }],
  };
  const printed = [
    {
      href: "https://api.unifaun.com/rs-extapi/v1/shipments/5666306",
      id: "5666306",
      serviceId: "P19",
      shipmentNo: "70724763442660381",
      parcels: [{ parcelNo: "00370724763442660381", reference: null }],
      status: "PRINTED",
      prints: [{ id: "10234441", type: "pdf", description: "Label", href: "https://api.unifaun.com/rs-extapi/v1/shipments/5666306/prints/10234441" }],
    },
  ];

  it("books a test shipment with the sender's quick id, the chosen agent and the store's addons, and asks no collection", async () => {
    const n = nshift({ "/shipments": () => json(printed, 201) });
    const booked = await createNshiftAdapter(n.fetcher).book!(context("test", { addons: "notsms, NOTEMAIL notsms" }), { ...request, collection: { date: "2026-11-06", readyTime: "12:00", closeTime: "16:00" } });
    expect(booked).toEqual({
      trackingNumber: "00370724763442660381",
      trackingUrl: null,
      consignmentNumber: "5666306",
      labelUrl: "https://api.unifaun.com/rs-extapi/v1/shipments/5666306/pdfs",
      test: true,
    });
    expect(n.calls.map((c) => [c.method, c.url])).toEqual([["POST", "https://api.unifaun.com/rs-extapi/v1/shipments"]]);
    const body = n.calls[0].body as { printConfig: unknown; shipment: Record<string, unknown> };
    expect(body.printConfig).toMatchObject({ target1Media: "laser-a5", target1Type: "pdf" });
    expect(body.shipment).toEqual({
      sender: { quickId: "1", name: "Butikk AS", address1: "Lagerveien 2", zipcode: "0150", city: "Oslo", country: "NO", phone: "+4722334455", mobile: "+4722334455", email: "post@butikk.no" },
      receiver: { name: "Kari Nordmann", address1: "Fjellgata 48", zipcode: "0566", city: "Oslo", country: "NO", phone: "+4799887766", mobile: "+4799887766", email: "kari@example.no" },
      agent: { quickId: "74383" },
      service: { id: "P19", addons: [{ id: "NOTSMS" }, { id: "NOTEMAIL" }] },
      parcels: [{ copies: 1, weight: 1.8, contents: "Goods", valuePerParcel: true }],
      orderNo: "1042",
      senderReference: "1042-2",
      test: true,
    });
  });

  it("books a live shipment without the test mark and asks the carrier to collect it", async () => {
    const n = nshift({
      "/pickup-bookings": () => json([{ id: "884213", partnerId: "PLAB", status: "CONFIRMED", bookingNo: "PN-77341209", shipmentIds: ["5666306"] }], 201),
      "/shipments": () => json(printed, 201),
    });
    const booked = await createNshiftAdapter(n.fetcher).book!(context("live"), { ...request, collection: { date: "2026-11-06", readyTime: "12:00", closeTime: "16:00" } });
    expect(booked.test).toBe(false);
    expect(booked.collection).toEqual({ booked: true, confirmation: "PN-77341209", problem: null });
    expect((n.calls[0].body as { shipment: Record<string, unknown> }).shipment.test).toBeUndefined();
    expect(n.calls[1].body).toEqual({
      shipmentIds: ["5666306"],
      pickupDate: "2026-11-06",
      pickupTimeFrom: "12:00",
      pickupTimeTo: "16:00",
      location: "Lagerveien 2",
      contact: { name: "Butikk AS", phone: "+4722334455", email: "post@butikk.no" },
    });
    // A collection the carrier refuses leaves the shipment booked and says why.
    const refused = nshift({
      "/pickup-bookings": () => json([{ type: "error", messageCode: "NotSupported", message: "Service P19 has no pickup booking." }], 422),
      "/shipments": () => json(printed, 201),
    });
    const again = await createNshiftAdapter(refused.fetcher).book!(context("live"), { ...request, collection: { date: "2026-11-06", readyTime: "12:00", closeTime: "16:00" } });
    expect(again.trackingNumber).toBe("00370724763442660381");
    expect(again.collection).toEqual({ booked: false, confirmation: null, problem: "nShift did not accept the shipment: Service P19 has no pickup booking." });
  });

  it("carries a commercial invoice across a customs border, and refuses one without its lines", async () => {
    const abroad = { ...request, pickupPointId: undefined, serviceId: "P18", to: { ...request.to, postalCode: "11120", city: "Stockholm", country: "SE" } };
    await expect(createNshiftAdapter(nshift({}).fetcher).book!(context(), abroad)).rejects.toThrow(/customs/);
    const n = nshift({ "/shipments": () => json(printed, 201) });
    const customs = { incoterm: "DAP" as const, currency: "NOK", invoiceNumber: "F-77", invoiceDate: "2026-11-05", lines: [{ hsCode: "61091000", origin: "PT", valueMinor: 39800, description: "T-shirt", quantity: 2, weightGrams: 400 }] };
    const booked = await createNshiftAdapter(n.fetcher).book!(context(), { ...abroad, customs });
    expect(booked.customs).toEqual({ declared: true, reference: null, problem: null });
    expect((n.calls[0].body as { shipment: Record<string, unknown> }).shipment.customsDeclaration).toEqual({
      printSet: ["proforma"],
      invoiceType: "standard",
      invoiceNo: "F-77",
      currencyCode: "NOK",
      termCode: "DAP",
      importExportType: "permanent",
      sourceCountryCode: "NO",
      destinationCountryCode: "SE",
      lines: [{ copies: 2, valuesPerItem: false, statNo: "61091000", value: 398, contents: "T-shirt", netWeight: 0.4, grossWeight: 0.4, sourceCountryCode: "PT" }],
    });
  });

  it("says what nShift found wrong with a shipment, and what is missing before asking it", async () => {
    const n = nshift({
      "/shipments": () =>
        json(
          [
            { message: "maximum value (35) exceeded", messageCode: "MaximumFlt", field: "ParcelGroup_Weight", type: "ignorable" },
            { message: "Not valid postal code", messageCode: "ZipCode", field: "Address_Zipcode", type: "error" },
          ],
          422,
        ),
    });
    await expect(createNshiftAdapter(n.fetcher).book!(context(), request)).rejects.toThrow("nShift did not accept the shipment: Not valid postal code (Address_Zipcode)");
    await expect(createNshiftAdapter(n.fetcher).book!(context("test", { senderQuickId: "" }), request)).rejects.toThrow(/quick id/);
    await expect(createNshiftAdapter(n.fetcher).book!(context(), { ...request, serviceId: "" })).rejects.toThrow(/service/);
  });

  it("books a return label of the store's return service, from the shopper to the store", async () => {
    const n = nshift({ "/shipments": () => json([{ ...printed[0], id: "5666400", parcels: [{ parcelNo: "RET123" }] }], 201) });
    const booked = await createNshiftAdapter(n.fetcher).bookReturn!(context("live"), {
      returnReference: "1042-R1",
      serviceId: "P24",
      from: request.to,
      to: request.from,
      parcels: [{ weightGrams: 900 }],
    });
    expect(booked).toEqual({ trackingNumber: "RET123", trackingUrl: null, consignmentNumber: "5666400", labelUrl: "https://api.unifaun.com/rs-extapi/v1/shipments/5666400/pdfs", test: false, price: null });
    const shipment = (n.calls[0].body as { shipment: Record<string, unknown> }).shipment;
    expect(shipment.service).toEqual({ id: "P24", normalShipment: false, returnShipment: true });
    expect(shipment.sender).toMatchObject({ name: "Kari Nordmann", zipcode: "0566" });
    expect(shipment.receiver).toMatchObject({ quickId: "1", name: "Butikk AS" });
  });

  it("reads the shipment's status by parcel number, then by shipment number, and cancels a shipment", async () => {
    const n = nshift({
      "/shipments-history": () =>
        json({ minDelay: 100, page: 0, totalPages: 1, shipments: [{ id: "5666306", status: "DELIVERING", changed: "2026-11-06T09:12:00.000+0100", parcels: [{ parcelNo: "00370724763442660381" }] }] }),
    });
    const adapter = createNshiftAdapter(n.fetcher);
    expect(await adapter.track!(context(), "00370724763442660381")).toEqual([{ at: "2026-11-06T09:12:00.000+01:00", status: "DELIVERING", description: "Arrived at the pickup point" }]);
    expect(n.calls[0].url).toBe("https://api.unifaun.com/rs-extapi/v1/shipments-history?page=0&searchField=parcelNo&searchValue=00370724763442660381");
    const empty = nshift({ "/shipments-history": () => json({ shipments: [] }) });
    expect(await createNshiftAdapter(empty.fetcher).track!(context(), "X1")).toEqual([]);
    expect(empty.calls.map((c) => new URL(c.url).searchParams.get("searchField"))).toEqual(["parcelNo", "shipmentNo"]);

    const cancelled = nshift({ "/shipments/5666306": (_b, method) => (method === "DELETE" ? json(null, 204) : json(null, 405)) });
    expect(await createNshiftAdapter(cancelled.fetcher).cancel!(context(), { trackingNumber: "00370724763442660381", consignmentNumber: "5666306" })).toEqual({ ok: true });
    expect(cancelled.calls[0]).toMatchObject({ method: "DELETE", url: "https://api.unifaun.com/rs-extapi/v1/shipments/5666306" });
    expect(await createNshiftAdapter(nshift({}).fetcher).cancel!(context(), { trackingNumber: "x", consignmentNumber: "1" })).toMatchObject({ ok: false, problem: expect.stringMatching(/already be cancelled/) });
    expect(await createNshiftAdapter(nshift({}).fetcher).cancel!(context(), { trackingNumber: "x", consignmentNumber: null })).toMatchObject({ ok: false });
  });

  it("makes the label again as a PDF when it is printed, only from nShift's own shipment addresses", async () => {
    const n = nshift({ "/pdfs": () => json([{ id: "1", description: "Waybill", pdf: Buffer.from("%PDF-1.4 waybill").toString("base64") }, { id: "2", description: "Label", pdf: PDF }]) });
    const pdf = await fetchNshiftLabel(context(), "https://api.unifaun.com/rs-extapi/v1/shipments/5666306/pdfs", n.fetcher);
    expect(Buffer.from(pdf!).toString()).toBe("%PDF-1.4 nshift label");
    expect(n.calls[0]).toMatchObject({ method: "POST", url: "https://api.unifaun.com/rs-extapi/v1/shipments/5666306/pdfs?inlinePdf=true" });
    expect(n.calls[0].body).toMatchObject({ target1Media: "laser-a5", target1Type: "pdf" });
    expect(await fetchNshiftLabel(context(), "https://evil.example/rs-extapi/v1/shipments/1/pdfs", n.fetcher)).toBeNull();
    expect(isNshiftUrl("https://api.unifaun.com/rs-extapi/v1/shipments/1/pdfs/../../addresses")).toBe(false);
  });
});

describe("nShift's pure parts", () => {
  it("reads addon codes as the owner types them", () => {
    expect(addonCodes(" notsms,NOTEMAIL ; notsms  x!y ")).toEqual(["NOTSMS", "NOTEMAIL"]);
    expect(addonCodes(undefined)).toEqual([]);
  });

  it("leaves a checkout without options, or for a postal code it does not know, empty", () => {
    expect(parseCheckout({ deliveryCheckoutId: "x+1", invalidPostalCode: true, options: [] }, "NOK")).toEqual({ checkoutId: "x+1", invalidPostalCode: true, options: [] });
    expect(parseCheckout(null, "EUR").options).toEqual([]);
  });

  it("prices in minor units of the currency asked for, rounded once", () => {
    expect(parseCheckout({ options: [{ id: "a", name: "A", serviceId: "S1", priceValue: 49.995, agents: [] }] }, "eur").options[0]).toMatchObject({ priceMinor: 5000, currency: "EUR" });
  });

  it("tells the owner plainly what a status means", () => {
    expect(nshiftProblem(429)).toMatch(/slow down/);
    expect(nshiftProblem(500)).toMatch(/not answering/);
    expect(nshiftProblem(400, { code: "MISSING", message: "Missing fetch id argument" })).toBe("nShift did not accept the request: Missing fetch id argument");
  });
});
