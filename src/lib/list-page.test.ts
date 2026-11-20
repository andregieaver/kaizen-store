import { describe, expect, it } from "vitest";

import { LIST_PAGE_SIZE, listOffset, listPage } from "./list-page";

describe("one way to page a list (code review 1.13, D834)", () => {
  it("reads a page number from the address, and falls back to the first", () => {
    expect(listPage("3")).toBe(3);
    expect(listPage(["2", "5"])).toBe(2);
    expect(listPage("10000")).toBe(10_000);
    for (const bad of [undefined, "", "0", "-1", "x", "1.5", "99999", "1e3"]) expect(listPage(bad), String(bad)).toBe(1);
  });

  it("skips the rows of the pages before, a hundred a page unless the list says", () => {
    expect(LIST_PAGE_SIZE).toBe(100);
    expect(listOffset(1)).toBe(0);
    expect(listOffset(2)).toBe(100);
    expect(listOffset(3, 25)).toBe(50);
    expect(listOffset(0)).toBe(0);
  });
});
