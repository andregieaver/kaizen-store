import { describe, expect, it } from "vitest";

import { blockHasContent, blockText, newPageContent, pageInput } from "./page-content";
import { newBlock } from "./page-rows";
import { blockTextFields } from "./page-translation";

/** The newer page components (D91): what each keeps, refuses and shows. */

const page = (blocks: unknown[]) => ({
  ...newPageContent(),
  title: "Components",
  slug: "components",
  rows: [{ id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks }] }],
});
const parse = (block: unknown) => pageInput.parse(page([block])).rows[0].columns[0].blocks[0];
const problems = (block: unknown) => {
  const parsed = pageInput.safeParse(page([block]));
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
};

describe("separator lines", () => {
  it("starts as a plain line and keeps its look within limits", () => {
    const line = newBlock("separator", () => "s");
    expect(line).toEqual({ id: "s", type: "separator" });
    expect(blockHasContent(line)).toBe(true);
    expect(blockText(line)).toBe("");
    expect(blockTextFields(line)).toEqual([]);
    const styled = { id: "s", type: "separator", line: "dashed", thickness: 4, color: "#ff0000", width: 50, position: "left" };
    expect(parse(styled)).toEqual(styled);
    expect(problems({ id: "s", type: "separator", thickness: 40 })).toEqual(["Keep a line at most 16 pixels thick."]);
    expect(problems({ id: "s", type: "separator", width: 5 })).toEqual(["Make a line at least 10 % of its column."]);
    expect(problems({ id: "s", type: "separator", line: "wavy" })).toHaveLength(1);
  });
});
