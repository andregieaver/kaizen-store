import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { checkEndpointUrl, signWebhook, TOLERANCE_SECONDS, verifyWebhook } from "./webhook-signature";

/** Signed events to an owner's endpoint (D354): the signature a receiver checks, and the addresses an endpoint may have. */
describe("signWebhook and verifyWebhook", () => {
  const secret = "whsec_test-secret";
  const body = JSON.stringify({ id: "x", topic: "order.paid", version: 1, data: { order: { total: 499 } } });
  const now = 1_800_000_000;

  it("signs the HMAC-SHA256 of the timestamp, a full stop and the body", () => {
    const expected = createHmac("sha256", secret).update(`${now}.${body}`).digest("hex");
    expect(signWebhook(secret, now, body)).toBe(`v1=${expected}`);
  });

  it("accepts its own signature over the raw body, and one of several", () => {
    const signature = signWebhook(secret, now, body);
    expect(verifyWebhook({ secret, signature, timestamp: String(now), body, now })).toBe(true);
    expect(verifyWebhook({ secret, signature: `v1=deadbeef, ${signature}`, timestamp: String(now), body, now })).toBe(true);
  });

  it("refuses another body, another secret, no signature and a stale or future timestamp", () => {
    const signature = signWebhook(secret, now, body);
    expect(verifyWebhook({ secret, signature, timestamp: String(now), body: `${body} `, now })).toBe(false);
    expect(verifyWebhook({ secret: "whsec_other", signature, timestamp: String(now), body, now })).toBe(false);
    expect(verifyWebhook({ secret, signature: null, timestamp: String(now), body, now })).toBe(false);
    expect(verifyWebhook({ secret, signature, timestamp: String(now), body, now: now + TOLERANCE_SECONDS + 1 })).toBe(false);
    expect(verifyWebhook({ secret, signature, timestamp: String(now), body, now: now - TOLERANCE_SECONDS - 1 })).toBe(false);
    expect(verifyWebhook({ secret, signature, timestamp: "soon", body, now })).toBe(false);
  });

  it("refuses a signature replayed with another timestamp", () => {
    const signature = signWebhook(secret, now, body);
    expect(verifyWebhook({ secret, signature, timestamp: String(now + 10), body, now: now + 10 })).toBe(false);
  });
});

describe("checkEndpointUrl", () => {
  it("takes an https address on a host name and hides its path", () => {
    expect(checkEndpointUrl(" https://hooks.example.com/kaizena/orders?key=1 ")).toEqual({ ok: true, url: "https://hooks.example.com/kaizena/orders?key=1", hint: "hooks.example.com/…" });
    expect(checkEndpointUrl("https://example.org")).toMatchObject({ ok: true, hint: "example.org" });
  });

  it("refuses http, a login, another port, a bare address and nonsense", () => {
    for (const bad of ["http://example.com/hook", "https://user:pw@example.com/", "https://example.com:8443/", "https://10.0.0.1/hook", "https://[::1]/", "https://localhost/", "not an address"]) {
      expect(checkEndpointUrl(bad).ok, bad).toBe(false);
    }
  });
});
