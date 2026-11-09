import { describe, expect, it } from "vitest";

import { adRequest } from "./ad-payloads";
import { encodeConsent } from "./cookie-consent";
import { allowsMarketing, gclidOf, platformConversion, signupAdSignals } from "./platform-ad-conversions";

const visitor = "0b7a0000-0000-4000-8000-000000000009";
const consent = (marketing: boolean, version = "statistics+marketing") =>
  encodeConsent({ visitor, version, choices: { preferences: false, statistics: true, marketing } });
const cookies: Record<string, string> = {
  _fbp: "fb.1.1760000000000.123456",
  _fbc: "fb.1.1760000000000.IwAR0abcdefgh",
  _gcl_aw: "GCL.1760000000.Cj0KCQabcdefgh",
  _ttp: "abcdefghijklmnop",
  other: "nothing",
};
const jar = (name: string) => cookies[name];

describe("Kaizena Flow's sign-ups and paid plans as ad conversions (D523)", () => {
  it("keeps a sign-up's ids only when marketing was allowed, asked with marketing among the choices", () => {
    expect(allowsMarketing(undefined)).toBe(false);
    expect(allowsMarketing(consent(false))).toBe(false);
    // An older choice made when the site asked about statistics only is no.
    expect(allowsMarketing(consent(true, "statistics"))).toBe(false);
    expect(allowsMarketing(consent(true))).toBe(true);
    expect(signupAdSignals(jar, consent(false))).toBeNull();
    expect(signupAdSignals(jar, consent(true))).toEqual({
      fbp: cookies._fbp,
      fbc: cookies._fbc,
      gclid: "Cj0KCQabcdefgh",
      ttp: cookies._ttp,
    });
    expect(gclidOf("GCL.1760000000.Cj0KCQabcdefgh")).toBe("Cj0KCQabcdefgh");
    expect(gclidOf("garbage")).toBeUndefined();
  });

  it("sends a sign-up as a registration, without money or lines, under the request's id", () => {
    const c = platformConversion({
      event: "sign_up",
      requestId: "0b7a0000-0000-4000-8000-000000000001",
      at: new Date("2026-11-09T10:00:00Z"),
      signals: { fbp: cookies._fbp, gclid: "Cj0KCQabcdefgh" },
      site: "https://kaizenaflow.com",
    });
    expect(c).toMatchObject({ eventId: "0b7a0000-0000-4000-8000-000000000001", clientId: "0b7a0000-0000-4000-8000-000000000001", lines: [], pageUrl: "https://kaizenaflow.com/sign-up" });
    const meta = JSON.parse(adRequest({ platform: "meta", accountId: "1234567", token: "t0ken-123" }, c)!.body);
    expect(meta.data[0]).toMatchObject({ event_name: "CompleteRegistration", event_id: c.eventId, user_data: { fbp: cookies._fbp } });
    expect(meta.data[0].custom_data).toBeUndefined();
    const ga4 = JSON.parse(adRequest({ platform: "ga4", accountId: "G-ABCDE12345", token: "secret-123" }, c)!.body);
    expect(ga4).toMatchObject({ client_id: c.clientId, events: [{ name: "sign_up", params: { method: "email", gclid: "Cj0KCQabcdefgh" } }] });
    expect(ga4.events[0].params.value).toBeUndefined();
    const pinterest = JSON.parse(adRequest({ platform: "pinterest", accountId: "123456789", token: "t0ken-123" }, { ...c, signals: { epik: "dj0yJnU9abcdefgh" } })!.body);
    expect(pinterest.data[0]).toMatchObject({ event_name: "signup" });
  });

  it("sends the first paid plan as a subscription, net of VAT, its sale as the event id and the request as GA4's client", () => {
    const c = platformConversion({
      event: "plan_paid",
      requestId: "0b7a0000-0000-4000-8000-000000000001",
      saleId: "0b7a0000-0000-4000-8000-000000000002",
      at: new Date("2026-11-20T10:00:00Z"),
      netMinor: 39_900,
      currency: "NOK",
      plan: "plan-1",
      signals: { fbp: cookies._fbp },
      emailHash: "a".repeat(64),
      site: "https://kaizenaflow.com",
    });
    expect(c).toMatchObject({ eventId: "0b7a0000-0000-4000-8000-000000000002", value: 399, lines: [{ id: "plan-1", quantity: 1, price: 399 }], hashes: { email: "a".repeat(64) } });
    const meta = JSON.parse(adRequest({ platform: "meta", accountId: "1234567", token: "t0ken-123" }, c)!.body);
    expect(meta.data[0]).toMatchObject({ event_name: "Subscribe", user_data: { em: ["a".repeat(64)] }, custom_data: { currency: "NOK", value: 399, order_id: c.eventId } });
    const ga4 = JSON.parse(adRequest({ platform: "ga4", accountId: "G-ABCDE12345", token: "secret-123" }, c)!.body);
    expect(ga4).toMatchObject({ client_id: "0b7a0000-0000-4000-8000-000000000001", events: [{ name: "purchase", params: { transaction_id: c.eventId, value: 399 } }] });
    const tiktok = JSON.parse(adRequest({ platform: "tiktok", accountId: "ABCDEFGHIJKLMNOP", token: "t0ken-123" }, c)!.body);
    expect(tiktok.data[0]).toMatchObject({ event: "Subscribe", properties: { order_id: c.eventId } });
    // Never a raw email: only the hash leaves.
    expect(JSON.stringify(meta)).not.toMatch(/@/);
  });
});
