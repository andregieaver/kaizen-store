import { describe, expect, it } from "vitest";

import { checkReading, READING_SYSTEM, readingMessage, recordingNote, toolsWorthReading, type AdminFigures, type ToolFigure } from "./admin-behaviour";
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

describe("admin heatmaps and recording notes in the reading (D895 phase 3b)", () => {
  const withUse: AdminFigures = {
    ...figures,
    tools: [],
    screens: [],
    use: [{ screen: "s/settings/payments", views: 40, frustratedPct: 35, endPct: 10, deadClicks: 18, rageClicks: 5 }],
    notes: [{ label: "r1", id: "3f2b8c1e-7a4d-4b9e-9c2a-1d5e6f7a8b9c", screens: ["s/settings/payments"], text: "0:00 opened s/settings/payments; 0:12 a click that did nothing; ended at 1:35" }],
  };

  it("writes a recording's note from its page and click events alone, never a word or a screen that is not measured", () => {
    const at = (ms: number, tag: string, payload: Record<string, unknown>) => ({ type: 5, timestamp: 1000 + ms, data: { tag, payload } });
    const note = recordingNote([
      { type: 4, timestamp: 1000, data: { href: "s/settings/payments" } },
      at(0, "kz-page", { path: "s/settings/payments" }),
      { type: 3, timestamp: 5000, data: { source: 0, texts: [{ id: 1, value: "•••" }] } },
      at(12_000, "kz-click", { dead: true, rage: false }),
      at(14_000, "kz-click", { dead: false, rage: true }),
      at(20_000, "kz-page", { path: "s/orders" }),
      at(40_000, "kz-page", { path: "s/products/new" }),
      at(95_000, "other", { name: "Kari" }),
    ]);
    expect(note).toBe("0:00 opened s/settings/payments; 0:12 a click that did nothing; 0:14 a burst of clicks; 0:40 opened s/products/new; ended at 1:35");
    expect(recordingNote([{ type: 3, timestamp: 1, data: {} }])).toBeNull();
  });

  it("hands the model each screen's figures and the notes, and keeps a proposal that cites a screen's number, with its recordings", () => {
    expect(readingMessage(withUse)).toContain("admin screen s/settings/payments: 40 views, 35% with a dead or rage click, 10% scrolled to the end, 18 dead clicks, 5 rage clicks");
    expect(readingMessage(withUse)).toContain("recording r1 (s/settings/payments): 0:00 opened s/settings/payments;");
    const kept = checkReading(answer([{ subject: "s/settings/payments", title: "Say why a payment setting cannot be saved", why: "Owners click Save and nothing happens.", figure: 35 }]), withUse);
    expect(kept).toHaveLength(1);
    expect(kept[0].facts).toMatchObject({ adminScreen: "s/settings/payments", frustratedPct: 35, recordings: "3f2b8c1e-7a4d-4b9e-9c2a-1d5e6f7a8b9c" });
  });

  it("drops a number taken from a note, not from the figures", () => {
    expect(checkReading(answer([{ subject: "s/settings/payments", title: "x", why: "y", figure: 12 }]), withUse)).toEqual([]);
    expect(checkReading(answer([{ subject: "r1", title: "x", why: "y", figure: 40 }]), withUse)).toEqual([]);
  });
});
