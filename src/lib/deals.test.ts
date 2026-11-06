import { describe, expect, it } from "vitest";

import { toRates } from "./currency";
import { boardColumns, cleanDealInput, cleanReason, daysInStage, dealValue, weighted, whoLine, type BoardDeal } from "./deals";

const PIPELINE = "00000000-0000-4000-8000-0000000000a1";
const STAGE = "00000000-0000-4000-8000-0000000000b1";
const PERSON = "00000000-0000-4000-8000-0000000000c1";
const COMPANY = "00000000-0000-4000-8000-0000000000d1";

describe("a deal as a person types it", () => {
  it("has a title, a person or a company, a pipeline and a stage; the estimate in the store's currency", () => {
    const out = cleanDealInput({ title: "  Fair lead: 40 totes ", customerId: PERSON, companyId: "", pipelineId: PIPELINE, stageId: STAGE, estimate: "12 500,50", expectedCloseOn: "2026-12-01" }, "NOK");
    expect(out).toEqual({
      ok: true,
      deal: { title: "Fair lead: 40 totes", customerId: PERSON, companyId: null, ownerId: null, pipelineId: PIPELINE, stageId: STAGE, estimateMinor: 1_250_050, expectedCloseOn: "2026-12-01" },
    });
    expect(cleanDealInput({ title: "Fair", companyId: COMPANY, pipelineId: PIPELINE, stageId: STAGE }, "NOK")).toMatchObject({ ok: true, deal: { companyId: COMPANY, estimateMinor: null } });
  });

  it("says what is missing or wrong, all at once", () => {
    expect(cleanDealInput({ title: " ", customerId: "", pipelineId: "x", stageId: "", estimate: "lots", expectedCloseOn: "2026-13-45", ownerId: "nobody" }, "NOK")).toEqual({
      ok: false,
      problems: ["title", "who", "owner", "pipeline", "stage", "estimate", "expected_close"],
    });
    expect(cleanDealInput({ title: "x".repeat(201), customerId: PERSON, pipelineId: PIPELINE, stageId: STAGE }, "NOK")).toEqual({ ok: false, problems: ["title"] });
  });

  it("keeps a lost deal's reason short and on one line", () => {
    expect(cleanReason("  Chose  another\nsupplier ")).toBe("Chose another supplier");
    expect(cleanReason("")).toBeNull();
    expect(cleanReason("x".repeat(300))).toHaveLength(200);
  });
});

describe("a deal's value", () => {
  const rates = toRates([
    { currency: "NOK", rate: 11.5, roundTo: 1 },
    { currency: "SEK", rate: 11.2, roundTo: 1 },
  ]);

  it("is the linked things' amounts once there are any, never the estimate beside them", () => {
    expect(dealValue({ minor: 500_000, currency: "NOK" }, [{ kind: "order", minor: 120_000, currency: "NOK" }, { kind: "work_assignment", minor: 80_000, currency: "NOK" }], "NOK", rates)).toEqual({
      minor: 200_000,
      source: "links",
      unconverted: [],
    });
  });

  it("is the estimate while nothing is linked, and nothing when there is neither", () => {
    expect(dealValue({ minor: 500_000, currency: "NOK" }, [], "NOK", rates)).toEqual({ minor: 500_000, source: "estimate", unconverted: [] });
    expect(dealValue({ minor: null, currency: "NOK" }, [], "NOK", rates)).toEqual({ minor: null, source: "none", unconverted: [] });
  });

  it("converts another currency at the store's rates, and names one it cannot instead of counting it as zero", () => {
    const out = dealValue({ minor: null, currency: "NOK" }, [{ kind: "order", minor: 112_000, currency: "SEK" }, { kind: "order", minor: 10_000, currency: "PLN" }], "NOK", rates);
    expect(out.source).toBe("links");
    expect(out.unconverted).toEqual(["PLN"]);
    expect(out.minor).toBe(115_000);
    expect(dealValue({ minor: null, currency: "NOK" }, [{ kind: "draft", minor: 10_000, currency: "PLN" }], "NOK", rates)).toEqual({ minor: null, source: "links", unconverted: ["PLN"] });
  });
});

describe("the board", () => {
  const stages = [
    { id: "new", name: "New", probability: null },
    { id: "talking", name: "Talking", probability: 40 },
  ];
  const deal = (id: string, over: Partial<BoardDeal>): BoardDeal => ({ id, stageId: "new", status: "open", value: null, expectedCloseOn: null, createdAt: "2026-11-01T10:00:00Z", ...over });

  it("is a column per stage in its order, then Won and Lost, the soonest to close first", () => {
    const cols = boardColumns(stages, [
      deal("a", { stageId: "talking", value: 100_000, expectedCloseOn: "2026-12-10" }),
      deal("b", { stageId: "talking", value: 50_000, expectedCloseOn: "2026-11-20" }),
      deal("c", { value: 10_000 }),
      deal("d", { status: "won", value: 70_000 }),
      deal("e", { status: "lost" }),
      deal("f", { stageId: "gone" }),
    ]);
    expect(cols.map((c) => [c.key, c.deals.map((d) => d.id)])).toEqual([
      ["new", ["c"]],
      ["talking", ["b", "a"]],
      ["won", ["d"]],
      ["lost", ["e"]],
    ]);
    expect(cols[1]).toMatchObject({ total: 150_000, weightedTotal: 60_000 });
    expect(cols[0]).toMatchObject({ total: 10_000, weightedTotal: 10_000 });
  });

  it("weighs by probability only where a stage has one, and counts whole days in a stage", () => {
    expect(weighted(100_000, 25)).toBe(25_000);
    expect(weighted(100_000, null)).toBe(100_000);
    expect(weighted(100_000, 140)).toBe(100_000);
    expect(daysInStage("2026-11-01T10:00:00Z", new Date("2026-11-04T09:59:59Z"))).toBe(2);
    expect(daysInStage("2026-11-05T10:00:00Z", new Date("2026-11-04T10:00:00Z"))).toBe(0);
  });
});

describe("who a deal is with", () => {
  it("is the company, and the person at it, in one line", () => {
    expect(whoLine({ company: { name: "Kunde AS" }, customer: { name: "", email: "kari@example.com" } })).toBe("Kunde AS · kari@example.com");
    expect(whoLine({ company: null, customer: { name: "Kari Nordmann", email: "kari@example.com" } })).toBe("Kari Nordmann");
    expect(whoLine({ company: null, customer: null })).toBeNull();
  });
});
