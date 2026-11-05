import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { lockerChoice, readLockerChoice } from "@/lib/instabox";

import { createInstaboxAdapter, fetchInstaboxLabel } from "./instabox";

const context = (environment: "test" | "live" = "test", details: Record<string, string> = {}) => ({ storeId: "s", environment, details, secrets: { apiKey: "KEY" } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** A stand-in for Instabee's API: whatever the route answers. */
function instabee(routes: Record<string, (body: Record<string, unknown> | null) => Response>) {
  const calls: { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> | null }[] = [];
  const fetcher = vi.fn(async (url: string, init: RequestInit = {}) => {
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ url: String(url), method: init.method ?? "GET", headers: (init.headers ?? {}) as Record<string, string>, body });
    const route = Object.keys(routes).find((r) => String(url).includes(r));
    return route ? routes[route](body) : json({ status: 404, message: "Not found" }, 404);
  });
  return { fetcher: fetcher as unknown as typeof fetch, calls };
}

const options = {
  availabilityToken: "019d-token",
  deliveryOptions: [
    {
      sortCode: "IN456xYz",
      type: "LOCKER",
      deliveryOption: "Coop Majorna",
      address: { street: "Gata 9", postalCode: "41463", city: "Göteborg", countryCode: "SE" },
      distance: { unit: "meter", value: 950 },
    },
    {
      sortCode: "IN123wOx9dJ",
      type: "LOCKER",
      deliveryOption: "Central Station",
      address: { street: "Centralplan 15", postalCode: "11120", city: "Stockholm", countryCode: "SE" },
      distance: { unit: "meter", value: 177 },
      openHours: [{ date: "2026-11-05", isOpen: true, open: "00:00", close: "24:00", textLocal: "Today" }],
    },
    { sortCode: "HOME1", type: "HOME", deliveryOption: "Home" },
  ],
};

describe("Instabox's connection", () => {
  it("sends the API key with Instabee's version on every call, to the sandbox when testing", async () => {
    const i = instabee({ "/delivery-options": () => json(options, 201) });
    expect(await createInstaboxAdapter(i.fetcher).check(context())).toEqual({ ok: true });
    expect(i.calls[0].url).toBe("https://sandbox-api.integration.instabee.com/availability/countries/SE/postal-codes/11120/delivery-options?brand=instabox&product=LOCKER_EXPRESS");
    expect(i.calls[0].headers).toMatchObject({ Authorization: "ApiKey KEY", "Accept-Version": "1.0.0" });
    const live = instabee({ "/delivery-options": () => json(options, 201) });
    await createInstaboxAdapter(live.fetcher).check(context("live"));
    expect(live.calls[0].url.startsWith("https://api.integration.instabee.com/")).toBe(true);
    const refused = instabee({ "/delivery-options": () => json({ status: 401, message: "Invalid API key" }, 401) });
    expect(await createInstaboxAdapter(refused.fetcher).check(context())).toMatchObject({ ok: false, problem: expect.stringMatching(/API key/) });
  });

  it("lists the lockers near a postal code, nearest first, each keeping its sort code and the token", async () => {
    const i = instabee({ "/delivery-options": () => json(options, 201) });
    const lockers = await createInstaboxAdapter(i.fetcher).pickupPoints!(context(), { name: "", street: "", postalCode: "111 20", city: "", country: "SE" });
    expect(lockers).toEqual([
      {
        id: "IN123wOx9dJ~019d-token",
        name: "Central Station",
        address: { name: "Central Station", street: "Centralplan 15", postalCode: "11120", city: "Stockholm", country: "SE" },
        openingHours: "Today 00:00–24:00",
        distanceMeters: 177,
      },
      { id: "IN456xYz~019d-token", name: "Coop Majorna", address: { name: "Coop Majorna", street: "Gata 9", postalCode: "41463", city: "Göteborg", country: "SE" }, distanceMeters: 950 },
    ]);
    // A postal code Instabox does not reach has none.
    expect(await createInstaboxAdapter(instabee({}).fetcher).pickupPoints!(context(), { name: "", street: "", postalCode: "98132", city: "", country: "SE" })).toEqual([]);
  });

  const request = {
    orderReference: "1042",
    parcelReference: "1042-2",
    serviceId: "locker",
    pickupPointId: "IN123wOx9dJ~019d-token",
    from: { name: "Shop", street: "", postalCode: "", city: "", country: "SE" },
    to: { name: "Anna Svensson", street: "Upplandsgatan 42", postalCode: "113 27", city: "Stockholm", country: "SE", phone: "+46 70-123 45 67", email: "anna@example.com" },
    parcels: [{ weightGrams: 1800, lengthMm: 300, widthMm: 200, heightMm: 100 }],
  };
  const made = { orderId: "019aba69-order", parcelId: "SHOP000000123456", links: { label: "https://api.integration.instabee.com/presigned/labels?token=x", tracking: "https://track.instabox.com/SHOP000000123456" }, state: "FINALIZED" };

  it("books the locker the shopper chose with its token, confirmed as packed", async () => {
    const i = instabee({ "/orders": () => json(made) });
    const booked = await createInstaboxAdapter(i.fetcher).book!(context("test", { collectionPointId: "WH-2" }), request);
    expect(booked).toEqual({
      trackingNumber: "SHOP000000123456",
      trackingUrl: "https://track.instabox.com/SHOP000000123456",
      consignmentNumber: "019aba69-order",
      labelUrl: "https://sandbox-api.integration.instabee.com/orders/019aba69-order/labels?fileFormat=pdf&template=a6",
      test: true,
    });
    const call = i.calls.find((c) => c.url.endsWith("/orders"))!;
    expect(call.method).toBe("PUT");
    expect(call.body).toEqual({
      brand: "instabox",
      product: "LOCKER_EXPRESS",
      availabilityToken: "019d-token",
      parcelPackingConfirmed: true,
      recipient: { name: "Anna Svensson", email: "anna@example.com", phone: "+46701234567", street: "Upplandsgatan 42", postalCode: "11327", city: "Stockholm", countryCode: "SE" },
      deliveryOption: { sortCode: "IN123wOx9dJ" },
      dispatch: { collectionPointId: "WH-2" },
      cart: { orderNumber: "1042-2", totalWeightInGrams: 1800, parcel: { weightGram: 1800, lengthMm: 300, widthMm: 200, heightMm: 100 } },
    });
  });

  it("asks for the lockers again when the choice kept no token, and refuses a locker no longer offered", async () => {
    const i = instabee({ "/delivery-options": () => json(options, 201), "/orders": () => json(made) });
    await createInstaboxAdapter(i.fetcher).book!(context(), { ...request, pickupPointId: "IN123wOx9dJ" });
    expect(i.calls.map((c) => c.method)).toEqual(["GET", "PUT"]);
    expect(i.calls[1].body).toMatchObject({ availabilityToken: "019d-token", deliveryOption: { sortCode: "IN123wOx9dJ" } });
    await expect(createInstaboxAdapter(i.fetcher).book!(context(), { ...request, pickupPointId: "GONE1" })).rejects.toThrow(/no longer offers the locker/);
  });

  it("says what is missing before calling Instabox, and what an expired choice means", async () => {
    const adapter = createInstaboxAdapter(instabee({ "/orders": () => json({ status: 422, message: "Token expired" }, 422) }).fetcher);
    await expect(adapter.book!(context(), { ...request, to: { ...request.to, phone: "" } })).rejects.toThrow(/phone number/);
    await expect(adapter.book!(context(), { ...request, to: { ...request.to, country: "FI" } })).rejects.toThrow(/Sweden, Norway and Denmark/);
    await expect(adapter.book!(context(), request)).rejects.toThrow(/no longer held/);
  });

  it("books home delivery after Instabee confirms the postal code, with the phone's country code (D458)", async () => {
    const i = instabee({
      "product=HOME_DELIVERY": () => json({ availabilityToken: "home-tok", deliveryOptions: [{ sortCode: "HD123", type: "HOME" }], showAsOptionInCheckout: true }),
      "/orders": () => json(made),
    });
    const home = { ...request, serviceId: "home", pickupPointId: undefined, to: { ...request.to, phone: "070-123 45 67" } };
    const booked = await createInstaboxAdapter(i.fetcher).book!(context(), home);
    expect(booked.trackingNumber).toBe("SHOP000000123456");
    expect(i.calls[0].url).toBe("https://sandbox-api.integration.instabee.com/availability/countries/SE/postal-codes/11327/delivery-options?brand=instabox&product=HOME_DELIVERY");
    expect(i.calls[1].body).toMatchObject({
      brand: "instabox",
      product: "HOME_DELIVERY",
      availabilityToken: "home-tok",
      deliveryOption: { sortCode: "HD123" },
      recipient: { phone: "+46701234567" },
    });
    // A postal code Instabox does not reach at home: nothing is booked.
    const far = instabee({ "product=HOME_DELIVERY": () => json({ status: 404, message: "Not serviceable" }, 404), "/orders": () => json(made) });
    await expect(createInstaboxAdapter(far.fetcher).book!(context(), home)).rejects.toThrow(/does not deliver home/);
    expect(far.calls.some((c) => c.method === "PUT")).toBe(false);
    await expect(createInstaboxAdapter(far.fetcher).book!(context(), { ...home, to: { ...home.to, phone: "1234" } })).rejects.toThrow(/too short/);
  });

  it("books a return at the locker nearest the shopper that takes returns, with the label fetched when printed (D458)", async () => {
    const i = instabee({ "product=LOCKER_RETURN": () => json(options, 201), "/orders": () => json({ ...made, orderId: "ret-1", parcelId: "SHOPRET0000001" }) });
    const returned = await createInstaboxAdapter(i.fetcher).bookReturn!(context(), {
      returnReference: "1042-R1",
      serviceId: "locker_return",
      from: { name: "Anna Svensson", street: "Upplandsgatan 42", postalCode: "11327", city: "Stockholm", country: "SE", email: "anna@example.com", phone: "0701234567" },
      to: { name: "Shop AB", street: "Lagervägen 1", postalCode: "12345", city: "Stockholm", country: "SE" },
      parcels: [{ weightGrams: 900 }],
    });
    expect(returned).toEqual({
      trackingNumber: "SHOPRET0000001",
      trackingUrl: "https://track.instabox.com/SHOP000000123456",
      consignmentNumber: "ret-1",
      labelUrl: "https://sandbox-api.integration.instabee.com/orders/ret-1/labels?fileFormat=pdf&template=a6",
      test: true,
      price: null,
    });
    expect(i.calls[0].url).toContain("product=LOCKER_RETURN");
    expect(i.calls[1].body).toEqual({
      brand: "instabox",
      product: "LOCKER_RETURN",
      availabilityToken: "019d-token",
      sender: { name: "Anna Svensson", email: "anna@example.com", phone: "+46701234567", street: "Upplandsgatan 42", postalCode: "11327", city: "Stockholm", countryCode: "SE" },
      deliveryOption: { sortCode: "IN123wOx9dJ" },
      cart: { orderNumber: "1042-R1", totalWeightInGrams: 900, parcel: { weightGram: 900, estimatedSize: "SMALL" } },
    });
    const none = instabee({ "product=LOCKER_RETURN": () => json({ status: 404 }, 404) });
    await expect(
      createInstaboxAdapter(none.fetcher).bookReturn!(context(), { returnReference: "R", serviceId: "locker_return", from: { name: "A", street: "S 1", postalCode: "98132", city: "Kiruna", country: "SE", email: "a@b.se" }, to: { name: "Shop", street: "x", postalCode: "1", city: "y", country: "SE" }, parcels: [{ weightGrams: 1 }] }),
    ).rejects.toThrow(/no locker for returns/);
  });

  it("has no cancel: Instabee documents none", () => {
    expect(createInstaboxAdapter(instabee({}).fetcher).cancel).toBeUndefined();
  });

  it("fetches the label as a PDF with the key, only from Instabee and the store's environment", async () => {
    const fetcher = vi.fn(async () => new Response("%PDF-1.4 instabox", { status: 200 })) as unknown as typeof fetch;
    const url = "https://sandbox-api.integration.instabee.com/orders/019aba69-order/labels?fileFormat=pdf&template=a6";
    expect(Buffer.from((await fetchInstaboxLabel(context(), url, fetcher))!).toString()).toBe("%PDF-1.4 instabox");
    expect(await fetchInstaboxLabel(context("live"), url, fetcher)).toBeNull();
    expect(await fetchInstaboxLabel(context(), "https://evil.example/orders/x/labels", fetcher)).toBeNull();
    const notPdf = vi.fn(async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch;
    expect(await fetchInstaboxLabel(context(), url, notPdf)).toBeNull();
  });
});

describe("a locker choice", () => {
  it("keeps the sort code with its token, and the sort code alone when they would not fit", () => {
    expect(readLockerChoice(lockerChoice("IN123", "tok"))).toEqual({ sortCode: "IN123", token: "tok" });
    expect(lockerChoice("IN123", "t".repeat(90))).toBe("IN123");
    expect(readLockerChoice("IN123")).toEqual({ sortCode: "IN123", token: null });
  });
});
