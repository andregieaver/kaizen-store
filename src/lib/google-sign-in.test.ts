import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { authorizeUrl, challengeOf, checkIdToken, idTokenClaims, openState, sealState, shopSlugsOk } from "./google-sign-in";
import { googleEnv } from "./env";

/** Sign in with Google's pure parts (D375): the sealed state, Google's address, and the ID token's checks. */

const key = randomBytes(32);
const R = () => randomBytes(32).toString("base64url");
const value = { state: R(), verifier: R(), nonce: R(), store: "demo-store", market: "no" };
const jwt = (claims: Record<string, unknown>) => `${Buffer.from('{"alg":"RS256"}').toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
const CLIENT = "123-abc.apps.googleusercontent.com";
const now = 1_800_000_000_000;
const good = { iss: "https://accounts.google.com", aud: CLIENT, azp: CLIENT, exp: now / 1000 + 600, iat: now / 1000, nonce: "n-1", email: "Kari@Example.com", email_verified: true };

describe("the state cookie", () => {
  it("opens what it sealed, and nothing altered, foreign or over", () => {
    const sealed = sealState(key, value, now);
    expect(openState(key, sealed, now)).toMatchObject(value);
    expect(openState(randomBytes(32), sealed, now)).toBeNull();
    expect(openState(key, `${sealed}x`, now)).toBeNull();
    expect(openState(key, sealed, now + 11 * 60_000)).toBeNull();
    const [body, sig] = sealed.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), store: "other" })).toString("base64url");
    expect(openState(key, `${forged}.${sig}`, now)).toBeNull();
  });

  it("takes only slugs shaped as addresses", () => {
    expect(shopSlugsOk("demo-store", "no-en-eur")).toBe(true);
    expect(shopSlugsOk("../x", "no")).toBe(false);
    expect(shopSlugsOk("demo", "https://evil.example")).toBe(false);
  });
});

describe("Google's address", () => {
  it("asks only for the email, with PKCE and a nonce", () => {
    const url = new URL(authorizeUrl({ clientId: CLIENT, redirectUri: "https://kaizenaflow.com/api/auth/google/callback", state: value.state, verifier: value.verifier, nonce: value.nonce }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")).toBe("openid email");
    expect(url.searchParams.get("code_challenge")).toBe(challengeOf(value.verifier));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("nonce")).toBe(value.nonce);
  });
});

describe("the ID token", () => {
  const check = (claims: Record<string, unknown>) => checkIdToken(idTokenClaims(jwt(claims)), { clientId: CLIENT, nonce: "n-1", now });

  it("gives the verified email, lower case", () => {
    expect(check(good)).toBe("kari@example.com");
  });

  it("refuses another issuer, client, nonce, a token over, an unverified email or none", () => {
    expect(check({ ...good, iss: "https://evil.example" })).toBeNull();
    expect(check({ ...good, aud: "other.apps.googleusercontent.com" })).toBeNull();
    expect(check({ ...good, azp: "other" })).toBeNull();
    expect(check({ ...good, nonce: "n-2" })).toBeNull();
    expect(check({ ...good, exp: now / 1000 - 120 })).toBeNull();
    expect(check({ ...good, email_verified: false })).toBeNull();
    expect(check({ ...good, email: undefined })).toBeNull();
    expect(checkIdToken(idTokenClaims("not.a-jwt"), { clientId: CLIENT, nonce: "n-1", now })).toBeNull();
  });
});

describe("the client's settings", () => {
  it("is off without both, and refuses an id that is not Google's", () => {
    expect(googleEnv({})).toBeNull();
    expect(googleEnv({ GOOGLE_CLIENT_ID: CLIENT })).toBeNull();
    expect(googleEnv({ GOOGLE_CLIENT_ID: CLIENT, GOOGLE_CLIENT_SECRET: "s" })).toEqual({ clientId: CLIENT, clientSecret: "s" });
    expect(() => googleEnv({ GOOGLE_CLIENT_ID: "x", GOOGLE_CLIENT_SECRET: "s" })).toThrow();
  });
});
