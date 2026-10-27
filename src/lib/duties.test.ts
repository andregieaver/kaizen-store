import { describe, expect, it } from "vitest";

import {
  bpsOfPercent,
  crossesBorder,
  customsDecision,
  dutyEstimate,
  dutyRowProblem,
  headingRowFor,
  orderCustomsOf,
  parseOrderCustoms,
  percentOfBps,
  shareOut,
  type DutyInput,
  type DutyLine,
  type DutyRow,
  type DutyRowInput,
} from "./duties";

let n = 0;
const row = (over: Partial<DutyRow>): DutyRow => ({
  id: `r${++n}`,
  destination: "GB",
  hsPrefix: "",
  origin: null,
  appliesTo: "any",
  dutyRateBps: null,
  perItemMinor: null,
  thresholdMinor: null,
  vatThresholdMinor: null,
  thresholdCurrency: null,
  thresholdPer: "consignment",
  importVatBps: null,
  shippingInValue: true,
  source: "https://example.test/source",
  verified: false,
  validFrom: null,
  validTo: null,
  ...over,
});

// The table's own starter rows, as the migration writes them (the figures are the migration's; here they only feed the arithmetic).
const GB_BASE = row({ destination: "GB", thresholdMinor: 13500, vatThresholdMinor: 13500, thresholdCurrency: "GBP", source: "https://www.gov.uk/goods-sent-from-abroad/tax-and-duty" });
const GB_TSHIRT = row({ destination: "GB", hsPrefix: "610910", dutyRateBps: 1200 });
const GB_TSHIRT_EU = row({ destination: "GB", hsPrefix: "610910", origin: "EU", dutyRateBps: 0 });
const EU_IOSS_BEFORE = row({ destination: "EU", appliesTo: "scheme", thresholdMinor: 15000, vatThresholdMinor: 15000, thresholdCurrency: "EUR", validTo: "2026-06-30" });
const EU_IOSS_AFTER = row({ destination: "EU", appliesTo: "scheme", perItemMinor: 300, thresholdMinor: 15000, vatThresholdMinor: 15000, thresholdCurrency: "EUR", validFrom: "2026-07-01" });
const EU_NO_SCHEME = row({ destination: "EU", appliesTo: "no_scheme", thresholdMinor: 15000, thresholdCurrency: "EUR" });
const NO_VOEC = row({ destination: "NO", appliesTo: "scheme", thresholdMinor: 299999, vatThresholdMinor: 299999, thresholdCurrency: "NOK", thresholdPer: "item" });
const US_BASE = row({ destination: "US", importVatBps: 0, shippingInValue: false });
const ROWS = [GB_BASE, GB_TSHIRT, GB_TSHIRT_EU, EU_IOSS_BEFORE, EU_IOSS_AFTER, EU_NO_SCHEME, NO_VOEC, US_BASE];

const line = (over: Partial<DutyLine>): DutyLine => ({
  key: "0",
  title: "T-shirt",
  hsCode: "6109100010",
  origin: "CN",
  quantity: 1,
  valueMinor: 20_000,
  vatMinor: 4_000,
  vatRateBps: 2_000,
  ...over,
});

const input = (over: Partial<DutyInput>): DutyInput => ({
  destination: "GB",
  dispatch: "NO",
  on: "2026-10-27",
  currency: "GBP",
  scheme: false,
  lines: [line({})],
  shippingMinor: 1_000,
  shippingVatMinor: 200,
  rows: ROWS,
  factorTo: () => null,
  ...over,
});

describe("dutyEstimate", () => {
  it("works out duty and import VAT above the UK's threshold, rounding half up", () => {
    const e = dutyEstimate(input({}));
    expect(e.kind).toBe("estimate");
    if (e.kind !== "estimate") return;
    // 12 % of the goods and shipping (200.00 + 10.00): 25.20; import VAT 20 % of 210.00 + 25.20 = 47.04, of which 42.00 is in the price.
    expect(e.dutyMinor).toBe(2_520);
    expect(e.importVatMinor).toBe(4_704);
    expect(e.ddpMinor).toBe(2_520 + 504);
    expect(e.dapMinor).toBe(2_520 + 4_704);
    expect(e.lines[0]).toMatchObject({ customsValueMinor: 21_000, rateBps: 1200, underThreshold: false });
    expect(e.verified).toBe(false);
    expect(e.sources).toEqual(["https://www.gov.uk/goods-sent-from-abroad/tax-and-duty", "https://example.test/source"]);
  });

  it("charges nothing at or below the UK's 135 GBP, where the VAT is in the price", () => {
    const e = dutyEstimate(input({ lines: [line({ valueMinor: 13_500, vatMinor: 2_700 })] }));
    expect(e).toMatchObject({ kind: "estimate", dutyMinor: 0, importVatMinor: 0, ddpMinor: 0, dapMinor: 0 });
    const over = dutyEstimate(input({ lines: [line({ valueMinor: 13_501, vatMinor: 2_700 })] }));
    expect(over.kind === "estimate" && over.dutyMinor > 0).toBe(true);
  });

  it("takes an origin's preferential row before the heading's own", () => {
    const e = dutyEstimate(input({ lines: [line({ origin: "DE" })] }));
    expect(e.kind === "estimate" && e.dutyMinor).toBe(0);
    expect(headingRowFor([GB_TSHIRT, GB_TSHIRT_EU], "6109100010", "SE")).toBe(GB_TSHIRT_EU);
    expect(headingRowFor([GB_TSHIRT, GB_TSHIRT_EU], "6109100010", null)).toBe(GB_TSHIRT);
    expect(headingRowFor([GB_TSHIRT, GB_TSHIRT_EU], "6110200000", "CN")).toBeNull();
  });

  it("gives no estimate for a line without an HS code, naming it, never a zero duty", () => {
    const e = dutyEstimate(input({ lines: [line({}), line({ key: "1", title: "Mug", hsCode: null })] }));
    expect(e).toEqual({ kind: "unknown", reason: "missing_hs", lines: [{ key: "1", title: "Mug" }] });
  });

  it("gives no estimate for a heading the table has no rate for", () => {
    const e = dutyEstimate(input({ lines: [line({ hsCode: "640399" })] }));
    expect(e).toEqual({ kind: "unknown", reason: "no_rate", lines: [{ key: "0", title: "T-shirt" }] });
  });

  it("gives no estimate for a country the table does not have", () => {
    expect(dutyEstimate(input({ destination: "CH" }))).toMatchObject({ kind: "unknown", reason: "not_in_table" });
  });

  it("converts a euro basket to the threshold's currency, and gives none without a rate", () => {
    // 1 euro cent is 0.85 pence: 200.00 EUR is 170.00 GBP, over the threshold.
    const e = dutyEstimate(input({ currency: "EUR", factorTo: (c) => (c === "GBP" ? 0.85 : null) }));
    expect(e).toMatchObject({ kind: "estimate", currency: "EUR", dutyMinor: 2_520 });
    // 150.00 EUR is 127.50 GBP: under it.
    const under = dutyEstimate(input({ currency: "EUR", lines: [line({ valueMinor: 15_000, vatMinor: 3_000 })], factorTo: (c) => (c === "GBP" ? 0.85 : null) }));
    expect(under).toMatchObject({ kind: "estimate", dutyMinor: 0, importVatMinor: 0 });
    expect(dutyEstimate(input({ currency: "EUR" }))).toMatchObject({ kind: "unknown", reason: "no_currency_rate" });
  });

  it("rounds a value on the threshold up, never into it", () => {
    // 135.00 GBP is 15882.35... euro cents at 0.85: 15883 cents is 135.0055 GBP, rounded up to 135.01: over.
    const e = dutyEstimate(input({ currency: "EUR", lines: [line({ valueMinor: 15_883 })], factorTo: () => 0.85 }));
    expect(e.kind === "estimate" && e.lines[0].underThreshold).toBe(false);
    const at = dutyEstimate(input({ currency: "EUR", lines: [line({ valueMinor: 15_882 })], factorTo: () => 0.85 }));
    expect(at.kind === "estimate" && at.lines[0].underThreshold).toBe(true);
  });

  it("sees no border inside one country or inside the EU, and nothing shipped as nothing to declare", () => {
    expect(dutyEstimate(input({ destination: "NO", dispatch: "NO" }))).toEqual({ kind: "none", reason: "no_border" });
    expect(dutyEstimate(input({ destination: "DE", dispatch: "SE" }))).toEqual({ kind: "none", reason: "no_border" });
    expect(dutyEstimate(input({ lines: [] }))).toEqual({ kind: "none", reason: "nothing_shipped" });
    expect(dutyEstimate(input({ dispatch: null }))).toMatchObject({ kind: "unknown", reason: "no_dispatch" });
    expect(crossesBorder("NO", "SE")).toBe(true);
    expect(crossesBorder("SE", "NO")).toBe(true);
    expect(crossesBorder("DE", "FR")).toBe(false);
  });

  it("follows the EU's dated rule: relief to 30 June 2026, then 3 EUR per distinct sub-heading for IOSS, in euro", () => {
    const eu = (on: string, scheme: boolean) =>
      dutyEstimate(
        input({
          destination: "SE",
          dispatch: "NO",
          currency: "EUR",
          on,
          scheme,
          lines: [
            line({ key: "0", hsCode: "6109100010", valueMinor: 4_000, vatMinor: 1_000, vatRateBps: 2_500 }),
            line({ key: "1", hsCode: "6109100090", valueMinor: 4_000, vatMinor: 1_000, vatRateBps: 2_500 }),
            line({ key: "2", title: "Bag", hsCode: "420222", valueMinor: 4_000, vatMinor: 1_000, vatRateBps: 2_500 }),
          ],
        }),
      );
    expect(eu("2026-06-30", true)).toMatchObject({ kind: "estimate", dutyMinor: 0, importVatMinor: 0 });
    // Two sub-headings (610910 twice, 420222 once): 6.00 EUR, given to the first line of each.
    const after = eu("2026-07-01", true);
    expect(after).toMatchObject({ kind: "estimate", dutyMinor: 600, importVatMinor: 0, ddpMinor: 600, dapMinor: 600 });
    expect(after.kind === "estimate" && after.lines.map((l) => l.dutyMinor)).toEqual([300, 0, 300]);
    // Outside IOSS the relief stays, and the import VAT is due at the border: 25 % of 120.00 and shipping 10.00 = 32.50.
    const outside = eu("2026-07-01", false);
    expect(outside).toMatchObject({ kind: "estimate", dutyMinor: 0, importVatMinor: 3_250 });
  });

  it("converts the EU's fixed amount back into the order's currency", () => {
    // 1 øre is 0.0085 euro cents... as the store's rates give it: 1 NOK minor = 0.085 EUR minor (11.76 NOK to the euro).
    const e = dutyEstimate(
      input({ destination: "DK", dispatch: "NO", currency: "NOK", scheme: true, lines: [line({ valueMinor: 100_000, vatMinor: 25_000 })], factorTo: (c) => (c === "EUR" ? 0.085 : null) }),
    );
    // 1000.00 NOK is 85.00 EUR: under 150; 3 EUR is 35.29 NOK (300 / 0.085 = 3529.41, half up).
    expect(e).toMatchObject({ kind: "estimate", dutyMinor: 3_529 });
  });

  it("applies Norway's VOEC threshold per item, for a seller in the scheme only", () => {
    const voec = dutyEstimate(
      input({ destination: "NO", dispatch: "SE", currency: "NOK", scheme: true, lines: [line({ quantity: 3, valueMinor: 899_997, vatMinor: 224_999, vatRateBps: 2_500 })] }),
    );
    // 8999.97 NOK for three: 2999.99 each, inside the limit.
    expect(voec).toMatchObject({ kind: "estimate", dutyMinor: 0, importVatMinor: 0 });
    const dear = dutyEstimate(input({ destination: "NO", dispatch: "SE", currency: "NOK", scheme: true, lines: [line({ valueMinor: 300_000, vatMinor: 75_000 })] }));
    expect(dear).toMatchObject({ kind: "unknown", reason: "no_rate" });
    expect(dutyEstimate(input({ destination: "NO", dispatch: "SE", currency: "NOK", scheme: false }))).toMatchObject({ kind: "unknown", reason: "not_in_table" });
  });

  it("leaves shipping out of the customs value where the destination does, with no import VAT where there is none", () => {
    const usTshirt = row({ destination: "US", hsPrefix: "610910", dutyRateBps: 1650, verified: true });
    const e = dutyEstimate(input({ destination: "US", currency: "USD", rows: [US_BASE, usTshirt], lines: [line({ vatMinor: 0, vatRateBps: 0 })] }));
    // 16.5 % of 200.00 = 33.00; no import VAT.
    expect(e).toMatchObject({ kind: "estimate", dutyMinor: 3_300, importVatMinor: 0, ddpMinor: 3_300, dapMinor: 3_300 });
    expect(e.kind === "estimate" && e.lines[0].customsValueMinor).toBe(20_000);
  });

  it("is verified only when every row it used was", () => {
    const verified = [row({ destination: "US", importVatBps: 0, shippingInValue: false, verified: true }), row({ destination: "US", hsPrefix: "6109", dutyRateBps: 1000, verified: true })];
    const e = dutyEstimate(input({ destination: "US", currency: "USD", rows: verified, lines: [line({ vatMinor: 0, vatRateBps: 0 })] }));
    expect(e.kind === "estimate" && e.verified).toBe(true);
  });

  it("shares the shipping over the lines by value, to the minor unit", () => {
    expect(shareOut(1_000, [1, 1, 1])).toEqual([334, 333, 333]);
    expect(shareOut(1_001, [2, 1])).toEqual([667, 334]);
    expect(shareOut(500, [0, 0])).toEqual([500, 0]);
    expect(shareOut(7, [])).toEqual([]);
    const two = dutyEstimate(input({ lines: [line({ key: "a", valueMinor: 10_000, vatMinor: 2_000 }), line({ key: "b", valueMinor: 10_000, vatMinor: 2_000 })] }));
    expect(two.kind === "estimate" && two.lines.map((l) => l.customsValueMinor)).toEqual([10_500, 10_500]);
  });
});

describe("customsDecision and the order's record", () => {
  const estimate = dutyEstimate(input({}));
  const unknown = dutyEstimate(input({ lines: [line({ hsCode: null })] }));
  const none = dutyEstimate(input({ dispatch: "GB" }));

  it("collects the DDP amount at checkout, and nothing for DAP", () => {
    expect(customsDecision("ddp", estimate, null)).toMatchObject({ mode: "ddp", collectMinor: 3_024, blocked: false });
    expect(customsDecision("dap", estimate, null)).toMatchObject({ mode: "dap", collectMinor: 0, blocked: false });
  });

  it("blocks a DDP checkout with no estimate, never collecting zero", () => {
    expect(customsDecision("ddp", unknown, null)).toMatchObject({ mode: "ddp", collectMinor: 0, blocked: true });
    expect(customsDecision("dap", unknown, null)).toMatchObject({ blocked: false });
  });

  it("falls back to DAP for a purchase DDP cannot be collected for", () => {
    expect(customsDecision("ddp", estimate, "terms")).toMatchObject({ chosen: "ddp", mode: "dap", fallback: "terms", collectMinor: 0, blocked: false });
    expect(customsDecision("dap", estimate, "terms").fallback).toBeNull();
  });

  it("keeps no record where nothing crosses a border, and reads back what it keeps", () => {
    expect(orderCustomsOf(customsDecision("ddp", none, null), "GB", "GBP", "2026-10-27")).toBeNull();
    const kept = orderCustomsOf(customsDecision("ddp", estimate, null), "GB", "GBP", "2026-10-27");
    expect(kept).toMatchObject({ mode: "ddp", collectedMinor: 3_024, estimate: { dutyMinor: 2_520, importVatMinor: 4_704, dapMinor: 7_224, verified: false }, reason: null });
    expect(parseOrderCustoms(JSON.parse(JSON.stringify(kept)))).toEqual(kept);
    const missing = orderCustomsOf(customsDecision("dap", unknown, null), "GB", "GBP", "2026-10-27");
    expect(parseOrderCustoms(missing)).toMatchObject({ mode: "dap", estimate: null, reason: "missing_hs", collectedMinor: 0 });
    expect(parseOrderCustoms(null)).toBeNull();
    expect(parseOrderCustoms({ v: 2 })).toBeNull();
  });
});

describe("a row as the platform's admin enters it", () => {
  const ok: DutyRowInput = {
    destination: "GB",
    hsPrefix: "6109",
    origin: null,
    appliesTo: "any",
    dutyRateBps: 1200,
    perItemMinor: null,
    thresholdMinor: null,
    vatThresholdMinor: null,
    thresholdCurrency: null,
    thresholdPer: "consignment",
    importVatBps: null,
    shippingInValue: true,
    source: "https://www.trade-tariff.service.gov.uk/commodities/6109100010",
    note: "",
    checkedOn: "2026-10-27",
    verified: false,
    validFrom: null,
    validTo: null,
  };

  it("passes a heading row and refuses what the database would", () => {
    expect(dutyRowProblem(ok)).toBeNull();
    expect(dutyRowProblem({ ...ok, dutyRateBps: null })).toMatch(/duty rate/);
    expect(dutyRowProblem({ ...ok, thresholdMinor: 100, thresholdCurrency: "GBP" })).toMatch(/base row/);
    expect(dutyRowProblem({ ...ok, source: "http://example.com" })).toMatch(/address/);
    expect(dutyRowProblem({ ...ok, destination: "gb" })).toMatch(/destination/);
    expect(dutyRowProblem({ ...ok, hsPrefix: "", origin: "EU" })).toMatch(/every origin/);
    expect(dutyRowProblem({ ...ok, hsPrefix: "", dutyRateBps: null, thresholdMinor: 13500 })).toMatch(/currency/);
    expect(dutyRowProblem({ ...ok, validFrom: "2026-07-01", validTo: "2026-06-30" })).toMatch(/end before/);
  });

  it("reads and writes a percentage as basis points", () => {
    expect(bpsOfPercent("12.5")).toBe(1250);
    expect(bpsOfPercent("12,5")).toBe(1250);
    expect(bpsOfPercent("0")).toBe(0);
    expect(bpsOfPercent("")).toBeNull();
    expect(bpsOfPercent("12.555")).toBeNaN();
    expect(percentOfBps(1250)).toBe("12.5 %");
    expect(percentOfBps(1200)).toBe("12 %");
    expect(percentOfBps(1205)).toBe("12.05 %");
  });
});
