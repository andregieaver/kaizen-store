import { describe, expect, it } from "vitest";

import { checkReading, READING_SYSTEM, readingMessage, toolsWorthReading, type AdminFigures, type ToolFigure } from "./admin-behaviour";
import { UNTRUSTED_TEXT } from "./prompt-safety";

/** Learning from how owners use the admin (D895 phase 3a): the figures read, and the model's answer checked in code. */
const tool = (over: Partial<ToolFigure>): ToolFigure => ({ tool: "set_price", calls: 40, failed: 6, failedPct: 15, up: 2, down: 4, ...over });
const figures: AdminFigures = {
  from: "2026-11-18",
  to: "2026-11-25",
  tools: [tool({})],
  screens: [{ screen: "orders", kind: "admin", loads: 210, metric: "inp", p75Ms: 640, rating: "poor" }],
};
const answer = (proposals: unknown[]) => JSON.stringify({ proposals });

describe("the figures worth reading", () => {
  it("keeps a tool with enough calls that fails or is rated down, and leaves out the rest", () => {
    expect(toolsWorthReading([tool({ calls: 19 })])).toEqual([]);
    expect(toolsWorthReading([tool({ failed: 0, failedPct: 0, up: 9, down: 0 })])).toEqual([]);
    expect(toolsWorthReading([tool({ failed: 0, failedPct: 0, up: 1, down: 3 })])).toHaveLength(0);
    expect(toolsWorthReading([tool({ failed: 0, failedPct: 0, up: 2, down: 3 })])).toHaveLength(1);
    expect(toolsWorthReading([tool({})])).toHaveLength(1);
  });

  it("hands the model figures only, under the rule for untrusted text", () => {
    expect(READING_SYSTEM).toContain(UNTRUSTED_TEXT);
    expect(readingMessage(figures)).toBe(
      "The week 2026-11-18 to 2026-11-25.\ntool set_price: 40 calls, 6 failed (15%), 2 thumbs up, 4 thumbs down\nscreen orders (admin): 210 loads, inp p75 640 ms, poor",
    );
  });
});

describe("the model's answer, checked in code", () => {
  it("keeps a proposal that names a subject it was given and cites one of its numbers", () => {
    const kept = checkReading(answer([{ subject: "set_price", title: "Explain why a price change fails", why: "It fails often.", figure: 15 }]), figures);
    expect(kept).toHaveLength(1);
    expect(kept[0].facts).toMatchObject({ tool: "set_price", failedPct: 15 });
  });

  it("drops an invented number, an invented subject, a second proposal on one subject and bad JSON", () => {
    expect(checkReading(answer([{ subject: "set_price", title: "x", why: "y", figure: 37 }]), figures)).toEqual([]);
    expect(checkReading(answer([{ subject: "refund_order", title: "x", why: "y", figure: 40 }]), figures)).toEqual([]);
    expect(checkReading(answer([{ subject: "orders", title: "a", why: "b", figure: 640 }, { subject: "orders", title: "c", why: "d", figure: 210 }]), figures)).toHaveLength(1);
    expect(checkReading("I think you should make it faster.", figures)).toEqual([]);
  });

  it("keeps at most three", () => {
    const many: AdminFigures = { ...figures, tools: ["a_one", "a_two", "a_three", "a_four"].map((name) => tool({ tool: name })) };
    const proposals = many.tools.map((t) => ({ subject: t.tool, title: "Fix it", why: "It fails.", figure: 6 }));
    expect(checkReading(answer(proposals), many)).toHaveLength(3);
  });
});
