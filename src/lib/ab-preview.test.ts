import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { PREVIEW_COOKIE, PREVIEW_LINK_DAYS, previewBody, previewCookieValue, previewedTest, withPreview } from "./ab-preview";
import { readPreview, readPreviewCookie, signPreview } from "./ab-preview-sign";
import { decodeAssignments, encodeAssignments } from "./experiments";

const secret = randomBytes(32);
const STORE = "11111111-1111-4111-8111-111111111111";
const TEST = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const VISITOR = "44444444-4444-4444-8444-444444444444";

describe("a preview link's token (D148 phase 20)", () => {
  const now = Date.UTC(2026, 10, 17, 12);
  const token = signPreview(secret, { storeId: STORE, experiment: TEST, version: "b" }, now);

  it("says the store, the test and the version, and is good for 30 days", () => {
    expect(readPreview(secret, token, now)).toEqual({ storeId: STORE, experiment: TEST, version: "b", expires: now + PREVIEW_LINK_DAYS * 86_400_000 });
    expect(readPreview(secret, token, now + PREVIEW_LINK_DAYS * 86_400_000 + 1)).toBeNull();
  });

  it("is refused when altered, signed with another secret, or without a secret", () => {
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify([1, STORE, TEST, "c", now + 1e9])).toString("base64url");
    expect(readPreview(secret, `${forged}.${sig}`, now)).toBeNull();
    expect(readPreview(randomBytes(32), token, now)).toBeNull();
    expect(readPreview(null, token, now)).toBeNull();
    expect(readPreview(secret, `${body}.${sig}.x`, now)).toBeNull();
    expect(readPreview(secret, "nonsense", now)).toBeNull();
  });

  it("names no version but b to d", () => {
    expect(previewBody(signPreview(secret, { storeId: STORE, experiment: TEST, version: "a" }, now))).toBeNull();
    expect(previewBody(signPreview(secret, { storeId: STORE, experiment: TEST, version: "d" }, now))?.version).toBe("d");
  });

  it("tells the browser which test it previews by the cookie's plain prefix, so it keeps quiet about it", () => {
    const cookie = previewCookieValue(TEST, token);
    expect(previewedTest((name) => (name === PREVIEW_COOKIE ? cookie : undefined))).toBe(TEST);
    expect(previewedTest(() => undefined)).toBeNull();
    expect(previewedTest(() => "garbage")).toBeNull();
  });

  it("trusts a cookie only for its token, and only when the prefix is the token's own test", () => {
    expect(readPreviewCookie(secret, previewCookieValue(TEST, token), now)?.experiment).toBe(TEST);
    expect(readPreviewCookie(secret, previewCookieValue(OTHER, token), now)).toBeNull();
    expect(readPreviewCookie(secret, token, now)).toBeNull();
  });
});

describe("what the proxy reads while a browser previews", () => {
  it("puts the link's version in the browser's own versions, and makes a shape for a browser with none", () => {
    const own = encodeAssignments({ visitor: VISITOR, versions: { [TEST]: "a", [OTHER]: "c" } });
    expect(decodeAssignments(withPreview(own, { experiment: TEST, version: "b" }))).toEqual({ visitor: VISITOR, versions: { [TEST]: "b", [OTHER]: "c" } });
    expect(decodeAssignments(withPreview(undefined, { experiment: TEST, version: "b" }))?.versions).toEqual({ [TEST]: "b" });
  });
});
