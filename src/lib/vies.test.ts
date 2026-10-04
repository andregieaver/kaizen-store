import { describe, expect, it } from "vitest";

import {
  VIES_CACHE_HOURS,
  VIES_HOST,
  VIES_PATH,
  VIES_RETRIES,
  VIES_TIMEOUT_MS,
  VIES_URL,
  buyerVatState,
  parseViesResponse,
  splitStoredNumber,
  viesEndpoint,
  viesFresh,
  viesRequestBody,
  viesWorthRetry,
} from "./vies";

describe("the address", () => {
  it("is one constant host and path", () => {
    expect(VIES_HOST).toBe("ec.europa.eu");
    expect(VIES_PATH).toBe("/taxation_customs/vies/rest-api/check-vat-number");
    expect(VIES_URL).toBe("https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number");
    expect(VIES_TIMEOUT_MS).toBe(4000);
    expect(VIES_RETRIES).toBe(1);
    expect(VIES_CACHE_HOURS).toBe(24);
  });

  it("is VIES unless the test switch is on and this is not Vercel", () => {
    const test = "http://127.0.0.1:4010/check";
    expect(viesEndpoint({})).toBe(VIES_URL);
    expect(viesEndpoint({ testUrl: test })).toBe(VIES_URL);
    expect(viesEndpoint({ testUrl: test, allowTest: "0" })).toBe(VIES_URL);
    expect(viesEndpoint({ testUrl: test, allowTest: "1" })).toBe(test);
    expect(viesEndpoint({ testUrl: test, allowTest: "1", vercel: "1" })).toBe(VIES_URL);
  });

  it("ignores a test address that is not an http address", () => {
    expect(viesEndpoint({ testUrl: "file:///etc/passwd", allowTest: "1" })).toBe(VIES_URL);
    expect(viesEndpoint({ testUrl: "javascript:alert(1)", allowTest: "1" })).toBe(VIES_URL);
    expect(viesEndpoint({ testUrl: "not a url", allowTest: "1" })).toBe(VIES_URL);
  });
});

describe("the request", () => {
  it("holds only a prefix from the member states and the number's characters", () => {
    expect(viesRequestBody({ prefix: "DE", body: "123456789" })).toEqual({ countryCode: "DE", vatNumber: "123456789" });
    expect(viesRequestBody({ prefix: "EL", body: "123456789" })).toEqual({ countryCode: "EL", vatNumber: "123456789" });
  });

  it("carries the requester's number when it has one", () => {
    expect(viesRequestBody({ prefix: "DE", body: "123456789" }, { prefix: "SE", body: "556677889901" })).toEqual({
      countryCode: "DE",
      vatNumber: "123456789",
      requesterMemberStateCode: "SE",
      requesterNumber: "556677889901",
    });
  });

  it("refuses what VIES cannot be asked about", () => {
    expect(viesRequestBody({ prefix: "NO", body: "123456789MVA" })).toBeNull();
    expect(viesRequestBody({ prefix: "XI", body: "123456789" })).toBeNull();
    expect(viesRequestBody({ prefix: "GR", body: "123456789" })).toBeNull();
    expect(viesRequestBody({ prefix: "DE", body: "1/../2" })).toBeNull();
    expect(viesRequestBody({ prefix: "DE", body: "1" })).toBeNull();
    expect(viesRequestBody({ prefix: "DE", body: "1".repeat(13) })).toBeNull();
  });

  it("leaves out a requester that is not a member state's number", () => {
    expect(viesRequestBody({ prefix: "DE", body: "123456789" }, { prefix: "NO", body: "123456789MVA" })).toEqual({
      countryCode: "DE",
      vatNumber: "123456789",
    });
  });

  it("splits a stored number", () => {
    expect(splitStoredNumber("SE556677889901")).toEqual({ prefix: "SE", body: "556677889901" });
    expect(splitStoredNumber("se55")).toBeNull();
  });
});

describe("the answer", () => {
  const valid = {
    countryCode: "DE",
    vatNumber: "123456789",
    requestDate: "2026-10-03T10:00:00.000Z",
    valid: true,
    requestIdentifier: "WAPIAAAAZ1234567",
    name: "Muster GmbH",
    address: "Musterstrasse 1\n10115 Berlin",
  };

  it("reads a valid number with its name, address and consultation number", () => {
    expect(parseViesResponse(200, JSON.stringify(valid))).toEqual({
      status: "valid",
      name: "Muster GmbH",
      address: "Musterstrasse 1 10115 Berlin",
      requestIdentifier: "WAPIAAAAZ1234567",
      error: null,
    });
  });

  it("stores --- (not disclosed) as null", () => {
    const answer = parseViesResponse(200, JSON.stringify({ ...valid, name: "---", address: "---", requestIdentifier: "" }));
    expect(answer).toMatchObject({ status: "valid", name: null, address: null, requestIdentifier: null });
  });

  it("reads valid:false as invalid, with nothing of the registry", () => {
    expect(parseViesResponse(200, JSON.stringify({ ...valid, valid: false }))).toEqual({
      status: "invalid",
      name: null,
      address: null,
      requestIdentifier: null,
      error: null,
    });
  });

  it("treats a 400 as the number being refused", () => {
    expect(parseViesResponse(400, "{}")).toMatchObject({ status: "invalid", error: "http_400" });
  });

  it("treats every other status, and anything unreadable, as unavailable", () => {
    for (const status of [401, 403, 404, 429, 500, 502, 503, 504]) {
      expect(parseViesResponse(status, JSON.stringify(valid))).toMatchObject({ status: "unavailable", error: `http_${status}` });
    }
    for (const body of ["", "<html>", "null", "[]", "42", '"valid"', "{}", '{"valid":"true"}', '{"valid":1}']) {
      expect(parseViesResponse(200, body)).toMatchObject({ status: "unavailable", error: "malformed" });
    }
  });

  it("never believes valid:true when the answer carries a service error", () => {
    expect(parseViesResponse(200, JSON.stringify({ ...valid, userError: "MS_UNAVAILABLE" }))).toMatchObject({
      status: "unavailable",
      error: "service_ms_unavailable",
    });
    expect(parseViesResponse(200, JSON.stringify({ ...valid, valid: false, userError: "MS_MAX_CONCURRENT_REQ" }))).toMatchObject({
      status: "unavailable",
    });
    expect(parseViesResponse(200, JSON.stringify({ ...valid, errorWrappers: [{ error: "TIMEOUT" }] }))).toMatchObject({ status: "unavailable" });
    expect(parseViesResponse(200, JSON.stringify({ ...valid, userError: "VALID" }))).toMatchObject({ status: "valid" });
  });

  it("reads at most 16 KB", () => {
    const big = JSON.stringify({ ...valid, name: "x".repeat(40_000) });
    expect(parseViesResponse(200, big)).toMatchObject({ status: "unavailable", error: "malformed" });
  });

  it("keeps names and addresses to a sane length", () => {
    const answer = parseViesResponse(200, JSON.stringify({ ...valid, name: "N".repeat(900), address: "A".repeat(900) }));
    expect(answer.name).toHaveLength(200);
    expect(answer.address).toHaveLength(400);
  });

  it("retries only what did not get a definite answer from the service", () => {
    const answer = (status: "valid" | "invalid" | "unavailable", error: string | null) => ({ status, name: null, address: null, requestIdentifier: null, error });
    expect(viesWorthRetry(answer("unavailable", "timeout"))).toBe(true);
    expect(viesWorthRetry(answer("unavailable", "network"))).toBe(true);
    expect(viesWorthRetry(answer("unavailable", "http_503"))).toBe(true);
    expect(viesWorthRetry(answer("unavailable", "http_429"))).toBe(false);
    expect(viesWorthRetry(answer("unavailable", "malformed"))).toBe(false);
    expect(viesWorthRetry(answer("invalid", null))).toBe(false);
    expect(viesWorthRetry(answer("valid", null))).toBe(false);
  });
});

describe("how long a check counts", () => {
  const at = Date.parse("2026-10-03T12:00:00Z");
  const ago = (minutes: number) => new Date(at - minutes * 60_000);

  it("is 24 hours to the minute", () => {
    expect(viesFresh(ago(24 * 60), at)).toBe(true);
    expect(viesFresh(ago(24 * 60 + 1), at)).toBe(false);
    expect(viesFresh(ago(0), at)).toBe(true);
  });

  it("gives the buyer's state from the latest check", () => {
    expect(buyerVatState(null, at)).toBe("none");
    expect(buyerVatState(undefined, at)).toBe("none");
    expect(buyerVatState({ status: "valid", requestedAt: ago(5) }, at)).toBe("valid");
    expect(buyerVatState({ status: "valid", requestedAt: ago(24 * 60 + 1) }, at)).toBe("stale");
    expect(buyerVatState({ status: "invalid", requestedAt: ago(5) }, at)).toBe("invalid");
    expect(buyerVatState({ status: "invalid", requestedAt: ago(5000) }, at)).toBe("invalid");
    expect(buyerVatState({ status: "unavailable", requestedAt: ago(5) }, at)).toBe("unavailable");
  });
});
