import { describe, expect, it } from "vitest";

import {
  STARTER_CATEGORIES,
  STARTER_CATEGORY_LABELS,
  isStarterPicture,
  movedOrder,
  parseStarterDetails,
  readStarterDraft,
  sameStarterDetails,
  standardCard,
  starterChoice,
  starterRefusal,
} from "./store-starters";

describe("store templates' details (D175)", () => {
  it("reads a valid form, trimmed, with an empty picture as none", () => {
    expect(parseStarterDetails({ title: "  Spa  ", summary: " Book treatments ", description: "Line one\r\nLine two", category: "appointments", pictureUrl: "" })).toEqual({
      ok: true,
      details: { title: "Spa", summary: "Book treatments", description: "Line one\nLine two", category: "appointments", pictureUrl: null },
    });
  });

  it("says in plain words what is wrong", () => {
    const result = parseStarterDetails({ title: "", summary: "x".repeat(201), description: "y".repeat(2001), category: "spa", pictureUrl: "javascript:alert(1)" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems).toEqual([
        "Enter a title.",
        "Keep the summary under 201 characters.",
        "Keep the description under 2001 characters.",
        "Choose a category.",
        "The picture's address must start with https:// or be a path on this site.",
      ]);
    }
  });

  it("drops control characters from the description but keeps line breaks", () => {
    const result = parseStarterDetails({ title: "A", description: "a\u0000b\nc\u0007", category: "other" });
    expect(result.ok && result.details.description).toBe("ab\nc");
  });

  it("accepts pictures on the site or over https only", () => {
    expect(isStarterPicture("/storage/v1/object/public/media/kaizen/spa.webp")).toBe(true);
    expect(isStarterPicture("https://example.com/spa.webp")).toBe(true);
    for (const bad of ["//evil.example/x.png", "http://example.com/x.png", "data:image/png;base64,AAA", "javascript:alert(1)", "https://u:p@example.com/x.png", "/a b.png"]) {
      expect(isStarterPicture(bad), bad).toBe(false);
    }
  });

  it("labels every category", () => {
    for (const category of STARTER_CATEGORIES) expect(STARTER_CATEGORY_LABELS[category]).toBeTruthy();
  });
});

describe("choosing a template", () => {
  it("passes a starter's id and nothing else", () => {
    expect(starterChoice("0F8FAD5B-D9CB-469F-A165-70867728950E")).toBe("0f8fad5b-d9cb-469f-a165-70867728950e");
    for (const value of ["", "demo", "1; drop table", null, undefined, 42]) expect(starterChoice(value)).toBeNull();
  });

  it("offers the Standard store with an empty value", () => {
    expect(standardCard("/s/demo")).toMatchObject({ id: "", title: "Standard store", previewHref: "/s/demo", category: null });
  });

  it("moves a template one place up or down, never off the ends", () => {
    expect(movedOrder(["a", "b", "c"], "b", "up")).toEqual(["b", "a", "c"]);
    expect(movedOrder(["a", "b", "c"], "b", "down")).toEqual(["a", "c", "b"]);
    expect(movedOrder(["a", "b", "c"], "a", "up")).toBeNull();
    expect(movedOrder(["a", "b", "c"], "c", "down")).toBeNull();
    expect(movedOrder(["a"], "x", "up")).toBeNull();
  });

  it("words the database's refusals", () => {
    expect(starterRefusal("store_starters.not_offered: that store template is not offered")).toMatch(/not offered any more/);
    expect(starterRefusal("stores.starter_has_sales: …")).toMatch(/cannot become a store template/);
    expect(starterRefusal("something else")).toBeNull();
  });
});

describe("a store template's draft details (D177)", () => {
  it("reads the recommended design profile as one of the details, only when the form has it", () => {
    const withDesign = parseStarterDetails({ title: "Spa", category: "appointments", recommendedDesign: "0F8FAD5B-D9CB-469F-A165-70867728950E" });
    expect(withDesign.ok && withDesign.details.recommendedDesign).toBe("0f8fad5b-d9cb-469f-a165-70867728950e");
    const none = parseStarterDetails({ title: "Spa", category: "appointments", recommendedDesign: "" });
    expect(none.ok && none.details.recommendedDesign).toBeNull();
    const absent = parseStarterDetails({ title: "Spa", category: "appointments" });
    expect(absent.ok && "recommendedDesign" in absent.details).toBe(false);
  });

  it("reads a stored draft, and compares details", () => {
    const draft = readStarterDraft({ title: "Spa", summary: "", description: "", category: "appointments", pictureUrl: null, recommendedDesign: null });
    expect(draft).toEqual({ title: "Spa", summary: "", description: "", category: "appointments", pictureUrl: null, recommendedDesign: null });
    expect(readStarterDraft("nope")).toBeNull();
    expect(readStarterDraft({ title: "", category: "appointments" })).toBeNull();
    expect(sameStarterDetails(draft!, { ...draft!, recommendedDesign: undefined })).toBe(true);
    expect(sameStarterDetails(draft!, { ...draft!, summary: "Treatments" })).toBe(false);
  });

  it("words the refusals of the lifecycle", () => {
    expect(starterRefusal("store_starters.used: …")).toMatch(/Archive it instead/);
    expect(starterRefusal("store_starters.requested: …")).toMatch(/access request/);
    expect(starterRefusal("store_starters.archived: …")).toMatch(/Restore it/);
  });
});
