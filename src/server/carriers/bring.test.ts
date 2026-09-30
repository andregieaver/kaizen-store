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
