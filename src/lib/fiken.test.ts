import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  accessDue,
  codeChallenge,
  countryName,
  fikenAuthorizeUrl,
  FIKEN_STATE_MINUTES,
  idFromLocation,
  isFikenSlug,
  openFikenState,
  randomToken,
  saleNumberOf,
  sealFikenState,
} from "./fiken";
import { classifyFikenFailure, fikenFailureWords, fikenWords } from "./fiken-errors";

const key = randomBytes(32);
const value = { state: "s".repeat(43), store: "my-shop", account: "0b0e1f3a-2b4c-4d5e-8f60-718293a4b5c6", verifier: randomToken() };

describe("Fiken's OAuth2 with PKCE (D460)", () => {
  it("works out the challenge Fiken's documentation gives for its verifier", () => {
    expect(codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{64}$/);
  });

  it("sends the owner to Fiken's own page with the state and the S256 challenge", () => {
    const url = new URL(fikenAuthorizeUrl({ clientId: "app", redirectUri: "https://kaizenaflow.com/api/integrations/fiken/callback", state: "abc", challenge: "xyz" }));
    expect(url.origin + url.pathname).toBe("https://fiken.no/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "app",
      redirect_uri: "https://kaizenaflow.com/api/integrations/fiken/callback",
      state: "abc",
      code_challenge: "xyz",
      code_challenge_method: "S256",
    });
  });

  it("opens only a state cookie this server signed, unaltered and in time", () => {
    const now = Date.now();
    const sealed = sealFikenState(key, value, now);
    expect(openFikenState(key, sealed, now + 1000)).toMatchObject(value);
    expect(openFikenState(key, sealed, now + FIKEN_STATE_MINUTES * 60_000 + 1)).toBeNull();
    expect(openFikenState(randomBytes(32), sealed, now)).toBeNull();
    const [body, sig] = sealed.split(".");
    const other = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), store: "their-shop" })).toString("base64url");
    expect(openFikenState(key, `${other}.${sig}`, now)).toBeNull();
    expect(openFikenState(key, undefined, now)).toBeNull();
    expect(openFikenState(key, sealFikenState(key, { ...value, verifier: "short" }, now), now)).toBeNull();
  });

  it("refreshes an access token two minutes before it ends, and one with no end never", () => {
    const now = Date.now();
    expect(accessDue(new Date(now + 60_000), now)).toBe(true);
    expect(accessDue(new Date(now + 10 * 60_000), now)).toBe(false);
    expect(accessDue(null, now)).toBe(true);
  });
});

describe("Fiken's answers (D460)", () => {
  it("reads the id of what Fiken made from its Location", () => {
    expect(idFromLocation("https://api.fiken.no/api/v2/companies/hw/sales/2888156", "sales")).toBe(2888156);
    expect(idFromLocation("https://api.fiken.no/api/v2/companies/hw/contacts/77", "contacts")).toBe(77);
    expect(idFromLocation("https://api.fiken.no/api/v2/companies/hw/contacts/77", "sales")).toBeNull();
    expect(idFromLocation(null, "sales")).toBeNull();
  });

  it("takes only Fiken's own slugs, the document's own number, and English country names", () => {
    expect(isFikenSlug("human-web-as")).toBe(true);
    expect(isFikenSlug("../x")).toBe(false);
    expect(saleNumberOf(" 1042 ")).toBe("1042");
    expect(() => saleNumberOf("")).toThrow(RangeError);
    expect(countryName("no")).toBe("Norway");
    expect(countryName("XX")).toBeNull();
  });

  it("classifies a failure by its status, and keeps Fiken's words only clipped and without tokens", () => {
    const none = () => null;
    expect(classifyFikenFailure(401, null, "", none).class).toBe("auth");
    expect(classifyFikenFailure(403, null, "", none)).toMatchObject({ class: "permission", key: "http_403" });
    expect(classifyFikenFailure(404, null, "", none).class).toBe("drift");
    expect(classifyFikenFailure(503, null, "", none)).toMatchObject({ class: "transient", detail: null });
    expect(classifyFikenFailure(429, null, "", (n) => (n === "retry-after" ? "30" : null))).toMatchObject({ class: "rate_limit", retryAfter: 30 });
    expect(classifyFikenFailure(400, { message: "Perioden er låst for bilagsføring." }, "", none)).toMatchObject({ class: "rule", key: "closed_period" });
    expect(classifyFikenFailure(400, { errors: [{ message: "Konto 3999 finnes ikke." }] }, "", none)).toMatchObject({ class: "rule", key: "validation", detail: "Konto 3999 finnes ikke." });
    const secret = "a".repeat(60);
    expect(fikenWords({ error_description: `token ${secret} expired` })).toBe("token … expired");
    expect(fikenWords(null, "<html>error</html>")).toBeNull();
    expect(fikenFailureWords({ key: "nobody", class: "transient" })).toMatch(/tried again/);
  });
});
