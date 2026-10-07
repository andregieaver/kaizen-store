import { describe, expect, it } from "vitest";

import { LIFECYCLE_WORDS, canonicalJson, deleteBlocker, lifecycleActions, lifecycleState, listFilterOf } from "./lifecycle";

const base = { published: false, archivedAt: null, publishedAt: null, changed: false };

describe("the life of a store template or a design profile (D177)", () => {
  it("names each state", () => {
    expect(lifecycleState(base)).toBe("never_published");
    expect(lifecycleState({ ...base, publishedAt: "2026-10-01T00:00:00Z" })).toBe("unpublished");
    expect(lifecycleState({ ...base, published: true, publishedAt: "2026-10-01T00:00:00Z" })).toBe("published");
    expect(lifecycleState({ ...base, published: true, publishedAt: "2026-10-01T00:00:00Z", changed: true })).toBe("published_changed");
    expect(lifecycleState({ ...base, archivedAt: "2026-10-02T00:00:00Z", publishedAt: "2026-10-01T00:00:00Z" })).toBe("archived");
    expect(LIFECYCLE_WORDS.published_changed).toBe("Published, with unpublished changes");
  });

  it("offers Publish while unpublished or changed, Unpublish while published, Archive or Restore, and Delete only while unused", () => {
    expect(lifecycleActions({ ...base, used: false })).toEqual(["publish", "archive", "delete"]);
    expect(lifecycleActions({ ...base, published: true, publishedAt: "x", used: true })).toEqual(["unpublish", "archive"]);
    expect(lifecycleActions({ ...base, published: true, publishedAt: "x", changed: true, used: true })).toEqual(["publish", "unpublish", "archive"]);
    expect(lifecycleActions({ ...base, archivedAt: "x", used: true })).toEqual(["restore"]);
    expect(lifecycleActions({ ...base, archivedAt: "x", used: false })).toEqual(["restore", "delete"]);
  });

  it("says why something cannot be deleted", () => {
    expect(deleteBlocker("store template", { stores: 0, requests: 0 })).toBeNull();
    expect(deleteBlocker("store template", { stores: 2, requests: 1 })).toBe(
      "This store template cannot be deleted: 2 stores were made from it and 1 access request names it. Archive it instead.",
    );
    expect(deleteBlocker("design profile", { stores: 1, requests: 0 })).toBe("This design profile cannot be deleted: 1 store applied it. Archive it instead.");
  });

  it("reads the list's filter from the address", () => {
    expect(listFilterOf("archived")).toBe("archived");
    for (const value of [undefined, "", "all", ["archived"]]) expect(listFilterOf(value)).toBe("current");
  });

  it("writes equal values the same way whatever the order of their keys", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } })).toBe('{"a":{"c":null,"d":[1,{"x":1,"y":2}]},"b":1}');
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });
});
