import { describe, expect, it } from "vitest";

import {
  keptFigure,
  metricsToFix,
  MIN_SPEED_SAMPLES,
  percentile75,
  rateMetric,
  speedBody,
  speedKind,
  speedProblem,
  speedRow,
  speedRows,
  speedValueText,
  type SpeedFigures,
} from "./speed";

const figures = (f: Partial<SpeedFigures>): SpeedFigures => ({ lcp: null, inp: null, cls: null, ttfb: null, ...f });

/** The speed report's rules (D336): what the beacon sends, the kinds of page, the 75th percentile, Google's ratings and what to fix. */
describe("what the beacon sends", () => {
  it("keeps whole milliseconds and the layout shift in thousandths, and drops what is not a measurement", () => {
    expect(keptFigure("lcp", 1234.6)).toBe(1235);
    expect(keptFigure("cls", 0.1234)).toBe(123);
    expect(keptFigure("inp", -1)).toBeNull();
    expect(keptFigure("ttfb", Number.NaN)).toBeNull();
    expect(keptFigure("lcp", 10_000_000)).toBeNull();
    expect(keptFigure("lcp", undefined)).toBeNull();
  });

  it("sends the path without its query, the screen and the figures, and nothing when nothing was measured", () => {
    const body = JSON.parse(speedBody({ store: "shop", path: "/s/shop/no/p/mug?utm_source=x#top", width: 390, values: { lcp: 1800, cls: 0.05 } })!);
    expect(body).toEqual({ store: "shop", path: "/s/shop/no/p/mug", screen: "phone", figures: { lcp: 1800, inp: null, cls: 50, ttfb: null } });
    expect(JSON.parse(speedBody({ store: "shop", path: "/", width: 1440, values: { ttfb: 200 } })!).screen).toBe("computer");
    expect(speedBody({ store: "shop", path: "/", width: 1440, values: {} })).toBeNull();
    expect(speedBody({ store: "", path: "/", width: 1440, values: { ttfb: 1 } })).toBeNull();
  });

  it("refuses figures that are not whole numbers within what a browser reports", () => {
    expect(speedProblem({ lcp: 1200, inp: null })).toBeNull();
    expect(speedProblem({ lcp: 1200.5 })).not.toBeNull();
    expect(speedProblem({ lcp: "1200" })).not.toBeNull();
    expect(speedProblem({ cls: 999_999 })).not.toBeNull();
    expect(speedProblem({})).toBe("nothing was measured");
  });
});

describe("the kind of page", () => {
  it("reads the landing path's shape, never more", () => {
    expect(speedKind("/no")).toBe("home");
    expect(speedKind("/no/p/mug")).toBe("product");
    expect(speedKind("/no/category/cups")).toBe("category");
    expect(speedKind("/no/tag/sale")).toBe("category");
    expect(speedKind("/no/products")).toBe("list");
    expect(speedKind("/no/search")).toBe("list");
    expect(speedKind("/no/blog")).toBe("list");
    expect(speedKind("/no/about")).toBe("page");
    expect(speedKind("/no/blog/hello")).toBe("page");
  });

  it("measures no pay route, unknown place or deeper address", () => {
    expect(speedKind("/no/cart")).toBeNull();
    expect(speedKind("/no/checkout")).toBeNull();
    expect(speedKind("(other)")).toBeNull();
    expect(speedKind("/")).toBeNull();
    expect(speedKind("/no/account/orders/1")).toBeNull();
  });
});

describe("the figures", () => {
  it("takes the 75th percentile by nearest rank", () => {
    expect(percentile75([])).toBeNull();
    expect(percentile75([5])).toBe(5);
    expect(percentile75([4, 1, 3, 2])).toBe(3);
    expect(percentile75(Array.from({ length: 100 }, (_, i) => i + 1))).toBe(75);
  });

  it("rates by Google's thresholds, the edge being good or needing improvement", () => {
    expect(rateMetric("lcp", 2500)).toBe("good");
    expect(rateMetric("lcp", 2501)).toBe("improve");
    expect(rateMetric("lcp", 4000)).toBe("improve");
    expect(rateMetric("lcp", 4001)).toBe("poor");
    expect(rateMetric("inp", 200)).toBe("good");
    expect(rateMetric("cls", 251)).toBe("poor");
    expect(rateMetric("ttfb", 900)).toBe("improve");
  });

  it("gives no figure under the minimum of page loads, and says how many there are", () => {
    const few = Array.from({ length: MIN_SPEED_SAMPLES - 1 }, () => figures({ lcp: 1000 }));
    const row = speedRow("home", "phone", few);
    expect(row.loads).toBe(MIN_SPEED_SAMPLES - 1);
    expect(row.cells.find((c) => c.metric === "lcp")).toEqual({ metric: "lcp", samples: MIN_SPEED_SAMPLES - 1, value: null, rating: null });
    // A figure that was never reported has no samples, even where others do.
    expect(row.cells.find((c) => c.metric === "inp")?.samples).toBe(0);
  });

  it("counts each figure's own page loads, so a missing interaction does not lower the others", () => {
    const loads = [...Array.from({ length: 20 }, () => figures({ lcp: 3000, inp: 100 })), ...Array.from({ length: 10 }, () => figures({ lcp: 3000 }))];
    const row = speedRow("product", "computer", loads);
    expect(row.cells.find((c) => c.metric === "lcp")).toMatchObject({ samples: 30, value: 3000, rating: "improve" });
    expect(row.cells.find((c) => c.metric === "inp")).toMatchObject({ samples: 20, value: 100, rating: "good" });
  });

  it("lists phones first, then each kind in order, leaving out what has no page load", () => {
    const rows = speedRows([
      { ...figures({ lcp: 1 }), kind: "product", screen: "computer" },
      { ...figures({ lcp: 1 }), kind: "home", screen: "computer" },
      { ...figures({ lcp: 1 }), kind: "page", screen: "phone" },
    ]);
    expect(rows.map((r) => `${r.screen}:${r.kind}`)).toEqual(["phone:page", "computer:home", "computer:product"]);
  });

  it("puts what is poor anywhere first, each metric once", () => {
    const of = (lcp: number, inp: number) => Array.from({ length: 20 }, () => figures({ lcp, inp, cls: 10 }));
    const rows = [speedRow("home", "phone", of(3000, 600)), speedRow("home", "computer", of(5000, 100))];
    expect(metricsToFix(rows)).toEqual([
      { metric: "lcp", rating: "poor" },
      { metric: "inp", rating: "poor" },
    ]);
    expect(metricsToFix([speedRow("home", "phone", of(1000, 100))])).toEqual([]);
  });

  it("writes a figure as a person reads it", () => {
    expect(speedValueText("lcp", 2345, "en")).toBe("2.35 s");
    expect(speedValueText("inp", 180, "en")).toBe("180 ms");
    expect(speedValueText("cls", 120, "nb-NO")).toBe("0,12");
  });
});
