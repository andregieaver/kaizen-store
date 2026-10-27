import { describe, expect, it } from "vitest";

import { PREVIEW_DAY_CHOICES, PREVIEW_DEFAULT_DAYS, PREVIEW_MAX_DAYS, previewDays, previewPath } from "./preview-links";
import { isPreviewToken, newPreviewToken, previewTokenHash } from "./preview-token";

/**
 * Preview links (wave 7 unit F, D340): a token is 32 random bytes the database never sees (only its SHA-256), with a shape checked before
 * anything is looked up; a link works for one of a few lengths of time, never more than 30 days.
 */

describe("a preview link's token", () => {
  it("is new each time and has its own shape", () => {
    const a = newPreviewToken();
    const b = newPreviewToken();
    expect(a).not.toBe(b);
    expect(isPreviewToken(a)).toBe(true);
    expect(a).toMatch(/^pv_[A-Za-z0-9_-]{43}$/);
  });

  it("is kept only as its SHA-256, which never shows the token", () => {
    const token = newPreviewToken();
    const hash = previewTokenHash(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(previewTokenHash(token));
    expect(hash).not.toContain(token.slice(3, 13));
  });

  it("refuses anything else before a lookup", () => {
    for (const value of ["", "pv_", "pv_short", `xx_${"a".repeat(43)}`, `pv_${"a".repeat(42)}!`, null, 42, `pv_${"a".repeat(44)}`]) {
      expect(isPreviewToken(value)).toBe(false);
    }
  });

  it("opens one address on the admin's host", () => {
    expect(previewPath("pv_abc")).toBe("/admin/account/share/pv_abc");
  });
});

describe("how long a link works", () => {
  it("is one of the choices, a week unless another is chosen, never past the database's limit", () => {
    expect(PREVIEW_DEFAULT_DAYS).toBe(7);
    expect(Math.max(...PREVIEW_DAY_CHOICES)).toBeLessThanOrEqual(PREVIEW_MAX_DAYS);
    for (const n of PREVIEW_DAY_CHOICES) expect(previewDays(n)).toBe(n);
    expect(previewDays("30")).toBe(30);
    for (const value of [0, 31, 90, "forever", -1, null, 2.5]) expect(previewDays(value)).toBe(PREVIEW_DEFAULT_DAYS);
  });
});
