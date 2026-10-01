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

  it("follows a parcel, and has no price service or booking yet", async () => {
    const adapter = createPostnordAdapter((async () => json({ TrackingInformationResponse: { shipments: [{ items: [{ events: [{ eventTime: "2026-10-01T10:00:00", eventDescription: "Delivered" }] }] }] } })) as unknown as typeof fetch);
    expect(await adapter.track!(context(), "123")).toMatchObject([{ description: "Delivered" }]);
    expect(adapter.rates).toBeUndefined();
    expect(adapter.book).toBeUndefined();
  });
});
