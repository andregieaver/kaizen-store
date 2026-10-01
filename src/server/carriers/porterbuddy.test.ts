import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createPorterbuddyAdapter, fetchPorterbuddyLabel, senderOf } from "./porterbuddy";

const context = (environment: "test" | "live" = "test") => ({
  storeId: "s",
  environment,
  details: { senderName: "Shop", senderStreet: "Keysers gate 3", senderPostalCode: "0165", senderCity: "Oslo", senderEmail: "a@b.no", senderPhone: "12345678", pickupHours: "10:00-17:00", pickupDays: "1-7" },
  secrets: { apiKey: "KEY" },
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const windows = {
  deliveryWindows: [{ product: "delivery", start: "2099-01-01T17:00:00+01:00", end: "2099-01-01T19:00:00+01:00", price: { fractionalDenomination: 14900, currency: "NOK" }, expiresAt: "2099-01-01T10:00:00+01:00", token: "tok" }],
};
const call = (fetcher: ReturnType<typeof vi.fn>, n = 0) => {
  const [url, init] = fetcher.mock.calls[n] as [string, RequestInit];
  return { url, init, body: init.body ? JSON.parse(String(init.body)) : null, headers: init.headers as Record<string, string> };
};

describe("Porterbuddy's connection", () => {
  it("checks the key with an availability request on the test API, or the real one when live", async () => {
    const fetcher = vi.fn(async () => json({ deliveryWindows: [] }));
    const adapter = createPorterbuddyAdapter(fetcher as unknown as typeof fetch);
    expect(await adapter.check(context("test"))).toEqual({ ok: true });
    expect(await adapter.check(context("live"))).toEqual({ ok: true });
    expect(call(fetcher, 0).url).toBe("https://api.porterbuddy-test.com/availability");
    expect(call(fetcher, 0).headers["x-api-key"]).toBe("KEY");
    expect(call(fetcher, 1).url).toBe("https://api.porterbuddy.com/availability");
  });

  it("says plainly when the key is refused or Porterbuddy does not answer", async () => {
    const refused = createPorterbuddyAdapter((async () => json({}, 403)) as unknown as typeof fetch);
    expect(await refused.check(context())).toMatchObject({ ok: false, problem: expect.stringMatching(/API key/) });
    const down = createPorterbuddyAdapter((async () => { throw new Error("network"); }) as unknown as typeof fetch);
    expect(await down.check(context())).toMatchObject({ ok: false, problem: expect.stringMatching(/did not answer/) });
  });

  it("asks for the windows to a postal code and returns them as options", async () => {
    const fetcher = vi.fn(async () => json(windows));
    const adapter = createPorterbuddyAdapter(fetcher as unknown as typeof fetch);
    const options = await adapter.rates!(context(), { from: senderOf(context()), to: { name: "", street: "", postalCode: "0678", city: "", country: "NO" }, parcels: [{ weightGrams: 1500 }], currency: "NOK", products: ["delivery"] });
    expect(options).toMatchObject([{ serviceId: "delivery", priceMinor: 14900, window: { token: "tok" } }]);
    const { body } = call(fetcher);
    expect(body).toMatchObject({ products: ["delivery"], destinationAddress: { postalCode: "0678", country: "Norway" }, originAddress: { streetName: "Keysers gate", streetNumber: "3" }, parcels: [{ weightGrams: 1500 }] });
    expect(body.pickupWindows.length).toBeGreaterThan(0);
  });

  it("throws a plain sentence, not a raw error, when availability fails", async () => {
    const adapter = createPorterbuddyAdapter((async () => json({}, 503)) as unknown as typeof fetch);
    await expect(adapter.rates!(context(), { from: senderOf(context()), to: { name: "", street: "", postalCode: "0678", city: "", country: "NO" }, parcels: [{ weightGrams: 1 }], currency: "NOK" })).rejects.toThrow(/not answering/);
  });

  it("places the order for the chosen window with an idempotency key, and gives back the number, tracking page and label address", async () => {
    const fetcher = vi.fn(async () =>
      json({ orderId: "42", pickupTime: "2099-01-01T15:00:00+01:00", _links: { labelInfo: { href: "https://api.porterbuddy-test.com/order/42/label" }, userInformation: { href: "https://www.porterbuddy-test.com/orders/recipient_tracking/x" } } }),
    );
    const adapter = createPorterbuddyAdapter(fetcher as unknown as typeof fetch);
    const booked = await adapter.book!(context(), {
      orderReference: "ORD-1",
      serviceId: "delivery",
      from: senderOf(context()),
      to: { name: "Roger", street: "Høyenhallveien 25", postalCode: "0678", city: "Oslo", country: "NO", phone: "65789832", email: "r@example.com" },
      parcels: [{ weightGrams: 2000 }],
      window: { start: "2099-01-01T17:00:00+01:00", end: "2099-01-01T19:00:00+01:00", token: "tok", expiresAt: "2099-01-01T10:00:00+01:00" },
    });
    expect(booked).toEqual({ trackingNumber: "42", trackingUrl: "https://www.porterbuddy-test.com/orders/recipient_tracking/x", consignmentNumber: "42", labelUrl: "https://api.porterbuddy-test.com/order/42/label", test: true });
    const { url, init, headers, body } = call(fetcher);
    expect(url).toBe("https://api.porterbuddy-test.com/order");
    expect(init.method).toBe("POST");
    expect(headers["Idempotency-Key"]).toBe("ORD-1");
    expect(body.destination.deliveryWindow.token).toBe("tok");
  });

  it("refuses to place an order with what is missing, before calling Porterbuddy", async () => {
    const fetcher = vi.fn();
    const adapter = createPorterbuddyAdapter(fetcher as unknown as typeof fetch);
    await expect(
      adapter.book!(context(), { orderReference: "X", serviceId: "delivery", from: senderOf(context()), to: { name: "R", street: "Kirkeveien", postalCode: "0678", city: "Oslo", country: "NO" }, parcels: [{ weightGrams: 1 }] }),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("follows an order by its status", async () => {
    const adapter = createPorterbuddyAdapter((async () => json({ orderId: "42", orderStatus: "delivered", statusUpdatedAt: "2099-01-01T18:00:00Z" })) as unknown as typeof fetch);
    expect(await adapter.track!(context(), "42")).toMatchObject([{ status: "delivered" }]);
  });
});

describe("Porterbuddy's labels", () => {
  it("are fetched through the label info and the document it points to, only on Porterbuddy's hosts", async () => {
    const fetcher = vi.fn(async (url: string) =>
      String(url).endsWith("/label") ? json({ shipmentLabelUrl: "https://api.porterbuddy-test.com/order/42/label/tok" }) : new Response("%PDF-1.4", { status: 200 }),
    );
    const pdf = await fetchPorterbuddyLabel(context(), "https://api.porterbuddy-test.com/order/42/label", fetcher as unknown as typeof fetch);
    expect(new TextDecoder().decode(pdf!)).toBe("%PDF-1.4");
    expect((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ "x-api-key": "KEY" });
    // Never to another host, whatever the address says.
    expect(await fetchPorterbuddyLabel(context(), "https://evil.example/order/42/label", fetcher as unknown as typeof fetch)).toBeNull();
    const redirected = vi.fn(async () => json({ shipmentLabelUrl: "https://evil.example/x" }));
    expect(await fetchPorterbuddyLabel(context(), "https://api.porterbuddy.com/order/1/label", redirected as unknown as typeof fetch)).toBeNull();
  });
});
