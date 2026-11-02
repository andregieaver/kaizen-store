import { describe, expect, it } from "vitest";

import { initialSteps, type DreamSteps } from "./dream-factory";
import { MOCK_GREYS, agoMinutes, latestMade, mockColours, safeColour, safeFont, showcaseProgress, siteOf, stepMinutes } from "./dream-showcase";

/** Watching the Dream Factory build (D419): the progress, the minutes, the feed and the mock-up's colours and fonts made safe. */

const at = (iso: string) => new Date(iso);
const START = at("2026-11-02T10:00:00Z");

function steps(over: Partial<DreamSteps>): DreamSteps {
  return { ...initialSteps(), ...over };
}

describe("the run's progress", () => {
  it("counts the steps passed, names what works now and the minutes since the start", () => {
    const p = showcaseProgress(
      steps({
        brief: { status: "done", tries: 1 },
        confirm: { status: "done", tries: 0 },
        research: { status: "running", tries: 1 },
        setup: { status: "skipped", tries: 0 },
        brand: { status: "asking", tries: 1 },
      }),
      START,
      at("2026-11-02T10:07:59Z"),
    );
    expect(p).toEqual({ done: 3, total: 16, percent: 19, now: ["research", "brand"], next: null, minutes: 7 });
  });

  it("names the next step waiting when nothing works, and never a minute before the start", () => {
    const p = showcaseProgress(steps({ brief: { status: "done", tries: 1 } }), START, at("2026-11-02T09:59:00Z"));
    expect(p).toMatchObject({ done: 1, now: [], next: "confirm", minutes: 0 });
  });

  it("is whole when every step has passed", () => {
    const all = Object.fromEntries(Object.keys(initialSteps()).map((id) => [id, { status: "done", tries: 1 }])) as DreamSteps;
    expect(showcaseProgress(all, START, START)).toMatchObject({ done: 16, percent: 100, now: [], next: null });
  });
});

describe("a step's minutes", () => {
  const now = at("2026-11-02T10:30:00Z");
  it("is how long a finished step took, at least one", () => {
    expect(stepMinutes({ status: "done", startedAt: "2026-11-02T10:00:00Z", finishedAt: "2026-11-02T10:04:20Z" }, now)).toBe(4);
    expect(stepMinutes({ status: "done", startedAt: "2026-11-02T10:00:00Z", finishedAt: "2026-11-02T10:00:05Z" }, now)).toBe(1);
  });
  it("runs on while a step works or asks, and is nothing before it starts or once it stopped unfinished", () => {
    expect(stepMinutes({ status: "running", startedAt: "2026-11-02T10:20:00Z" }, now)).toBe(10);
    expect(stepMinutes({ status: "asking", startedAt: "2026-11-02T10:28:00Z" }, now)).toBe(2);
    expect(stepMinutes({ status: "waiting" }, now)).toBeNull();
    expect(stepMinutes({ status: "failed", startedAt: "2026-11-02T10:20:00Z" }, now)).toBeNull();
  });
});

describe("the feed", () => {
  it("keeps the newest first, at most the number asked", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ at: `2026-11-02T10:0${i}:00Z`, kind: "product" as const, label: `P${i}` }));
    const latest = latestMade(items);
    expect(latest).toHaveLength(8);
    expect(latest[0].label).toBe("P9");
    expect(latest.at(-1)?.label).toBe("P2");
    expect(latestMade(items, 2).map((i) => i.label)).toEqual(["P9", "P8"]);
  });
  it("says how many whole minutes ago, never less than none", () => {
    expect(agoMinutes("2026-11-02T10:00:00Z", at("2026-11-02T10:02:59Z"))).toBe(2);
    expect(agoMinutes("2026-11-02T10:05:00Z", at("2026-11-02T10:00:00Z"))).toBe(0);
  });
});

describe("what is safe to show and put in a style", () => {
  it("shows a source as its site, and leaves out what is not an address", () => {
    expect(siteOf("https://www.Example.com/path?q=1")).toBe("example.com");
    expect(siteOf("https://shop.example.no")).toBe("shop.example.no");
    expect(siteOf("not an address")).toBeNull();
  });

  it("puts only a hex colour in a style", () => {
    expect(safeColour("#1A2b3c", "#fff")).toBe("#1A2b3c");
    expect(safeColour(" #abc ", "#fff")).toBe("#abc");
    expect(safeColour("red; background: url(x)", "#fff")).toBe("#fff");
    expect(safeColour("rgb(0,0,0)", "#fff")).toBe("#fff");
    expect(safeColour(42, "#fff")).toBe("#fff");
  });

  it("puts only a plain font name in a style, quoted, with its generic family", () => {
    expect(safeFont("Playfair Display", "serif")).toBe('"Playfair Display", serif');
    expect(safeFont("Inter")).toBe('"Inter", sans-serif');
    expect(safeFont('Inter"; color: red')).toBe("sans-serif");
    expect(safeFont("")).toBe("sans-serif");
    expect(safeFont(undefined, "serif")).toBe("serif");
  });

  it("colours the mock-up from the look, grey where the look has no safe colour or no look yet", () => {
    expect(mockColours(null)).toBe(MOCK_GREYS);
    const c = mockColours({ background: "#fafaf7", accent: "#7a3e2b", text: "expression(alert(1))" });
    expect(c).toMatchObject({ background: "#fafaf7", accent: "#7a3e2b", text: MOCK_GREYS.text, surface: MOCK_GREYS.surface });
  });
});
