import { describe, expect, it } from "vitest";

import { DOCUMENT_TOKEN, isDocumentToken, kindOfToken, newDocumentToken } from "./document-token";

describe("a document's token", () => {
  it("is inv_ or crn_ and 43 base64url characters, different every time", () => {
    const a = newDocumentToken("invoice");
    const b = newDocumentToken("invoice");
    expect(a).toMatch(/^inv_[A-Za-z0-9_-]{43}$/);
    expect(newDocumentToken("credit_note")).toMatch(/^crn_[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(DOCUMENT_TOKEN.test(a)).toBe(true);
  });

  it("is told from anything else", () => {
    expect(isDocumentToken(newDocumentToken("invoice"))).toBe(true);
    expect(kindOfToken(newDocumentToken("invoice"))).toBe("invoice");
    expect(kindOfToken(newDocumentToken("credit_note"))).toBe("credit_note");
    for (const bad of ["", "inv_short", `inv_${"a".repeat(44)}`, `xyz_${"a".repeat(43)}`, `inv_${"a".repeat(42)}!`, null, undefined, 5, `INV_${"a".repeat(43)}`]) {
      expect(isDocumentToken(bad)).toBe(false);
      expect(kindOfToken(bad)).toBeNull();
    }
  });
});
