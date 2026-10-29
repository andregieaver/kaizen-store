import { describe, expect, it } from "vitest";

import { classColours, colourOfClasses } from "./css-class-colours";

describe("classColours", () => {
  it("reads rules of one element's classes with a hex colour, the last winning", () => {
    const rules = classColours(
      "/* x */ .a{color:#999;} .a.b, .c { font-size:70%; color: #709900 !important; }\n@media (max-width:600px){ .d{color:#fff} }\n" +
        ".e .f{color:#000} .g:hover{color:#000} #h{color:#000} p.i{color:#000} .j{color:var(--muted)} .k{background-color:#000} .a{color:#111}",
    );
    expect(rules).toEqual([
      { classes: ["a"], color: "#999999" },
      { classes: ["a", "b"], color: "#709900" },
      { classes: ["c"], color: "#709900" },
      { classes: ["d"], color: "#ffffff" },
      { classes: ["a"], color: "#111111" },
    ]);
    expect(colourOfClasses(["a"], rules)).toBe("#111111");
    expect(colourOfClasses(["b"], rules)).toBeNull();
    expect(colourOfClasses(["b", "a"], rules)).toBe("#111111");
    expect(colourOfClasses([], rules)).toBeNull();
  });
});
