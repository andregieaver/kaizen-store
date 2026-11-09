import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { kaizenLifeLinkKeys } from "./env";
import { bearerOf, checkLinkRequest, FLOW_ISSUER, LIFE_ISSUER, linkEmail, signLinkRequest } from "./kaizen-life-jwt";

const pair = () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
};
const LIFE = pair();
const OTHER = pair();
const NOW = new Date("2026-11-09T10:00:00Z");
const PATH = "/api/kaizen-life/v1/work-summary";
const BODY = JSON.stringify({ lifeUserId: "7d1e2c64-6f0a-4b55-9d3e-2a3b4c5d6e7f" });

const signed = (over: Partial<Parameters<typeof signLinkRequest>[0]> = {}) =>
  signLinkRequest({ issuer: LIFE_ISSUER, audience: FLOW_ISSUER, path: PATH, body: BODY, privateKeyPem: LIFE.privateKeyPem, now: NOW, ...over });
const check = (token: string, over: Partial<Parameters<typeof checkLinkRequest>[1]> = {}) =>
  checkLinkRequest(token, { issuer: LIFE_ISSUER, audience: FLOW_ISSUER, path: PATH, body: BODY, publicKeyPem: LIFE.publicKeyPem, now: NOW, ...over });

describe("signed requests between Kaizena Flow and Kaizen Life", () => {
  it("takes a request signed by the sender for this door and this body, within its minute", () => {
    const result = check(signed({ jti: "a".repeat(32) }));
    expect(result).toEqual({ ok: true, jti: "a".repeat(32), expiresAt: new Date("2026-11-09T10:01:00Z") });
    expect(check(signed(), { now: new Date("2026-11-09T10:00:59Z") }).ok).toBe(true);
  });

  it("refuses another key, another party, another door, another body", () => {
    expect(check(signed({ privateKeyPem: OTHER.privateKeyPem }))).toEqual({ ok: false, reason: "signature" });
    expect(check(signed({ issuer: FLOW_ISSUER, audience: LIFE_ISSUER }))).toEqual({ ok: false, reason: "party" });
    expect(check(signed({ path: "/api/kaizen-life/v1/unlink" }))).toEqual({ ok: false, reason: "door" });
    expect(check(signed({ body: JSON.stringify({ lifeUserId: "someone-else" }) }))).toEqual({ ok: false, reason: "body" });
  });

  it("refuses an expired request, one from the future, and anything tampered with", () => {
    expect(check(signed(), { now: new Date("2026-11-09T10:01:01Z") })).toEqual({ ok: false, reason: "expired" });
    expect(check(signed({ now: new Date("2026-11-09T10:01:00Z") }))).toEqual({ ok: false, reason: "early" });
    const [head, , sig] = signed().split(".");
    const forged = Buffer.from(JSON.stringify({ iss: LIFE_ISSUER, aud: FLOW_ISSUER, htu: PATH, bsh: "x", iat: 0, exp: 9e9, jti: "b".repeat(32) })).toString("base64url");
    expect(check(`${head}.${forged}.${sig}`)).toEqual({ ok: false, reason: "signature" });
    expect(check("not.a.token!")).toEqual({ ok: false, reason: "malformed" });
    expect(check("")).toEqual({ ok: false, reason: "malformed" });
    const none = `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${forged}.${sig}`;
    expect(check(none)).toEqual({ ok: false, reason: "malformed" });
  });

  it("reads a bearer token and compares emails as both apps do", () => {
    expect(bearerOf("Bearer abc.def.ghi")).toBe("abc.def.ghi");
    expect(bearerOf("bearer   abc")).toBe("abc");
    expect(bearerOf("Basic abc")).toBeNull();
    expect(bearerOf(null)).toBeNull();
    expect(linkEmail("  André@HumanWeb.no ")).toBe("andré@humanweb.no");
  });

  it("reads the keys from one-line variables, and refuses the wrong kind", () => {
    const oneLine = (pem: string) => pem.trim().replace(/\n/g, "\\n");
    const keys = kaizenLifeLinkKeys({ KAIZEN_LIFE_LINK_PRIVATE_KEY: oneLine(LIFE.privateKeyPem), KAIZEN_LIFE_LINK_PUBLIC_KEY: oneLine(OTHER.publicKeyPem) });
    expect(keys?.privateKey).toBe(LIFE.privateKeyPem.trim());
    expect(keys?.lifePublicKey).toBe(OTHER.publicKeyPem.trim());
    expect(kaizenLifeLinkKeys({ KAIZEN_LIFE_LINK_PRIVATE_KEY: LIFE.privateKeyPem })).toBeNull();
    expect(() => kaizenLifeLinkKeys({ KAIZEN_LIFE_LINK_PRIVATE_KEY: OTHER.publicKeyPem, KAIZEN_LIFE_LINK_PUBLIC_KEY: OTHER.publicKeyPem })).toThrow(
      /PKCS#8/,
    );
  });
});
