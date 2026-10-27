import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));


import type { CarrierContext } from "@/lib/shipping-carriers";

import { createBringAdapter, fetchBringLabel } from "./bring";

const context: CarrierContext = {
  storeId: "s1",
  environment: "test",
  details: { customerNumber: "12345", apiUid: "me@shop.no", senderName: "Shop AS", senderStreet: "Lagerveien 2", senderPostalCode: "0150", senderCity: "Oslo" },
  secrets: { apiKey: "the-key" },
};

type Call = { url: string; init: RequestInit };
function fake(responses: { status?: number; body?: unknown; bytes?: string }[]) {
  const calls: Call[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses.shift() ?? { status: 500 };
    return new Response(next.bytes ?? JSON.stringify(next.body ?? {}), { status: next.status ?? 200 });
  }) as typeof fetch;
  return { fetcher, calls };
}

const guide = {
  consignments: [{ products: [{ id: "5600", guiInformation: { displayName: "Pakke levert hjem" }, price: { listPrice: { currencyCode: "NOK", priceWithoutAdditionalServices: { amountWithoutVAT: "100.00" } } } }] }],
};

describe("Bring's connection", () => {
  it("checks the user and key, then the agreement, with the store's own credentials", async () => {
    const { fetcher, calls } = fake([{ body: { pickupPoint: [] } }, { body: guide }]);
    expect(await createBringAdapter(fetcher).check(context)).toEqual({ ok: true });
    expect(calls[0].url).toContain("/pickuppoint/api/pickuppoint/NO/postalCode/0150");
    expect(calls[1].url).toBe("https://api.bring.com/shippingguide/api/v2/products");
    expect(calls[1].init.headers).toMatchObject({ "X-Mybring-API-Uid": "me@shop.no", "X-Mybring-API-Key": "the-key" });
    expect(JSON.parse(String(calls[1].init.body)).consignments[0].products[0].customerNumber).toBe("12345");
  });

  it("says when the key is refused, and when the customer number has no services", async () => {
    const refused = fake([{ status: 401 }]);
    expect(await createBringAdapter(refused.fetcher).check(context)).toMatchObject({ ok: false, problem: expect.stringMatching(/user or key/) });
    const empty = fake([{ body: {} }, { body: { consignments: [{ products: [] }] } }]);
    expect(await createBringAdapter(empty.fetcher).check(context)).toMatchObject({ ok: false, problem: expect.stringMatching(/customer number/) });
  });

  it("says so when Bring does not answer at all", async () => {
    const fetcher = (async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    expect(await createBringAdapter(fetcher).check(context)).toEqual({ ok: false, problem: "Bring did not answer. Try again in a moment." });
  });

  it("gives the services and prices for a parcel", async () => {
    const { fetcher } = fake([{ body: guide }]);
    const options = await createBringAdapter(fetcher).rates!(context, {
      from: { name: "Shop AS", street: "x", postalCode: "0150", city: "Oslo", country: "NO" },
      to: { name: "K", street: "y", postalCode: "1337", city: "Sandvika", country: "NO" },
      parcels: [{ weightGrams: 1000 }],
      currency: "NOK",
    });
    expect(options).toEqual([{ serviceId: "5600", carrier: "bring", name: "Pakke levert hjem", priceMinor: 10000, currency: "NOK" }]);
  });

  const request = {
    orderReference: "K-1",
    serviceId: "5600",
    from: { name: "Shop AS", street: "Lagerveien 2", postalCode: "0150", city: "Oslo", country: "NO" },
    to: { name: "K", street: "y", postalCode: "1337", city: "Sandvika", country: "NO" },
    parcels: [{ weightGrams: 1000 }],
  };
  const booked = { consignments: [{ confirmation: { consignmentNumber: "C1" }, packages: [{ packageNumber: "P1" }], links: { labels: "https://api.bring.com/labels/1" }, errors: [] }] };

  it("books in test mode by telling Bring it is a test, and in live mode by saying it is not", async () => {
    const test = fake([{ body: booked }]);
    const result = await createBringAdapter(test.fetcher).book!(context, request);
    expect(result).toEqual({ trackingNumber: "P1", trackingUrl: null, consignmentNumber: "C1", labelUrl: "https://api.bring.com/labels/1", test: true });
    expect(test.calls[0].url).toBe("https://api.bring.com/booking/api/create");
    expect(test.calls[0].init.headers).toMatchObject({ "X-Bring-Test-Indicator": "true" });

    const live = fake([{ body: booked }]);
    const real = await createBringAdapter(live.fetcher).book!({ ...context, environment: "live" }, request);
    expect(real.test).toBe(false);
    expect(live.calls[0].init.headers).toMatchObject({ "X-Bring-Test-Indicator": "false" });
  });

  it("raises what Bring objected to, as a sentence", async () => {
    const { fetcher } = fake([{ body: { consignments: [{ errors: [{ code: "1", messages: [{ message: "Unknown customer number" }] }] }] } }]);
    await expect(createBringAdapter(fetcher).book!(context, request)).rejects.toThrow("Unknown customer number");
    const down = fake([{ status: 503 }]);
    await expect(createBringAdapter(down.fetcher).book!(context, request)).rejects.toThrow(/not answering/);
  });

  it("tracks a parcel", async () => {
    const { fetcher, calls } = fake([{ body: { consignmentSet: [{ packageSet: [{ eventSet: [{ status: "DELIVERED", description: "Delivered", displayDate: "18.11.2022", displayTime: "14:05" }] }] }] } }]);
    const events = await createBringAdapter(fetcher).track!(context, "P1");
    expect(events[0].status).toBe("DELIVERED");
    expect(calls[0].url).toContain("q=P1");
  });
});

describe("the label", () => {
  it("is fetched with the agreement's keys, only from Bring", async () => {
    const { fetcher, calls } = fake([{ bytes: "%PDF-1.4" }]);
    const pdf = await fetchBringLabel(context, "https://api.bring.com/labels/1", fetcher);
    expect(new TextDecoder().decode(pdf!)).toBe("%PDF-1.4");
    expect(calls[0].init.headers).toMatchObject({ "X-Mybring-API-Key": "the-key", Accept: "application/pdf" });
    const other = fake([{ bytes: "x" }]);
    expect(await fetchBringLabel(context, "https://evil.example/labels/1", other.fetcher)).toBeNull();
    expect(other.calls).toHaveLength(0);
    expect(await fetchBringLabel(context, "https://api.bring.com/labels/2", fake([{ status: 404 }]).fetcher)).toBeNull();
  });
});

describe("customs lines on a booking (D343)", () => {
  const abroad = {
    orderReference: "K-9",
    serviceId: "0342",
    from: { name: "Shop AS", street: "Lagerveien 2", postalCode: "0150", city: "Oslo", country: "NO" },
    to: { name: "K", street: "Storgatan 1", postalCode: "11122", city: "Stockholm", country: "SE" },
    parcels: [{ weightGrams: 900 }],
  };
  const customs = {
    incoterm: "DAP" as const,
    currency: "SEK",
    invoiceNumber: "K-9",
    invoiceDate: "2026-10-27",
    lines: [{ hsCode: "6109100010", origin: "PT", valueMinor: 39_920, description: "T-skjorte", quantity: 2, weightGrams: 400 }],
  };
  const booked = { consignments: [{ confirmation: { consignmentNumber: "C9" }, packages: [{ packageNumber: "P9" }], links: {}, errors: [] }] };

  it("refuses a parcel across a customs border without its lines, before Bring is called", async () => {
    const { fetcher, calls } = fake([{ body: booked }]);
    await expect(createBringAdapter(fetcher).book!(context, abroad)).rejects.toThrow(/customs border/);
    const noCode = { ...customs, lines: [{ ...customs.lines[0], hsCode: "" }] };
    await expect(createBringAdapter(fetcher).book!(context, { ...abroad, customs: noCode })).rejects.toThrow(/T-skjorte has no HS code/);
    const noWeight = { ...customs, lines: [{ ...customs.lines[0], weightGrams: 0 }] };
    await expect(createBringAdapter(fetcher).book!(context, { ...abroad, customs: noWeight })).rejects.toThrow(/no weight/);
    expect(calls).toHaveLength(0);
  });

  it("declares the lines to Bring's Customs API after the booking, with the consignment it made", async () => {
    const { fetcher, calls } = fake([{ body: booked }, { body: { status: "ACCEPTED", processingId: "proc-1", error: null } }]);
    const result = await createBringAdapter(fetcher).book!(context, { ...abroad, customs });
    expect(result.customs).toEqual({ declared: true, reference: "proc-1", problem: null });
    expect(calls.map((c) => c.url)).toEqual(["https://api.bring.com/booking/api/create", "https://api.bring.com/customs/v1/declarations"]);
    expect(calls[1].init.headers).toMatchObject({ "X-Mybring-API-Key": "the-key", "X-Bring-Test-Indicator": "true" });
    const body = JSON.parse(String(calls[1].init.body));
    expect(body).toMatchObject({
      customerNumber: "12345",
      currencyCode: "SEK",
      shipment: { consignmentId: "C9", service: "0342", termsOfDelivery: { incotermsCode: "DAP", location: "Stockholm" } },
      exporter: { name: "Shop AS", countryCode: "NO" },
      importer: { name: "K", countryCode: "SE" },
      invoices: [{ invoiceNumber: "K-9", invoiceDate: "2026-10-27", amount: 399.2 }],
    });
    expect(body.customsDeclarations).toEqual([
      {
        numberOfPieces: 2,
        goodsDescription: "T-skjorte",
        customsArticleNumber: "6109100010",
        grossWeight: 0.4,
        netWeight: 0.4,
        amount: 399.2,
        countryCodeOrigin: "PT",
        salesOrder: { orderNumber: "K-9", articleNumber: "6109100010" },
      },
    ]);
  });

  it("keeps the booking and says why when the declaration is refused, or the service is not one the Customs API takes", async () => {
    const refused = fake([{ body: booked }, { body: { status: "FAILED", error: "Unknown customer" } }]);
    const r1 = await createBringAdapter(refused.fetcher).book!(context, { ...abroad, customs });
    expect(r1).toMatchObject({ trackingNumber: "P9", customs: { declared: false, problem: "Unknown customer" } });
    const other = fake([{ body: booked }]);
    const r2 = await createBringAdapter(other.fetcher).book!(context, { ...abroad, serviceId: "5600", customs });
    expect(r2.customs).toMatchObject({ declared: false, problem: expect.stringMatching(/Mybring/) });
    expect(other.calls).toHaveLength(1);
  });

  it("asks nothing of a parcel that stays inside one customs territory", async () => {
    const { fetcher, calls } = fake([{ body: booked }]);
    const result = await createBringAdapter(fetcher).book!(context, { ...abroad, to: { ...abroad.to, country: "NO", postalCode: "1337", city: "Sandvika" } });
    expect(result.customs).toBeUndefined();
    expect(calls).toHaveLength(1);
  });
});
