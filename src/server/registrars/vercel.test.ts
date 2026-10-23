import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { vercelRegistrar } = await import("./vercel");
const { VercelError } = await import("../vercel");
const { RegistrarError } = await import("./types");
const { readRdap } = await import("../domain-health");

/** A fake Vercel: answers by path, and keeps what it was asked. */
function fake(answers: Record<string, unknown | Error>) {
  const asked: { path: string; init?: RequestInit }[] = [];
  const call = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    asked.push({ path, init });
    const key = Object.keys(answers).find((k) => path.startsWith(k));
    if (!key) throw new VercelError("Not found", 404, "not_found");
    const answer = answers[key];
    if (answer instanceof Error) throw answer;
    return answer as T;
  };
  return { call, asked };
}

describe("Vercel's Registrar API as a registrar (D315 4.1)", () => {
  it("searches and reads the answers as Vercel gives them (read 23 October 2026)", async () => {
    const { call, asked } = fake({
      "/v1/registrar/domains/search": {
        results: [
          { domain: "nordiskbutikk.shop", available: true, years: 1, price: 2.99, renewalPrice: 38.39, premium: false },
          { domain: "google.com", available: false },
        ],
      },
    });
    const results = await vercelRegistrar(call).search(["nordiskbutikk.shop", "google.com"]);
    expect(results).toEqual([
      { domain: "nordiskbutikk.shop", available: true, premium: false, years: 1, price: 2.99, renewalPrice: 38.39 },
      { domain: "google.com", available: false, premium: false, years: null, price: null, renewalPrice: null },
    ]);
    expect(JSON.parse(String(asked[0].init?.body))).toEqual({ domains: ["nordiskbutikk.shop", "google.com"] });
  });

  it("reads a price, and refuses one without numbers", async () => {
    const ok = fake({ "/v1/registrar/domains/x.shop/price": { years: 1, purchasePrice: 2.99, renewalPrice: "38.39", transferPrice: 59.99 } });
    expect(await vercelRegistrar(ok.call).price("x.shop")).toEqual({ years: 1, purchase: 2.99, renewal: 38.39, transfer: 59.99, currency: "USD" });
    const bad = fake({ "/v1/registrar/domains/x.shop/price": {} });
    await expect(vercelRegistrar(bad.call).price("x.shop")).rejects.toBeInstanceOf(RegistrarError);
  });

  it("buys with the expected price and the registrant, and follows the order", async () => {
    const { call, asked } = fake({
      "/v1/registrar/domains/x.shop/buy": { orderId: "ord_1" },
      "/v1/registrar/orders/ord_1": { orderId: "ord_1", status: "failed", domains: [{ domainName: "x.shop", status: "failed", error: { code: "price_mismatch" } }] },
    });
    const reg = vercelRegistrar(call);
    const contact = { firstName: "Kari", lastName: "Nordmann", email: "kari@example.no", phone: "+4722334455", address1: "Gate 1", city: "Oslo", state: "", zip: "0150", country: "NO" };
    expect(await reg.buy("x.shop", { years: 1, expectedPrice: 2.99, autoRenew: true, contact })).toEqual({ orderId: "ord_1" });
    expect(JSON.parse(String(asked[0].init?.body))).toMatchObject({ years: 1, expectedPrice: 2.99, autoRenew: true, contactInformation: { country: "NO" } });
    expect(await reg.order("ord_1")).toEqual({ orderId: "ord_1", status: "failed", error: "price_mismatch" });
  });

  it("turns Vercel's errors into the registrar's, and a verification asked too soon into 'not known'", async () => {
    const { call } = fake({
      "/v1/registrar/domains/x.shop/contact-verification": new VercelError("Bought too recently", 400, "bought_too_recently"),
      "/v1/registrar/domains/y.shop/contact-verification": { verified: "true" },
      "/v1/registrar/domains/z.shop/auth-code": new VercelError("Domain is locked", 400, "domain_locked"),
    });
    const reg = vercelRegistrar(call);
    expect(await reg.contactVerified("x.shop")).toBeNull();
    expect(await reg.contactVerified("y.shop")).toBe(true);
    await expect(reg.authCode("z.shop")).rejects.toMatchObject({ message: "Domain is locked", code: "domain_locked" });
  });

  it("reads a domain's registration, and none for a domain the team doesn't hold", async () => {
    const { call } = fake({ "/v5/domains/x.shop": { domain: { expiresAt: 1798761600000, boughtAt: 1767225600000, renew: true, nameservers: ["ns1.vercel-dns.com"] } } });
    const reg = vercelRegistrar(call);
    expect(await reg.domain("x.shop")).toEqual({ expiresAt: "2027-01-01T00:00:00.000Z", boughtAt: "2026-01-01T00:00:00.000Z", renews: true, nameservers: ["ns1.vercel-dns.com"] });
    expect(await reg.domain("other.shop")).toBeNull();
  });
});

describe("RDAP (D315 5.3)", () => {
  it("reads the registrar and the expiry", () => {
    expect(
      readRdap({
        events: [{ eventAction: "registration", eventDate: "2020-01-01T00:00:00Z" }, { eventAction: "expiration", eventDate: "2027-03-01T00:00:00Z" }],
        entities: [{ roles: ["registrar"], vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "Domeneshop AS"]]] }],
      }),
    ).toEqual({ registrar: "Domeneshop AS", expiresAt: "2027-03-01T00:00:00.000Z" });
    expect(readRdap({})).toEqual({ registrar: null, expiresAt: null });
  });
});
