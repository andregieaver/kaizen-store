import { generateKeyPairSync, randomBytes, sign } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CANVA_HOME,
  CANVA_SCOPES,
  CANVA_STATE_MINUTES,
  assetName,
  canvaAuthorizeUrl,
  canvaSaid,
  codeChallenge,
  correlationHash,
  designSize,
  editLink,
  editedFileName,
  importedFileName,
  isCanvaFile,
  newCorrelation,
  openCanvaState,
  randomToken,
  readCanvaKeys,
  readCanvaReturn,
  readDesigns,
  readThumbnailAddress,
  safeBack,
  sealCanvaState,
  thumbnailAddress,
} from "./canva";

const key = randomBytes(32);
const account = "0b0e1f3a-2b4c-4d5e-8f60-718293a4b5c6";

describe("Canva's OAuth with PKCE (D898)", () => {
  it("sends the person to Canva's consent page with the scopes C1 needs, S256 and the state", () => {
    const url = new URL(canvaAuthorizeUrl({ clientId: "OC-abc", redirectUri: "https://kaizenaflow.com/api/integrations/canva/callback", state: "st", challenge: "ch" }));
    expect(url.origin + url.pathname).toBe("https://www.canva.com/api/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      code_challenge: "ch",
      code_challenge_method: "S256",
      scope: "asset:read asset:write design:meta:read design:content:read design:content:write profile:read",
      response_type: "code",
      client_id: "OC-abc",
      state: "st",
      redirect_uri: "https://kaizenaflow.com/api/integrations/canva/callback",
    });
    // Nothing beyond what C1 uses: no brand templates, folders or comments.
    expect(CANVA_SCOPES.some((scope) => /brandtemplate|folder|comment/.test(scope))).toBe(false);
  });

  it("works out the PKCE challenge RFC 7636 gives for its verifier", () => {
    expect(codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{64}$/);
  });

  it("opens only a state it sealed, unchanged and within a quarter of an hour", () => {
    const value = { state: randomToken(), account, back: "/admin/my-shop/media", verifier: randomToken() };
    const now = Date.parse("2026-11-25T10:00:00Z");
    const sealed = sealCanvaState(key, value, now);
    expect(openCanvaState(key, sealed, now + 60_000)).toMatchObject(value);
    expect(openCanvaState(key, sealed, now + CANVA_STATE_MINUTES * 60_000 + 1)).toBeNull();
    expect(openCanvaState(randomBytes(32), sealed, now)).toBeNull();
    const [body, signature] = sealed.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), back: "/admin/other/media" })).toString("base64url");
    expect(openCanvaState(key, `${forged}.${signature}`, now)).toBeNull();
    expect(openCanvaState(key, undefined, now)).toBeNull();
  });

  it("comes back only to an admin page of ours", () => {
    expect(safeBack("/admin/my-shop/media")).toBe("/admin/my-shop/media");
    expect(safeBack("/admin/platform/media")).toBe("/admin/platform/media");
    for (const bad of ["//evil.example/admin", "https://evil.example/admin", "/admin/../x", "/adminx", "/admin/a?b=c", "/s/shop", "", null, 42]) {
      expect(safeBack(bad)).toBe(CANVA_HOME);
    }
    // A sealed state never carries anything else.
    const sealed = sealCanvaState(key, { state: randomToken(), account, back: "//evil.example", verifier: randomToken() });
    expect(openCanvaState(key, sealed)).toBeNull();
  });
});

describe("Canva's answers and addresses (D898)", () => {
  it("reads both of Canva's error shapes", () => {
    expect(canvaSaid({ code: "invalid_grant", message: "Invalid refresh token" })).toEqual({ code: "invalid_grant", message: "Invalid refresh token" });
    expect(canvaSaid({ error: "invalid_client", error_description: "Bad secret" })).toEqual({ code: "invalid_client", message: "Bad secret" });
    expect(canvaSaid(null)).toEqual({ code: null, message: null });
  });

  it("keeps only designs that read as designs", () => {
    const designs = readDesigns([
      { id: "DAFVztcvd9z", title: "Summer sale", thumbnail: { url: "https://document-export.canva.com/a/thumbnail/0001.png", width: 595, height: 335 }, page_count: 2 },
      { id: "../../etc", title: "Bad" },
      "nonsense",
    ]);
    expect(designs.map((d) => d.id)).toEqual(["DAFVztcvd9z"]);
  });

  it("reads files only from Canva's export hosts, over HTTPS", () => {
    expect(isCanvaFile("https://document-export.canva.com/Vczz9/zF9vzVtdADc/2/thumbnail/0001.png?sig=x")).toBe(true);
    expect(isCanvaFile("https://export-download.canva.com/abc/1.png")).toBe(true);
    expect(isCanvaFile("http://export-download.canva.com/abc/1.png")).toBe(false);
    expect(isCanvaFile("https://export-download.canva.com.evil.example/1.png")).toBe(false);
    expect(isCanvaFile("https://user:pw@document-export.canva.com/1.png")).toBe(false);
    expect(isCanvaFile("https://www.canva.com/1.png")).toBe(false);
  });

  it("adds the correlation to an edit link on www.canva.com only", () => {
    const { correlation, hash } = newCorrelation();
    expect(correlation).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(hash).toBe(correlationHash(correlation));
    const link = editLink("https://www.canva.com/api/design/eyJhbGc/edit", correlation);
    expect(link).toBe(`https://www.canva.com/api/design/eyJhbGc/edit?correlation_state=${correlation}`);
    expect(editLink("https://evil.example/api/design/x/edit", correlation)).toBeNull();
    expect(editLink("http://www.canva.com/api/design/x/edit", correlation)).toBeNull();
    expect(editLink("https://www.canva.com/api/design/x/edit", "short")).toBeNull();
  });

  it("sizes a design like its picture, within Canva's limits", () => {
    expect(designSize(1600, 900)).toEqual({ width: 1600, height: 900 });
    expect(designSize(null, null)).toEqual({ width: 1080, height: 1080 });
    const huge = designSize(20_000, 10_000);
    expect(huge.width).toBeLessThanOrEqual(8000);
    expect(huge.width * huge.height).toBeLessThanOrEqual(25_000_000);
    expect(huge.width / huge.height).toBeCloseTo(2, 1);
    expect(designSize(10, 10)).toEqual({ width: 40, height: 40 });
    const thin = designSize(8000, 20);
    expect(thin.height).toBeGreaterThanOrEqual(40);
    expect(thin.width).toBeLessThanOrEqual(8000);
  });

  it("names assets and copies as Canva and the library take them", () => {
    expect([...assetName("a".repeat(80))]).toHaveLength(50);
    expect(assetName("\u0000‮  ")).toBe("picture");
    expect(assetName("Sommer-kampanje.webp")).toBe("Sommer-kampanje.webp");
    expect(editedFileName("hero-banner.webp")).toBe("hero-banner-canva.webp");
    expect(importedFileName("Black / Friday")).toBe("Black - Friday.webp");
    expect(importedFileName(undefined)).toBe("Canva design.webp");
  });
});

describe("The JWT Canva's Return button brings back (D898)", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const x = String(publicKey.export({ format: "jwk" }).x);
  const keys = readCanvaKeys({ keys: [{ kid: "k1", kty: "OKP", crv: "Ed25519", x }, { kid: "rsa", kty: "RSA", n: "abc", e: "AQAB" }] });
  const now = Date.parse("2026-11-25T10:00:00Z");
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const { correlation } = newCorrelation();
  const claims = { aud: "OC-abc", exp: now / 1000 + 3600, sub: "UAFdsa", team_id: "BAFteam", type: "rti", jti: "j1", design_id: "DAFVztcvd9z", correlation_state: correlation };
  const jwt = (payload: Record<string, unknown> = claims, header: Record<string, unknown> = { alg: "EdDSA", kid: "k1" }) => {
    const body = `${part(header)}.${part(payload)}`;
    return `${body}.${sign(null, Buffer.from(body), privateKey).toString("base64url")}`;
  };

  it("keeps only Canva's Ed25519 keys", () => {
    expect(keys).toEqual([{ kid: "k1", x }]);
  });

  it("reads a token Canva signed for our client, naming the design and our correlation", () => {
    expect(readCanvaReturn(jwt(), keys, { clientId: "OC-abc", now })).toEqual({
      ok: true,
      value: { designId: "DAFVztcvd9z", correlation, userId: "UAFdsa", teamId: "BAFteam" },
    });
  });

  it("refuses a token for another client, of another type, over, or naming something else", () => {
    expect(readCanvaReturn(jwt(), keys, { clientId: "OC-other", now })).toEqual({ ok: false, refusal: "audience" });
    expect(readCanvaReturn(jwt({ ...claims, type: "access" }), keys, { clientId: "OC-abc", now })).toEqual({ ok: false, refusal: "type" });
    expect(readCanvaReturn(jwt({ ...claims, exp: now / 1000 - 3600 }), keys, { clientId: "OC-abc", now })).toEqual({ ok: false, refusal: "expired" });
    expect(readCanvaReturn(jwt({ ...claims, design_id: "../x" }), keys, { clientId: "OC-abc", now })).toEqual({ ok: false, refusal: "claims" });
    expect(readCanvaReturn(jwt({ ...claims, correlation_state: "made-up" }), keys, { clientId: "OC-abc", now })).toEqual({ ok: false, refusal: "claims" });
  });

  it("refuses a token not signed by Canva's key", () => {
    const token = jwt();
    const [head, body] = token.split(".");
    const other = generateKeyPairSync("ed25519").privateKey;
    const forged = `${head}.${body}.${sign(null, Buffer.from(`${head}.${body}`), other).toString("base64url")}`;
    expect(readCanvaReturn(forged, keys, { clientId: "OC-abc", now })).toEqual({ ok: false, refusal: "signature" });
    const changed = `${head}.${part({ ...claims, design_id: "DAFother" })}.${token.split(".")[2]}`;
    expect(readCanvaReturn(changed, keys, { clientId: "OC-abc", now })).toEqual({ ok: false, refusal: "signature" });
    expect(readCanvaReturn(jwt(claims, { alg: "none", kid: "k1" }), keys, { clientId: "OC-abc", now })).toEqual({ ok: false, refusal: "malformed" });
    expect(readCanvaReturn(jwt(claims, { alg: "EdDSA", kid: "k9" }), keys, { clientId: "OC-abc", now })).toEqual({ ok: false, refusal: "unknown_key" });
    expect(readCanvaReturn("not.a.jwt!", keys, { clientId: "OC-abc", now })).toEqual({ ok: false, refusal: "malformed" });
  });
});

describe("Canva's thumbnails through our own address (D898)", () => {
  const link = "https://document-export.canva.com/Vczz9/zF9vzVtdADc/2/thumbnail/0001.png?signature=abc";
  const now = Date.parse("2026-11-25T10:00:00Z");

  it("hands out a signed address that reads back to Canva's link for a quarter of an hour", () => {
    const address = thumbnailAddress(key, link, now);
    expect(address).toMatch(/^\/api\/integrations\/canva\/thumbnail\?/);
    const params = new URL(address ?? "", "https://kaizenaflow.com").searchParams;
    expect(readThumbnailAddress(key, params, now + 60_000)).toBe(link);
    expect(readThumbnailAddress(key, params, now + 16 * 60_000)).toBeNull();
    expect(readThumbnailAddress(randomBytes(32), params, now)).toBeNull();
  });

  it("never signs or reads anything but Canva's file links", () => {
    expect(thumbnailAddress(key, "https://evil.example/x.png", now)).toBeNull();
    const params = new URL(thumbnailAddress(key, link, now) ?? "", "https://kaizenaflow.com").searchParams;
    params.set("u", Buffer.from("https://evil.example/x.png").toString("base64url"));
    expect(readThumbnailAddress(key, params, now)).toBeNull();
  });
});
