import { describe, expect, it } from "vitest";

import { sourceOf, sourcePath } from "./projects-sources";

const none = { order_id: null, return_id: null, review_id: null, conversation_id: null };
const id = "8f3a1c52-2d4e-4f6a-9b1c-3e5d7f9a0b12";

describe("where a task came from (D904 P8.3a)", () => {
  it("reads the one source a task's row names, or none", () => {
    expect(sourceOf(none)).toBeNull();
    expect(sourceOf({ ...none, return_id: id })).toEqual({ kind: "return", id });
    expect(sourceOf({ ...none, conversation_id: id })).toEqual({ kind: "conversation", id });
  });

  it("opens each source where it lives in the admin", () => {
    expect(sourcePath({ kind: "order", id })).toBe(`/orders/${id}`);
    expect(sourcePath({ kind: "return", id })).toBe(`/returns/${id}`);
    expect(sourcePath({ kind: "review", id })).toBe("/reviews");
    expect(sourcePath({ kind: "conversation", id })).toBe(`/support?c=${id}`);
  });
});
