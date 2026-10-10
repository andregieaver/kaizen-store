import { describe, expect, it } from "vitest";

import { cellParts, iconToken, withoutIcons } from "./table-icons";

describe("icons in a table's cells (D201)", () => {
  it("reads a cell as its words and icons in order", () => {
    expect(cellParts("{{check}} Included")).toEqual([{ icon: "check" }, { text: " Included" }]);
    expect(cellParts("Yes {{x}}{{check}}")).toEqual([{ text: "Yes " }, { icon: "x" }, { icon: "check" }]);
    expect(iconToken("circleCheck")).toBe("{{circleCheck}}");
  });

  it("keeps a token that is no icon as the text typed", () => {
    expect(cellParts("{{nothing}} and {{toString}}")).toEqual([{ text: "{{nothing}} and {{toString}}" }]);
  });

  it("gives a reader of the words alone the words, or the icons' names", () => {
    expect(withoutIcons("{{check}} Included")).toBe("Included");
    expect(withoutIcons("{{x}}", true)).toBe("Cross");
    expect(withoutIcons("Plain")).toBe("Plain");
  });
});
