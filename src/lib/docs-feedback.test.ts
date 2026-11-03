import { describe, expect, it } from "vitest";

import { cleanDocsComment, DOCS_FEEDBACK_MAX, readDocsFeedback } from "./docs-feedback";

describe("Was this page helpful? (D442)", () => {
  it("reads a yes or no on a page, and a sentence for an answer just given", () => {
    expect(readDocsFeedback({ path: "owners/getting-started/create-your-store", lang: "nb", helpful: false })).toEqual({
      kind: "vote",
      path: "owners/getting-started/create-your-store",
      lang: "nb",
      helpful: false,
    });
    expect(readDocsFeedback({ id: "0F8FAD5B-D9CB-469F-A165-70867728950E", comment: "Clear, thanks." })).toEqual({
      kind: "comment",
      id: "0f8fad5b-d9cb-469f-a165-70867728950e",
      comment: "Clear, thanks.",
    });
  });

  it("refuses anything else: other keys, other languages, paths that are not the docs', ids that are not ids", () => {
    for (const body of [
      null,
      [],
      "yes",
      { path: "owners/x", lang: "sv", helpful: true },
      { path: "owners/x", lang: "en", helpful: "yes" },
      { path: "../admin", lang: "en", helpful: true },
      { path: "/owners/x", lang: "en", helpful: true },
      { path: "owners/x", lang: "en", helpful: true, email: "a@b.example" },
      { id: "1", comment: "x" },
      { id: "0f8fad5b-d9cb-469f-a165-70867728950e", comment: 5 },
      { id: "0f8fad5b-d9cb-469f-a165-70867728950e", comment: "x".repeat(DOCS_FEEDBACK_MAX * 4 + 1) },
      { path: "owners/x", lang: "en", helpful: true, comment: "both" },
    ]) {
      expect(readDocsFeedback(body), JSON.stringify(body)?.slice(0, 80)).toBeNull();
    }
  });

  it("cleans a sentence as a shopper's text is and refuses one too long, never cutting it", () => {
    expect(cleanDocsComment("  Very‮ clear​.\r\n\r\n\r\nThanks  ")).toEqual({ ok: true, value: "Very clear.\n\nThanks" });
    expect(cleanDocsComment("   ")).toEqual({ ok: true, value: null });
    expect(cleanDocsComment("<b>bold</b>")).toEqual({ ok: true, value: "<b>bold</b>" });
    expect(cleanDocsComment("é".repeat(DOCS_FEEDBACK_MAX))).toMatchObject({ ok: true });
    expect(cleanDocsComment("x".repeat(DOCS_FEEDBACK_MAX + 3))).toEqual({ ok: false, problem: "too_long", over: 3 });
    expect(cleanDocsComment(Array.from({ length: 11 }, () => "line").join("\n"))).toEqual({ ok: false, problem: "too_many_lines", over: 1 });
  });
});
