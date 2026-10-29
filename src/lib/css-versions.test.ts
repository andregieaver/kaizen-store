import { describe, expect, it } from "vitest";

import { cssLineChanges } from "./css-versions";

describe("how a CSS version differs from the panel (D385)", () => {
  it("counts the lines a version adds and those it takes away, trimmed, empty ones left out", () => {
    expect(cssLineChanges("a {}\nb {}", "a {}\nb {}")).toEqual({ added: 0, removed: 0 });
    expect(cssLineChanges("a {}\n\n  b {}  ", "a {}\nb {}\n")).toEqual({ added: 0, removed: 0 });
    expect(cssLineChanges("a {}\nb {}", "a {}\nc {}\nd {}")).toEqual({ added: 2, removed: 1 });
    expect(cssLineChanges("", "a {}")).toEqual({ added: 1, removed: 0 });
  });

  it("counts a repeated line as often as it appears", () => {
    expect(cssLineChanges("}\n}", "}")).toEqual({ added: 0, removed: 1 });
    expect(cssLineChanges("}", "}\n}\n}")).toEqual({ added: 2, removed: 0 });
  });
});
