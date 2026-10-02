import { describe, expect, it } from "vitest";

import { formatCount } from "./analytics-core";
import {
  decompose,
  dayText,
  explainChange,
  FLAT_BAND,
  LOW_VOLUME_ORDERS,
  lookAtFor,
  movedOn,
  MIN_SEGMENT_ORDERS,
  roundShares,
  type PeriodFigures,
  type SegmentRow,
  type SegmentTable,
} from "./analytics-diagnosis";
import { formatMoney } from "./money";

const fig = (revenueMinor: number, orders: number, sessions: number | null): PeriodFigures => ({ revenueMinor, orders, sessions });
const row = (key: string, label: string, previous: PeriodFigures, current: PeriodFigures): SegmentRow => ({ key, label, previous, current });
const table = (dimension: SegmentTable["dimension"], rows: SegmentRow[]): SegmentTable => ({ dimension, rows });

// The worked example. Before: 10 000 sessions, 300 orders (3.0 %), average order 10 000, revenue 3 000 000.
// Now: 10 300 sessions (+3 %), 275 orders (2.67 %, -11 %), average order 9 400 (-6 %), revenue 2 585 000 (-13.8 %).
const BEFORE = fig(3_000_000, 300, 10_000);
const NOW = fig(2_585_000, 275, 10_300);

describe("decompose", () => {
  it("splits the worked example into traffic, conversion and average order with signed shares that add to 100", () => {
    const d = decompose(NOW, BEFORE)!;
    expect(d.usesSessions).toBe(true);
    expect(d.factors.map((f) => f.key)).toEqual(["traffic", "conversion", "basket"]);
    expect(d.factors[0].changePct).toBeCloseTo(0.03, 12);
    expect(d.factors[1].changePct).toBeCloseTo(275 / 10_300 / (300 / 10_000) - 1, 12);
    expect(d.factors[2].changePct).toBeCloseTo(-0.06, 12);
    // ln(0.86167) = -0.14887: traffic +0.02956 works against (-19.9 %), conversion -0.11656 is 78.3 %, average order -0.06188 is 41.6 %.
    // Rounded down to -20, 78 and 41, the one point left goes to the largest fraction (41.56).
    expect(d.factors.map((f) => f.sharePct)).toEqual([-20, 78, 42]);
    expect(d.mainFactor).toBe("conversion");
  });

  it("holds the identity: the factors' ratios multiply to the revenue ratio", () => {
    const cases: [PeriodFigures, PeriodFigures][] = [
      [NOW, BEFORE],
      [fig(5_000_000, 410, 9000), fig(3_000_000, 300, 10_000)],
      [fig(1, 1, 1), fig(1_000_000, 1000, 1_000_000)],
      [fig(777_777, 31, 4_001), fig(123_456, 17, 80)],
    ];
    for (const [now, before] of cases) {
      const d = decompose(now, before)!;
      const product = d.factors.reduce((p, f) => p * (1 + f.changePct), 1);
      expect(product).toBeCloseTo(now.revenueMinor / before.revenueMinor, 10);
      expect(d.ratio).toBeCloseTo(now.revenueMinor / before.revenueMinor, 12);
    }
  });

  it("holds the identity and the 100 sum without sessions too, over a spread of figures", () => {
    // A small deterministic generator, so the cases are not hand-picked.
    let seed = 12345;
    const next = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let i = 0; i < 300; i++) {
      const sessions = i % 3 === 0 ? null : 1 + Math.floor(next() * 50_000);
      const mk = () => fig(1 + Math.floor(next() * 10_000_000), 1 + Math.floor(next() * 2000), sessions === null ? null : 1 + Math.floor(next() * 50_000));
      const now = mk();
      const before = mk();
      const d = decompose(now, before)!;
      const product = d.factors.reduce((p, f) => p * (1 + f.changePct), 1);
      expect(product).toBeCloseTo(now.revenueMinor / before.revenueMinor, 8);
      if (d.factors[0].sharePct !== null) {
        expect(d.factors.reduce((a, f) => a + (f.sharePct as number), 0)).toBe(100);
        // A factor's sign says whether it worked with or against the revenue move.
        d.factors.forEach((f) => {
          if (Math.abs(f.changePct) > 0.05 && Math.abs(f.sharePct as number) > 2) {
            expect(Math.sign(f.sharePct as number)).toBe(Math.sign(f.changePct) * Math.sign(d.ratio - 1));
          }
        });
      }
    }
  });

  it("uses orders and average order when either period has no visit count", () => {
    for (const [now, before] of [
      [fig(2_000_000, 200, null), fig(3_000_000, 300, null)],
      [fig(2_000_000, 200, 5000), fig(3_000_000, 300, null)],
      [fig(2_000_000, 200, null), fig(3_000_000, 300, 6000)],
      [fig(2_000_000, 200, 0), fig(3_000_000, 300, 6000)],
    ] as [PeriodFigures, PeriodFigures][]) {
      const d = decompose(now, before)!;
      expect(d.usesSessions).toBe(false);
      expect(d.factors.map((f) => f.key)).toEqual(["orders", "basket"]);
    }
    const d = decompose(fig(2_000_000, 200, null), fig(3_000_000, 300, null))!;
    // Orders x2/3, average order unchanged: all of it is orders.
    expect(d.factors[0].changePct).toBeCloseTo(-1 / 3, 12);
    expect(d.factors[1].changePct).toBeCloseTo(0, 12);
    expect(d.factors.map((f) => f.sharePct)).toEqual([100, 0]);
    expect(d.mainFactor).toBe("orders");
  });

  it("gives shares of more than 100 and below 0 when factors pull against each other", () => {
    // Traffic doubles, conversion falls by a third of the way: revenue ratio 0.9 x ... chosen so revenue falls 10 %.
    const d = decompose(fig(900_000, 200, 20_000), fig(1_000_000, 200, 10_000))!;
    const [traffic, conversion, basket] = d.factors;
    expect(traffic.changePct).toBeCloseTo(1, 12);
    expect(conversion.changePct).toBeCloseTo(-0.5, 12);
    expect(basket.changePct).toBeCloseTo(-0.1, 12);
    // ln 0.9 = -0.10536; traffic +0.6931, conversion -0.6931, basket -0.10536.
    expect(traffic.sharePct).toBeLessThan(-600);
    expect(conversion.sharePct).toBeGreaterThan(600);
    expect(d.factors.reduce((a, f) => a + (f.sharePct as number), 0)).toBe(100);
    expect(d.mainFactor).toBe("conversion");
  });

  it("is null when a log cannot be taken", () => {
    expect(decompose(fig(0, 10, 100), fig(100, 10, 100))).toBeNull();
    expect(decompose(fig(100, 0, 100), fig(100, 10, 100))).toBeNull();
    expect(decompose(fig(100, 10, 100), fig(100, 0, 100))).toBeNull();
    expect(decompose(fig(-5, 10, 100), fig(100, 10, 100))).toBeNull();
    expect(decompose(fig(Number.NaN, 10, 100), fig(100, 10, 100))).toBeNull();
  });

  it("gives no shares for a flat change, but still the factors' own changes", () => {
    // Traffic +10 %, conversion -9 %: revenue within a fifth of a percent of level.
    const d = decompose(fig(1_000_500, 200, 11_000), fig(1_000_000, 200, 10_000))!;
    expect(Math.abs(d.ratio - 1)).toBeLessThan(FLAT_BAND);
    expect(d.factors.map((f) => f.sharePct)).toEqual([null, null, null]);
    expect(d.mainFactor).toBeNull();
    expect(d.factors[0].changePct).toBeCloseTo(0.1, 12);
  });
});

describe("roundShares", () => {
  it("adds to exactly 100 by handing the points left to the largest fractions", () => {
    expect(roundShares([1, 1, 1], 3)).toEqual([34, 33, 33]);
    expect(roundShares([50, 30, 20], 100)).toEqual([50, 30, 20]);
    const rounded = roundShares([0.333, 0.333, 0.334], 1);
    expect(rounded.reduce((a, b) => a + b, 0)).toBe(100);
    expect(rounded).toEqual([33, 33, 34]);
  });

  it("works with negative shares", () => {
    const r = roundShares([-0.1986, 0.783, 0.4156], 1);
    expect(r.reduce((a, b) => a + b, 0)).toBe(100);
    expect(r).toEqual([-20, 78, 42]);
  });

  it("handles nothing and a zero total", () => {
    expect(roundShares([], 1)).toEqual([]);
    expect(roundShares([1, 2], 0)).toEqual([0, 0]);
  });

  it("never gives -0", () => {
    const r = roundShares([0, -1], -1);
    expect(r).toEqual([0, 100]);
    expect(Object.is(r[0], 0)).toBe(true);
  });
});

describe("explainChange, the worked example", () => {
  // Mobile fell hard on conversion; desktop grew a little.
  const device = table("device", [
    row("mobile", "Mobile", fig(1_900_000, 190, 5000), fig(1_419_400, 151, 5200)),
    row("desktop", "Desktop", fig(1_100_000, 110, 5000), fig(1_165_600, 124, 5100)),
  ]);

  it("says it as the owner reads it", () => {
    const e = explainChange({ current: NOW, previous: BEFORE, segments: [device] });
    expect(e.direction).toBe("down");
    expect(e.changeMinor).toBe(-415_000);
    expect(e.changePct).toBeCloseTo(-415_000 / 3_000_000, 12);
    expect(e.mainFactor).toBe("conversion");
    expect(e.sentences).toEqual([
      "Revenue is down 14 % on the previous period.",
      "Traffic +3 %, conversion −11 %, average order −6 %.",
      "The biggest fall is on mobile, where conversion fell from 3.8 % to 2.9 %.",
    ]);
    // Desktop grew, so it explains none of the fall; mobile carries more than all of it.
    expect(e.segments).toEqual([{ dimension: "device", label: "Mobile", key: "mobile", changeMinor: -480_600, shareOfChangePct: 116 }]);
    expect(e.lookAt).toEqual({ text: expect.stringContaining("device table"), href: "/analytics/traffic" });
    expect(e.reason).toBeNull();
    expect(e.note).toBeNull();
    expect(e.lowVolume).toBe(false);
    expect(e.startedOn).toBeNull();
  });

  it("is the same without segments, then pointing at the funnel", () => {
    const e = explainChange({ current: NOW, previous: BEFORE });
    expect(e.sentences).toEqual(["Revenue is down 14 % on the previous period.", "Traffic +3 %, conversion −11 %, average order −6 %."]);
    expect(e.segments).toEqual([]);
    expect(e.lookAt).toEqual({ text: expect.stringContaining("funnel"), href: "/analytics/traffic" });
  });

  it("says a rise as a rise", () => {
    const e = explainChange({
      current: BEFORE,
      previous: NOW,
      segments: [table("device", [row("mobile", "Mobile", fig(1_419_400, 151, 5200), fig(1_900_000, 190, 5000))])],
    });
    expect(e.direction).toBe("up");
    expect(e.sentences[0]).toBe("Revenue is up 16 % on the previous period.");
    expect(e.sentences[2]).toBe("The biggest rise is on mobile, where conversion rose from 2.9 % to 3.8 %.");
    expect(e.changeMinor).toBe(415_000);
  });
});

describe("explainChange, other branches", () => {
  it("traffic down by channel: points at Marketing and names the sessions", () => {
    const e = explainChange({
      current: fig(2_400_000, 240, 8000),
      previous: fig(3_000_000, 300, 10_000),
      segments: [
        table("channel", [
          row("paid_search", "Paid search", fig(1_500_000, 150, 5000), fig(900_000, 90, 3000)),
          row("direct", "Direct", fig(1_500_000, 150, 5000), fig(1_500_000, 150, 5000)),
        ]),
      ],
    });
    expect(e.mainFactor).toBe("traffic");
    expect(e.factors.map((f) => f.sharePct)).toEqual([100, 0, 0]);
    expect(e.sentences[0]).toBe("Revenue is down 20 % on the previous period.");
    expect(e.sentences[1]).toBe("Traffic −20 %, conversion 0 %, average order 0 %.");
    expect(e.sentences[2]).toBe(`The biggest fall is in the paid search channel, where sessions fell from ${formatCount(5000)} to ${formatCount(3000)}.`);
    expect(e.segments).toHaveLength(1);
    expect(e.segments[0].shareOfChangePct).toBe(100);
    expect(e.lookAt?.href).toBe("/analytics/marketing");
  });

  it("average order down by product: points at Products; money with a currency, a percentage without", () => {
    const input = {
      current: fig(2_400_000, 300, 10_000),
      previous: fig(3_000_000, 300, 10_000),
      segments: [
        table("product", [
          row("a", "Wool hat", fig(1_000_000, 100, null), fig(700_000, 100, null)),
          row("b", "Scarf", fig(2_000_000, 200, null), fig(1_700_000, 200, null)),
        ]),
      ],
    };
    const withMoney = explainChange({ ...input, currency: "EUR", locale: "en" });
    expect(withMoney.mainFactor).toBe("basket");
    expect(withMoney.sentences[1]).toBe("Traffic 0 %, conversion 0 %, average order −20 %.");
    expect(withMoney.sentences[2]).toBe(`The biggest fall is for Wool hat, where average order fell from ${formatMoney(10_000, "EUR", "en")} to ${formatMoney(7000, "EUR", "en")}.`);
    // Same share: the second is named after the first, in the same dimension.
    expect(withMoney.sentences[3]).toBe(`Another large part is for Scarf, where average order fell from ${formatMoney(10_000, "EUR", "en")} to ${formatMoney(8500, "EUR", "en")}.`);
    expect(withMoney.lookAt?.href).toBe("/analytics/products");
    const withoutMoney = explainChange(input);
    expect(withoutMoney.sentences[2]).toBe("The biggest fall is for Wool hat, where average order fell 30 %.");
  });

  it("orders down without visit counting: names the orders and says traffic was not separated", () => {
    const e = explainChange({
      current: fig(2_000_000, 200, null),
      previous: fig(3_000_000, 300, null),
      segments: [table("market", [row("no", "Norway", fig(2_000_000, 200, null), fig(1_000_000, 100, null)), row("se", "Sweden", fig(1_000_000, 100, null), fig(1_000_000, 100, null))])],
    });
    expect(e.mainFactor).toBe("orders");
    expect(e.factors.map((f) => f.key)).toEqual(["orders", "basket"]);
    expect(e.sentences[0]).toBe("Revenue is down 33 % on the previous period.");
    expect(e.sentences[1]).toBe("Orders −33 %, average order 0 %.");
    expect(e.sentences[2]).toBe(`The biggest fall is in Norway, where orders fell from ${formatCount(200)} to ${formatCount(100)}.`);
    expect(e.note).toMatch(/not separated/);
    expect(e.sentences[e.sentences.length - 1]).toBe(e.note);
    // Orders by market points nowhere in particular.
    expect(e.lookAt).toBeNull();
  });

  it("orders down: a channel or product mover points to Marketing or Products", () => {
    const base = { current: fig(2_000_000, 200, null), previous: fig(3_000_000, 300, null) };
    const ch = explainChange({ ...base, segments: [table("channel", [row("email", "Email", fig(1_000_000, 100, null), fig(100_000, 10, null))])] });
    expect(ch.lookAt?.href).toBe("/analytics/marketing");
    expect(ch.sentences).toContain(`The biggest fall is in the email channel, where orders fell from ${formatCount(100)} to ${formatCount(10)}.`);
    const pr = explainChange({ ...base, segments: [table("product", [row("p", "Mug", fig(1_000_000, 100, null), fig(100_000, 10, null))])] });
    expect(pr.lookAt?.href).toBe("/analytics/products");
  });

  it("falls back to revenue for a segment that cannot be split, and names one with no sales before", () => {
    const e = explainChange({
      current: fig(2_000_000, 200, 5000),
      previous: fig(3_000_000, 300, 5000),
      segments: [
        table("device", [row("tablet", "Tablet", fig(1_000_000, 100, 1000), fig(0, 0, 1000))]),
        table("product", [row("new", "New thing", fig(0, 0, null), fig(0, 12, null))]),
      ],
    });
    expect(e.segments.map((s) => s.key)).toEqual(["tablet"]);
    expect(e.sentences).toContain("The biggest fall is on tablet, where there were no sales in this period.");
    const gone = explainChange({
      current: fig(3_000_000, 300, 5000),
      previous: fig(2_000_000, 200, 5000),
      segments: [table("product", [row("new", "New thing", fig(0, 0, null), fig(1_000_000, 100, null))])],
    });
    expect(gone.sentences).toContain("The biggest rise is for New thing, where there were no sales in the previous period.");
  });

  it("names one mover in each of two dimensions", () => {
    const e = explainChange({
      current: fig(2_000_000, 200, 8000),
      previous: fig(3_000_000, 300, 10_000),
      segments: [
        table("device", [row("mobile", "Mobile", fig(2_000_000, 200, 6000), fig(1_200_000, 120, 4800))]),
        table("channel", [row("social", "Organic social", fig(1_000_000, 100, 3000), fig(500_000, 50, 2000))]),
      ],
    });
    expect(e.segments.map((s) => `${s.dimension}:${s.key}:${s.shareOfChangePct}`)).toEqual(["device:mobile:80", "channel:social:50"]);
    expect(e.sentences.filter((s) => s.startsWith("The biggest fall"))).toHaveLength(1);
    expect(e.sentences.filter((s) => s.startsWith("Another large part is in the organic social channel"))).toHaveLength(1);
  });
});

describe("explainChange, segments", () => {
  const base = { current: fig(2_000_000, 200, 8000), previous: fig(3_000_000, 300, 10_000) };

  it("keeps only segments carrying at least a quarter of the change, in the direction of the change", () => {
    const e = explainChange({
      ...base,
      segments: [
        table("market", [
          row("no", "Norway", fig(1_000_000, 100, 4000), fig(700_000, 70, 3300)), // -300 000 = 30 %
          row("se", "Sweden", fig(1_000_000, 100, 3000), fig(750_000, 80, 2700)), // -250 000 = 25 % exactly
          row("dk", "Denmark", fig(500_000, 50, 1500), fig(300_000, 30, 1000)), // -200 000 = 20 %: under
          row("fi", "Finland", fig(500_000, 50, 1500), fig(1_000_000, 100, 2000)), // grew: worked against
          row("de", "Germany", fig(0, 0, 0), fig(0, 0, 0)), // nothing
        ]),
      ],
    });
    expect(e.changeMinor).toBe(-1_000_000);
    expect(e.segments.map((s) => [s.key, s.shareOfChangePct])).toEqual([
      ["no", 30],
      ["se", 25],
    ]);
  });

  it("leaves out a segment with too few orders in both periods, and keeps one with enough in either", () => {
    const rows = [
      row("a", "Few now and before", fig(1_000_000, MIN_SEGMENT_ORDERS - 1, 100), fig(0, MIN_SEGMENT_ORDERS - 1, 100)),
      row("b", "Enough before", fig(1_000_000, MIN_SEGMENT_ORDERS, 100), fig(0, 1, 100)),
    ];
    const e = explainChange({ ...base, segments: [table("product", rows)] });
    expect(e.segments.map((s) => s.key)).toEqual(["b"]);
  });

  it("returns at most two per dimension, largest first, ties by key", () => {
    const rows = ["d", "c", "b", "a"].map((k) => row(k, k.toUpperCase(), fig(1_000_000, 50, null), fig(750_000, 50, null)));
    const e = explainChange({ ...base, segments: [table("product", rows)] });
    expect(e.segments.map((s) => s.key)).toEqual(["a", "b"]);
    expect(e.segments.map((s) => s.shareOfChangePct)).toEqual([25, 25]);
  });

  it("orders the dimensions' movers by share, then by the dimension's order", () => {
    const e = explainChange({
      ...base,
      segments: [
        table("product", [row("p", "P", fig(1_000_000, 50, null), fig(500_000, 50, null))]),
        table("device", [row("m", "Mobile", fig(1_000_000, 50, 2000), fig(500_000, 50, 2000))]),
        table("channel", [row("c", "Email", fig(1_000_000, 50, 2000), fig(100_000, 50, 2000))]),
      ],
    });
    expect(e.segments.map((s) => s.dimension)).toEqual(["channel", "device", "product"]);
  });

  it("names no segment when there is no change to explain", () => {
    const flat = explainChange({
      current: fig(3_010_000, 300, 10_000),
      previous: BEFORE,
      segments: [table("device", [row("m", "Mobile", fig(1_000_000, 50, 2000), fig(500_000, 50, 2000))])],
    });
    expect(flat.direction).toBe("flat");
    expect(flat.segments).toEqual([]);
  });

  it("copes with empty or missing tables", () => {
    expect(explainChange({ ...base, segments: [] }).segments).toEqual([]);
    expect(explainChange({ ...base, segments: [table("device", [])] }).segments).toEqual([]);
  });
});

describe("explainChange, flat", () => {
  it("is flat within the band and says so without a verdict", () => {
    const e = explainChange({ current: fig(3_040_000, 305, 10_300), previous: BEFORE }); // +1.3 %
    expect(e.direction).toBe("flat");
    expect(e.mainFactor).toBeNull();
    expect(e.lookAt).toBeNull();
    expect(e.factors.every((f) => f.sharePct === null)).toBe(true);
    expect(e.sentences[0]).toBe("Revenue is about level with the previous period (+1.3 %).");
    expect(e.sentences[1]).toMatch(/^Traffic \+3 %, conversion /);
    expect(e.startedOn).toBeNull();
  });

  it("is up or down from the band's edge", () => {
    expect(FLAT_BAND).toBe(0.02);
    expect(explainChange({ current: fig(1_019_000, 100, 1000), previous: fig(1_000_000, 100, 1000) }).direction).toBe("flat");
    expect(explainChange({ current: fig(1_021_000, 100, 1000), previous: fig(1_000_000, 100, 1000) }).direction).toBe("up");
    expect(explainChange({ current: fig(981_000, 100, 1000), previous: fig(1_000_000, 100, 1000) }).direction).toBe("flat");
    expect(explainChange({ current: fig(979_000, 100, 1000), previous: fig(1_000_000, 100, 1000) }).direction).toBe("down");
  });

  it("is flat when nothing changed, with nothing to share out", () => {
    const e = explainChange({ current: BEFORE, previous: BEFORE });
    expect(e.direction).toBe("flat");
    expect(e.changeMinor).toBe(0);
    expect(e.factors.map((f) => f.changePct)).toEqual([0, 0, 0]);
    expect(e.sentences[0]).toBe("Revenue is about level with the previous period (0.0 %).");
  });
});

describe("explainChange, unknown", () => {
  it("is unknown with a reason when a period has no orders, and still gives the change", () => {
    const none = explainChange({ current: fig(0, 0, 500), previous: BEFORE });
    expect(none.direction).toBe("unknown");
    expect(none.reason).toMatch(/no orders in this period/);
    expect(none.changeMinor).toBe(-3_000_000);
    expect(none.changePct).toBe(-1);
    expect(none.factors).toEqual([]);
    expect(none.mainFactor).toBeNull();
    expect(none.segments).toEqual([]);
    expect(none.lookAt).toBeNull();
    expect(none.sentences).toEqual([none.reason]);

    const before = explainChange({ current: NOW, previous: fig(0, 0, 0) });
    expect(before.direction).toBe("unknown");
    expect(before.reason).toMatch(/no orders in the previous period/);
    expect(before.changePct).toBeNull();
    expect(before.changeMinor).toBe(2_585_000);

    const both = explainChange({ current: fig(0, 0, null), previous: fig(0, 0, null) });
    expect(both.direction).toBe("unknown");
    expect(both.reason).toMatch(/either period/);
    expect(both.changeMinor).toBe(0);
  });

  it("is unknown when net revenue is zero or less in a period", () => {
    const e = explainChange({ current: fig(-5000, 20, 1000), previous: BEFORE });
    expect(e.direction).toBe("unknown");
    expect(e.reason).toMatch(/zero or negative/);
    const z = explainChange({ current: BEFORE, previous: fig(0, 20, 1000) });
    expect(z.direction).toBe("unknown");
    expect(z.changePct).toBeNull();
  });

  it("is unknown when a figure is missing altogether", () => {
    const e = explainChange({ current: fig(Number.NaN, 10, 1), previous: BEFORE });
    expect(e.direction).toBe("unknown");
    expect(e.reason).toMatch(/missing/);
    expect(e.changeMinor).toBe(0);
    expect(e.changePct).toBeNull();
  });
});

describe("explainChange, small volumes", () => {
  it("explains but warns when a period has fewer than the minimum orders, and names no segments or start", () => {
    expect(LOW_VOLUME_ORDERS).toBe(10);
    const e = explainChange({
      current: fig(400_000, 8, 400),
      previous: fig(600_000, 12, 400),
      segments: [table("device", [row("m", "Mobile", fig(600_000, 12, 400), fig(400_000, 8, 400))])],
      daily: Array.from({ length: 14 }, (_, i) => ({ day: `2026-09-${String(i + 1).padStart(2, "0")}`, revenueMinor: i < 7 ? 60_000 : 20_000 })),
    });
    expect(e.lowVolume).toBe(true);
    expect(e.direction).toBe("down");
    expect(e.segments).toEqual([]);
    expect(e.startedOn).toBeNull();
    expect(e.note).toBe("Based on few orders (8 now, 12 before), so this may be chance.");
    expect(e.sentences[e.sentences.length - 1]).toBe(e.note);
  });

  it("is not low at the minimum itself, in both periods", () => {
    expect(explainChange({ current: fig(400_000, 10, 400), previous: fig(600_000, 10, 400) }).lowVolume).toBe(false);
    expect(explainChange({ current: fig(400_000, 10, 400), previous: fig(600_000, 9, 400) }).lowVolume).toBe(true);
  });

  it("joins both caveats when visits are missing too", () => {
    const e = explainChange({ current: fig(400_000, 8, null), previous: fig(600_000, 12, null) });
    expect(e.note).toMatch(/not separated.* Based on few orders/);
  });
});

describe("explainChange, when it started", () => {
  const START = "2026-09-01";
  const dayOf = (i: number) => new Date(Date.parse(`${START}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
  const daily = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => ({ day: dayOf(i), revenueMinor: f(i) }));
  /** A previous period of 28 days at 1 000 a day, plenty of orders. */
  const run = (series: { day: string; revenueMinor: number }[], extra: Record<string, unknown> = {}) => {
    const total = series.reduce((a, d) => a + d.revenueMinor, 0);
    return explainChange({ current: fig(total, 100, null), previous: fig(28_000, 100, null), daily: series, ...extra });
  };

  it("finds the first day of a sustained fall: a step from 1 000 to 600 on day 15", () => {
    const e = run(daily(28, (i) => (i < 14 ? 1000 : 600)));
    expect(e.direction).toBe("down");
    expect(e.startedOn).toBe("2026-09-15");
    expect(e.sentences).toContain("The move began around 15 September.");
  });

  it("finds the start of a rise", () => {
    const e = run(daily(28, (i) => (i < 14 ? 1000 : 1500)));
    expect(e.direction).toBe("up");
    expect(e.startedOn).toBe("2026-09-15");
  });

  it("is null when the move began before the period: every 7-day average is already past the threshold", () => {
    const e = run(daily(28, () => 600));
    expect(e.direction).toBe("down");
    expect(e.startedOn).toBeNull();
    expect(e.sentences.some((s) => s.startsWith("The move began"))).toBe(false);
  });

  it("is null when the move has not held for three averages in a row", () => {
    // Only the last three days are low: averages ending on days 26 and 27 are beyond, the one before is not.
    expect(run(daily(28, (i) => (i < 25 ? 1000 : 600))).startedOn).toBeNull();
    // Last five low: 4 averages beyond (days 24 to 27), enough.
    expect(run(daily(28, (i) => (i < 23 ? 1000 : 600))).startedOn).toBe(dayOf(23));
  });

  it("is null when the move came and went", () => {
    // Low in the middle, back to normal at the end: the run ending with the last day is empty.
    expect(run(daily(28, (i) => (i >= 8 && i < 18 ? 400 : 1000)), {}).startedOn).toBeNull();
  });

  it("is null when the average is not far enough from the previous mean: 8 % under is not a sustained fall", () => {
    const e = run(daily(28, (i) => (i < 14 ? 1000 : 920)));
    expect(e.startedOn).toBeNull();
  });

  it("needs ten days: two weeks of averages is not needed, but a window and a run are", () => {
    // Nine days: no.
    expect(movedOn(daily(9, (i) => (i < 5 ? 1000 : 400)), 1000, "down")).toBeNull();
    // Ten days, low from day 7: windows end on days 7 to 9: three beyond of four.
    expect(movedOn(daily(10, (i) => (i < 6 ? 1000 : 400)), 1000, "down")).toBe(dayOf(6));
    // Low from day 7 (index 7): only two of four windows are beyond.
    expect(movedOn(daily(10, (i) => (i < 7 ? 1000 : 400)), 1000, "down")).toBeNull();
  });

  it("is null for a series with a missing day, and uses days given in any order", () => {
    const withHole = daily(28, (i) => (i < 14 ? 1000 : 600)).filter((d) => d.day !== dayOf(5));
    expect(run(withHole).startedOn).toBeNull();
    const shuffled = daily(28, (i) => (i < 14 ? 1000 : 600)).reverse();
    expect(run(shuffled).startedOn).toBe("2026-09-15");
  });

  it("uses the previous period's own length for its mean", () => {
    // The previous period was 56 days at 1 000 a day. Its mean is 1 000, not 2 000 (its revenue over this period's 28 days).
    const series = daily(28, (i) => (i < 14 ? 1000 : 600));
    const previous = fig(56_000, 100, null);
    const current = fig(22_400, 100, null);
    expect(explainChange({ current, previous, daily: series, previousDays: 56 }).startedOn).toBe("2026-09-15");
    // Left out, it is taken as this period's length, a mean of 2 000 that every day is far under: no clear start.
    expect(explainChange({ current, previous, daily: series }).startedOn).toBeNull();
  });

  it("gives no start for a flat change, or without a series, or without a previous mean", () => {
    expect(run(daily(28, () => 1000)).startedOn).toBeNull();
    expect(explainChange({ current: fig(22_400, 100, null), previous: fig(28_000, 100, null) }).startedOn).toBeNull();
    expect(movedOn(daily(28, () => 600), 0, "down")).toBeNull();
    expect(movedOn(undefined, 1000, "down")).toBeNull();
  });

  it("dayText writes a day", () => {
    expect(dayText("2026-09-05")).toBe("5 September");
    expect(dayText("2026-12-31")).toBe("31 December");
  });
});

describe("lookAtFor", () => {
  const mover = (dimension: "device" | "channel" | "market" | "product") => ({ dimension, label: "x", key: "x", changeMinor: -1, shareOfChangePct: 50 });

  it("conversion: the device table when a device moved, else channel conversion when a channel did, else the funnel", () => {
    expect(lookAtFor("conversion", [mover("device"), mover("channel")])).toMatchObject({ href: "/analytics/traffic", text: expect.stringContaining("device") });
    expect(lookAtFor("conversion", [mover("channel")])).toMatchObject({ href: "/analytics/marketing" });
    expect(lookAtFor("conversion", [mover("market")])).toMatchObject({ href: "/analytics/traffic", text: expect.stringContaining("funnel") });
    expect(lookAtFor("conversion", [])).toMatchObject({ href: "/analytics/traffic" });
  });

  it("traffic: Marketing, with or without a channel", () => {
    expect(lookAtFor("traffic", [mover("channel")])?.href).toBe("/analytics/marketing");
    expect(lookAtFor("traffic", [])?.href).toBe("/analytics/marketing");
  });

  it("basket: Products", () => {
    expect(lookAtFor("basket", [mover("product")])?.href).toBe("/analytics/products");
    expect(lookAtFor("basket", [])?.href).toBe("/analytics/products");
  });

  it("orders: Marketing for a channel, Products for a product, else nowhere in particular", () => {
    expect(lookAtFor("orders", [mover("channel")])?.href).toBe("/analytics/marketing");
    expect(lookAtFor("orders", [mover("product")])?.href).toBe("/analytics/products");
    expect(lookAtFor("orders", [mover("market")])).toBeNull();
    expect(lookAtFor("orders", [])).toBeNull();
  });

  it("nothing when there is no main factor (flat or unknown)", () => {
    expect(lookAtFor(null, [mover("device")])).toBeNull();
  });
});
