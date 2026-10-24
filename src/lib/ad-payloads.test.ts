import { describe, expect, it } from "vitest";

import { adRequest, normalisePhone, type Conversion } from "./ad-payloads";
import { cleanAdSignals, readAdSignals } from "./ad-signals";

const base: Conversion = {
  event: "purchase",
  eventId: "0b7a0000-0000-4000-8000-000000000001",
  time: 1_760_000_000,
  currency: "EUR",
  value: 49.9,
  lines: [{ id: "MUG-1", quantity: 2, price: 24.95 }],
  signals: { fbp: "fb.1.1760000000000.123456", ttclid: "E.C.P.abcdefghij", epik: "dj0yJnU9abcdefgh", gclid: "Cj0KCQabcdefgh" },
  pageUrl: "https://shop.example/",
};

describe("ad conversions (D303 I2)", () => {
  it("keeps only the known ids, each by its shape", () => {
    expect(cleanAdSignals({ fbp: "fb.1.1760000000000.123456", gclid: "x", email: "a@b.c", ttclid: "E.C.P.abcdefghij" })).toEqual({
      fbp: "fb.1.1760000000000.123456",
      ttclid: "E.C.P.abcdefghij",
    });
    expect(cleanAdSignals("nope")).toEqual({});
    expect(readAdSignals("_fbp=fb.1.1760000000000.42; other=1", "?gclid=Cj0KCQabcdefgh&utm_source=x")).toEqual({
      fbp: "fb.1.1760000000000.42",
      gclid: "Cj0KCQabcdefgh",
    });
  });

  it("writes Meta's purchase with the order id as the event id and no personal data at the standard level", () => {
    const r = adRequest({ platform: "meta", accountId: "1234567", token: "EAAB-secret" }, base)!;
    expect(r.url).toMatch(/^https:\/\/graph\.facebook\.com\/v21\.0\/1234567\/events\?access_token=EAAB-secret$/);
    const body = JSON.parse(r.body);
    expect(body.data[0]).toMatchObject({ event_name: "Purchase", event_id: base.eventId, user_data: { fbp: base.signals.fbp } });
    expect(body.data[0].custom_data).toMatchObject({ currency: "EUR", value: 49.9, order_id: base.eventId });
    expect(JSON.stringify(body)).not.toMatch(/"em"|"ph"|client_ip/);
  });

  it("adds only hashes at the enhanced level", () => {
    const r = adRequest({ platform: "meta", accountId: "1234567", token: "t0ken-123" }, { ...base, hashes: { email: "a".repeat(64) } })!;
    expect(JSON.parse(r.body).data[0].user_data.em).toEqual(["a".repeat(64)]);
  });

  it("writes GA4, TikTok and Pinterest in their own words, and skips what a platform cannot take", () => {
    const ga4 = JSON.parse(adRequest({ platform: "ga4", accountId: "G-ABC123", token: "secret12" }, base)!.body);
    expect(ga4.events[0]).toMatchObject({ name: "purchase", params: { transaction_id: base.eventId, currency: "EUR", value: 49.9 } });
    const tiktok = adRequest({ platform: "tiktok", accountId: "C4ABCDEFGHIJ1234567", token: "tt-token-1" }, base)!;
    expect(tiktok.headers["Access-Token"]).toBe("tt-token-1");
    expect(JSON.parse(tiktok.body).data[0]).toMatchObject({ event: "CompletePayment", user: { ttclid: base.signals.ttclid } });
    const pin = adRequest({ platform: "pinterest", accountId: "549755813888", token: "pin-token" }, base)!;
    expect(JSON.parse(pin.body).data[0]).toMatchObject({ event_name: "checkout", user_data: { click_id: base.signals.epik } });
    expect(adRequest({ platform: "pinterest", accountId: "549755813888", token: "pin-token" }, { ...base, event: "begin_checkout" })).toBeNull();
    expect(adRequest({ platform: "meta", accountId: "1234567", token: "t0ken-123" }, { ...base, signals: {} })).toBeNull();
  });

  it("normalises a phone to digits with its country code", () => {
    expect(normalisePhone("+47 912 34 567")).toBe("4791234567");
    expect(normalisePhone("0047 91234567")).toBe("4791234567");
    expect(normalisePhone("12")).toBeNull();
  });
});
