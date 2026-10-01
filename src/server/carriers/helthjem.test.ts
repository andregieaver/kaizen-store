import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createHelthjemAdapter, fetchHelthjemLabel, forgetHelthjemTokens } from "./helthjem";

const context = (environment: "test" | "live" = "test", extra: Record<string, string> = {}) => ({
  storeId: "s",
  environment,
  details: { clientId: "cid", shopId: "16", homeSolutionId: "114", collectSolutionId: "86", ...extra },
  secrets: { clientSecret: "shh" },
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const token = { token: "TOK", expires_in: 86400, token_type: "Bearer" };

/** A stand-in for Helthjem: a token, then whatever the route answers. */
function helthjem(routes: Record<string, (body: Record<string, unknown> | null) => Response>) {
  const calls: { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> | null }[] = [];
  const fetcher = vi.fn(async (url: string, init: RequestInit = {}) => {
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ url: String(url), method: init.method ?? "GET", headers: (init.headers ?? {}) as Record<string, string>, body });
    if (String(url).endsWith("/auth/oauth2/v1/token")) return json(token);
    const route = Object.keys(routes).find((r) => String(url).includes(r));
    return route ? routes[route](body) : json({}, 404);
  });
  return { fetcher: fetcher as unknown as typeof fetch, calls };
}

beforeEach(() => forgetHelthjemTokens());

describe("Helthjem's connection", () => {
  it("gets a token with the client credentials and keeps it for the next call", async () => {
    const h = helthjem({ "/addresses/find/single": () => json({ productName: "HELTHJEM" }) });
    const adapter = createHelthjemAdapter(h.fetcher);
    expect(await adapter.check(context("test"))).toEqual({ ok: true });
    expect(await adapter.check(context("test"))).toEqual({ ok: true });
    const tokenCalls = h.calls.filter((c) => c.url.endsWith("/token"));
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0].url).toBe("https://api.pre.helthjem.no/auth/oauth2/v1/token");
    expect(tokenCalls[0].body).toEqual({ client_id: "cid", client_secret: "shh", grant_type: "client_credentials" });
    expect(h.calls.find((c) => c.url.includes("/addresses/"))!.headers.Authorization).toBe("Bearer TOK");
  });

  it("calls the real API when live", async () => {
    const h = helthjem({ "/addresses/find/single": () => json({ productName: "HELTHJEM" }) });
    await createHelthjemAdapter(h.fetcher).check(context("live"));
    expect(h.calls[0].url).toBe("https://api.helthjem.no/auth/oauth2/v1/token");
  });

  it("accepts the credentials and shop even when the sample address is not covered", async () => {
    const h = helthjem({ "/addresses/find/single": () => json({ errorKey: "no.carrier.support", statusCode: 400 }, 400) });
    expect(await createHelthjemAdapter(h.fetcher).check(context())).toEqual({ ok: true });
  });

  it("says plainly when the credentials or the shop are refused, or details are missing", async () => {
    const refused = createHelthjemAdapter((async (url: string) => (String(url).endsWith("/token") ? json({}, 401) : json({}, 404))) as unknown as typeof fetch);
    expect(await refused.check(context())).toMatchObject({ ok: false, problem: expect.stringMatching(/client id and secret/) });
    const noShop = helthjem({ "/addresses/find/single": () => json({ errorKey: "no.access.shop.id" }, 403) });
    expect(await createHelthjemAdapter(noShop.fetcher).check(context())).toMatchObject({ ok: false, problem: expect.stringMatching(/shop id/) });
    expect(await createHelthjemAdapter(helthjem({}).fetcher).check(context("test", { shopId: "" }))).toMatchObject({ ok: false, problem: expect.stringMatching(/shop id/) });
  });

  it("asks a refused token again once", async () => {
    let tokens = 0;
    let first = true;
    const fetcher = vi.fn(async (url: string) => {
      if (String(url).endsWith("/token")) return json({ ...token, token: `T${++tokens}` });
      if (first) {
        first = false;
        return json({}, 401);
      }
      return json({ productName: "HELTHJEM" });
    });
    expect(await createHelthjemAdapter(fetcher as unknown as typeof fetch).check(context())).toEqual({ ok: true });
    expect(tokens).toBe(2);
  });

  it("finds service points with the store's own transport solution", async () => {
    const h = helthjem({ "/service-points/nearby": () => json({ freightProducts: [{ servicePoints: [{ servicePointExternalId: "30694", servicePointName: "Joker" }] }] }) });
    const points = await createHelthjemAdapter(h.fetcher).pickupPoints!(context(), { name: "", street: "", postalCode: "0561", city: "", country: "NO" });
    expect(points.map((p) => p.id)).toEqual(["30694"]);
    expect(h.calls.find((c) => c.url.includes("/service-points/"))!.body).toEqual({ shopId: 16, transportSolutionId: 86, zipCode: "0561", countryCode: "NO" });
    await expect(createHelthjemAdapter(h.fetcher).pickupPoints!(context("test", { collectSolutionId: "" }), { name: "", street: "", postalCode: "0561", city: "", country: "NO" })).rejects.toThrow(/service point delivery/);
  });

  const to = { name: "Kari", street: "Fjellgata 48", postalCode: "0566", city: "Oslo", country: "NO", phone: "53582094", email: "kari@example.com" };
  const from = { name: "Shop", street: "Akersgata 55", postalCode: "0180", city: "Oslo", country: "NO" };

  it("checks coverage for a home delivery, books it, and gives back the shipment number and where the label is", async () => {
    const h = helthjem({
      "/addresses/find/single": () => json({ productName: "HELTHJEM" }),
      "/parcels/v1/bookings": () => json({ orderId: 1, shipmentId: "(401)70724763442660381", freightProductId: 1 }),
    });
    const booked = await createHelthjemAdapter(h.fetcher).book!(context(), { orderReference: "ORD-1", serviceId: "home", from, to, parcels: [{ weightGrams: 1000 }] });
    expect(booked).toEqual({ trackingNumber: "70724763442660381", trackingUrl: null, consignmentNumber: "(401)70724763442660381", labelUrl: "https://api.pre.helthjem.no/parcels/v1/labels/(401)70724763442660381/unified-large", test: true });
    const order = h.calls.map((c) => c.url);
    expect(order.findIndex((u) => u.includes("/addresses/"))).toBeLessThan(order.findIndex((u) => u.includes("/bookings")));
    expect(h.calls.find((c) => c.url.endsWith("/bookings"))!.body).toMatchObject({ shopId: 16, transportSolutionId: 114 });
  });

  it("books a service point with the point as a party, without a coverage check", async () => {
    const h = helthjem({ "/parcels/v1/bookings": () => json({ orderId: 1, shipmentId: "(401)7072", freightProductId: 55 }) });
    await createHelthjemAdapter(h.fetcher).book!(context(), { orderReference: "ORD-1", serviceId: "collect", from, to, parcels: [{ weightGrams: 1000 }], pickupPointId: "30694" });
    expect(h.calls.some((c) => c.url.includes("/addresses/"))).toBe(false);
    const body = h.calls.find((c) => c.url.endsWith("/bookings"))!.body as { transportSolutionId: number; parties: Record<string, unknown>[] };
    expect(body.transportSolutionId).toBe(86);
    expect(body.parties.at(-1)).toEqual({ type: "servicePoint", id: "30694", countryCode: "NO" });
  });

  it("books nothing when Helthjem does not reach the address, and says so", async () => {
    const h = helthjem({ "/addresses/find/single": () => json({ errorKey: "no.carrier.support", statusCode: 400 }, 400), "/parcels/v1/bookings": () => json({ shipmentId: "x" }) });
    await expect(createHelthjemAdapter(h.fetcher).book!(context(), { orderReference: "O", serviceId: "home", from, to, parcels: [{ weightGrams: 1000 }] })).rejects.toThrow(/does not deliver to that address/);
    expect(h.calls.some((c) => c.url.endsWith("/bookings"))).toBe(false);
  });

  it("refuses a booking with what is missing, before calling Helthjem", async () => {
    const h = helthjem({});
    await expect(createHelthjemAdapter(h.fetcher).book!(context("test", { homeSolutionId: "" }), { orderReference: "O", serviceId: "home", from, to, parcels: [{ weightGrams: 1 }] })).rejects.toThrow(/transport solution for home delivery/);
    expect(h.fetcher).not.toHaveBeenCalled();
  });

  it("follows a parcel by its shipment number", async () => {
    const h = helthjem({ "/tracking/fetch/": () => json([{ items: [{ events: [{ eventTime: "2026-06-05 09:00:00", eventType: { apiKey: "001", description: "Registered" } }] }] }]) });
    const events = await createHelthjemAdapter(h.fetcher).track!(context(), "70724763442660381");
    expect(events).toMatchObject([{ status: "001" }]);
    expect(h.calls.at(-1)!.url).toBe("https://api.pre.helthjem.no/parcels/v1/tracking/fetch/70724763442660381/EN/false");
  });
});

describe("Helthjem's labels", () => {
  it("are fetched with the store's token, only from Helthjem's own host for the environment", async () => {
    const h = helthjem({ "/labels/": () => new Response("%PDF-1.4", { status: 200 }) });
    const pdf = await fetchHelthjemLabel(context("test"), "https://api.pre.helthjem.no/parcels/v1/labels/(401)7072/unified-large", h.fetcher);
    expect(new TextDecoder().decode(pdf!)).toBe("%PDF-1.4");
    expect(h.calls.at(-1)!.headers).toMatchObject({ Authorization: "Bearer TOK", Accept: "application/pdf" });
    // Never another host, nor the other environment's, whatever the address says.
    expect(await fetchHelthjemLabel(context("test"), "https://evil.example/labels/x", h.fetcher)).toBeNull();
    expect(await fetchHelthjemLabel(context("test"), "https://api.helthjem.no/parcels/v1/labels/x/unified-large", h.fetcher)).toBeNull();
  });
});
