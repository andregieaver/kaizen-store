import { describe, expect, it } from "vitest";

import { ADMIN_VIEWS, DEFAULT_ADMIN_VIEW, adminViewOf, hiddenIn, isAdminView, shownIn } from "./admin-view";

describe("Basic and Advanced (D453)", () => {
  it("starts everyone in Basic and reads only the views it has", () => {
    expect(ADMIN_VIEWS).toEqual(["basic", "advanced"]);
    expect(DEFAULT_ADMIN_VIEW).toBe("basic");
    expect(adminViewOf("advanced")).toBe("advanced");
    expect(adminViewOf("basic")).toBe("basic");
    // A column read before its migration, or anything else, is the default.
    for (const other of [undefined, null, "", "expert", 1]) expect(adminViewOf(other)).toBe("basic");
    expect(isAdminView("advanced")).toBe(true);
    expect(isAdminView("Advanced")).toBe(false);
  });

  it("leaves advanced links out of Basic, but never the page being viewed", () => {
    expect(shownIn("basic", {}, false)).toBe(true);
    expect(shownIn("basic", { advanced: true }, false)).toBe(false);
    expect(shownIn("basic", { advanced: true }, true)).toBe(true);
    expect(shownIn("advanced", { advanced: true }, false)).toBe(true);
  });

  it("counts what Basic leaves out, and nothing in Advanced", () => {
    const items = [{ id: 1 }, { id: 2, advanced: true }, { id: 3, advanced: true }];
    expect(hiddenIn("basic", items)).toBe(2);
    expect(hiddenIn("basic", items, (item) => item.id === 3)).toBe(1);
    expect(hiddenIn("advanced", items)).toBe(0);
  });
});
