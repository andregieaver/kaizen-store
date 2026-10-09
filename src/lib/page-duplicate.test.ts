import { describe, expect, it } from "vitest";

import { PAGE_TITLE_MAX } from "./page-content";
import { copySlug, copyTitle, SLUG_MAX } from "./page-duplicate";

describe("copyTitle", () => {
  it("puts Copy of before the title", () => {
    expect(copyTitle("About us")).toBe("Copy of About us");
  });

  it("does not stack Copy of on a copy", () => {
    expect(copyTitle("Copy of About us")).toBe("Copy of About us");
    expect(copyTitle("  copy of  About us ")).toBe("Copy of About us");
  });

  it("stays within the longest title", () => {
    expect(copyTitle("x".repeat(PAGE_TITLE_MAX + 20)).length).toBeLessThanOrEqual(PAGE_TITLE_MAX);
  });
});

describe("copySlug", () => {
  it("adds -copy, then -copy-2, -copy-3 for the first address that is free", () => {
    expect(copySlug("about", new Set(["about"]))).toBe("about-copy");
    expect(copySlug("about", new Set(["about", "about-copy"]))).toBe("about-copy-2");
    expect(copySlug("about", new Set(["about", "about-copy", "about-copy-2"]))).toBe("about-copy-3");
  });

  it("copies the original when a copy is copied", () => {
    expect(copySlug("about-copy", new Set(["about", "about-copy"]))).toBe("about-copy-2");
    expect(copySlug("about-copy-2", new Set(["about", "about-copy", "about-copy-2"]))).toBe("about-copy-3");
  });

  it("cuts a long address before the suffix, not after it", () => {
    const long = "a".repeat(SLUG_MAX);
    const copy = copySlug(long, new Set([long]));
    expect(copy).toHaveLength(SLUG_MAX);
    expect(copy.endsWith("-copy")).toBe(true);
    expect(copySlug(long, new Set([long, copy])).endsWith("-copy-2")).toBe(true);
  });

  it("never leaves a hyphen before the suffix", () => {
    const slug = `${"a".repeat(SLUG_MAX - 6)}-b-c`;
    expect(copySlug(slug, new Set([slug]))).not.toMatch(/--/);
  });
});

describe("a nested page's copy", () => {
  it("stays under its parent and takes the first free suffix there", () => {
    expect(copySlug("projects/project-a", new Set(["projects/project-a"]))).toBe("projects/project-a-copy");
    expect(copySlug("projects/project-a", new Set(["project-a-copy"]))).toBe("projects/project-a-copy");
    expect(copySlug("projects/project-a-copy", new Set(["projects/project-a-copy", "projects/project-a-copy-2"]))).toBe("projects/project-a-copy-3");
  });
});
