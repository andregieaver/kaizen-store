import { describe, expect, it } from "vitest";

import { BLOCK_WORDS, classifyFailure, failureWords, networkFailure } from "./tripletex-errors";

const headers =
  (values: Record<string, string> = {}) =>
  (name: string) =>
    values[name.toLowerCase()] ?? null;

describe("what Tripletex's answers mean (D453)", () => {
  it("sorts each status into what the sync does next", () => {
    expect(classifyFailure(401, {}, headers()).class).toBe("auth");
    expect(classifyFailure(403, { message: "No access" }, headers()).class).toBe("permission");
    expect(classifyFailure(404, {}, headers()).class).toBe("drift");
    expect(classifyFailure(409, { code: 8000 }, headers()).class).toBe("revision");
    expect(classifyFailure(409, { code: 14000 }, headers()).class).toBe("duplicate");
    expect(classifyFailure(409, { code: 25000 }, headers()).class).toBe("rule");
    expect(classifyFailure(422, { validationMessages: [{ field: "postings", message: "Kontoen er inaktiv" }] }, headers())).toMatchObject({ class: "rule", key: "validation", detail: "postings: Kontoen er inaktiv" });
    expect(classifyFailure(500, {}, headers()).class).toBe("transient");
    expect(classifyFailure(503, "<html>", headers()).class).toBe("transient");
  });

  it("waits Tripletex's reset on a rate limit, within a quarter of an hour", () => {
    expect(classifyFailure(429, {}, headers({ "x-rate-limit-reset": "42" }))).toMatchObject({ class: "rate_limit", retryAfter: 42 });
    expect(classifyFailure(429, {}, headers({ "x-rate-limit-reset": "99999" })).retryAfter).toBe(900);
    expect(classifyFailure(429, {}, headers()).retryAfter).toBe(60);
  });

  it("knows a closed accounting period by Tripletex's words, in either language", () => {
    expect(classifyFailure(422, { validationMessages: [{ field: "date", message: "Perioden er lukket for bilagsføring" }] }, headers()).key).toBe("closed_period");
    expect(classifyFailure(422, { message: "The accounting period is closed." }, headers()).key).toBe("closed_period");
  });

  it("keeps Tripletex's request id for its support", () => {
    expect(classifyFailure(500, { requestId: "body-id" }, headers({ "x-tlx-request-id": "abc-123" })).requestId).toBe("abc-123");
    expect(classifyFailure(500, { requestId: "body-id" }, headers()).requestId).toBe("body-id");
  });

  it("never carries a token-like string from Tripletex's words, and keeps no words at all for a sign-in failure", () => {
    const token = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjMifQ", "abcdefghijklmnop"].join(".");
    const failure = classifyFailure(422, { message: `Token ${token} is not valid for this request` }, headers());
    expect(failure.detail).not.toContain("eyJ");
    expect(classifyFailure(401, { message: `Token ${token} expired` }, headers()).detail).toBeNull();
  });

  it("has plain words for every failure, and for every reason a document waits", () => {
    for (const status of [401, 403, 404, 409, 422, 429, 500]) {
      const words = failureWords(classifyFailure(status, {}, headers()));
      expect(words.length, String(status)).toBeGreaterThan(20);
    }
    for (const kind of ["timeout", "network", "redirect"] as const) expect(failureWords(networkFailure(kind))).toMatch(/tried again/);
    expect(Object.keys(BLOCK_WORDS)).toEqual(expect.arrayContaining(["currency_unsupported", "vat_unmapped", "totals_mismatch", "nothing_to_book"]));
  });
});
