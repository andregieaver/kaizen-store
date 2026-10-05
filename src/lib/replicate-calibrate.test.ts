import { describe, expect, it } from "vitest";

import { calibrate } from "./replicate-calibrate";
import type { PartInfo } from "./replicate-build";
import type { Box, CaptureNode, PageCapture } from "./replicate-capture";
import type { StyleModel } from "./replicate-styles";

const node = (id: string, box: Box): CaptureNode => ({ p: id, id, tag: "div", box, s: { display: "block" }, children: [] });
const capture = (...nodes: CaptureNode[]): PageCapture => ({
  viewport: { w: 390, h: 844 },
  url: "https://example.com/",
  title: "",
  lang: "nb",
  description: "",
  docWidth: 390,
  docHeight: 1000,
  background: "rgb(255, 255, 255)",
  root: { p: "", tag: "body", box: [0, 0, 390, 1000], s: { display: "block" }, children: nodes },
  fonts: [],
  left: { fixed: [], hidden: 0, capped: false },
});
const part = (id: string, kind: PartInfo["kind"], box: Box): PartInfo => ({ id, path: id, kind, row: "row", label: id, target: box, targetM: box });

describe("calibrating a row whose columns are stacked (phones)", () => {
  // Two columns one under the other, two blocks each. In the copy the second block of the first column stands 20 px low, which carries the whole second column 20 px down.
  const parts: PartInfo[] = [
    part("row", "row", [0, 0, 390, 300]),
    part("c1", "column", [0, 0, 390, 140]),
    part("a1", "block", [0, 0, 390, 40]),
    part("b1", "block", [0, 60, 390, 40]),
    part("c2", "column", [0, 150, 390, 140]),
    part("a2", "block", [0, 150, 390, 40]),
    part("b2", "block", [0, 210, 390, 40]),
  ];
  const copy = capture(node("row", [0, 0, 390, 320]), node("c1", [0, 0, 390, 160]), node("a1", [0, 0, 390, 40]), node("b1", [0, 80, 390, 40]), node("c2", [0, 170, 390, 140]), node("a2", [0, 170, 390, 40]), node("b2", [0, 230, 390, 40]));

  it("moves only the block that was low: what that carried down is not corrected again in the column below", () => {
    const model: StyleModel = { rules: [] };
    const result = calibrate(model, parts, copy, false);
    expect(result.blocks).toBe(1);
    const margin = (id: string) => model.rules.find((r) => r.id === id && r.suffix === "")?.desktop["margin-top"];
    expect(margin("b1")).toBe("-20px");
    expect(margin("a2")).toBeUndefined();
    expect(margin("b2")).toBeUndefined();
    // The row's own height then needs no change: the one block's 20 px was the whole of its 20 px.
    expect(model.rules.find((r) => r.id === "row" && r.suffix === "")?.desktop["padding-bottom"]).toBeUndefined();
  });
});

describe("a phone's rule says only what differs from computers'", () => {
  it("takes the value in force from computers' rule when phones have none, so a second pass does not add the same correction twice", () => {
    const parts: PartInfo[] = [part("row", "row", [0, 0, 390, 100]), part("c", "column", [0, 0, 390, 100]), part("a", "block", [0, 30, 390, 40])];
    const copy = capture(node("row", [0, 0, 390, 100]), node("c", [0, 0, 390, 100]), node("a", [0, 40, 390, 40]));
    const model: StyleModel = { rules: [{ id: "a", suffix: "", desktop: { "margin-top": "30px" }, mobile: {} }] };
    calibrate(model, parts, copy, true);
    // The block stands 10 px low where the margin in force is 30: the phone's rule becomes 20.
    expect(model.rules.find((r) => r.id === "a" && r.suffix === "")?.mobile["margin-top"]).toBe("20px");
  });
});
