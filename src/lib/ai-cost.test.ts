import { describe, expect, it } from "vitest";

import { costMicros, formatPerMillion, formatUsd, matchPrice, parsePriceForm, type ModelPrice } from "./ai-cost";

const price = (model: string, input: number, output: number, from = "2026-01-01", provider = "acme"): ModelPrice => ({
  provider,
  model,
  inputPerMillion: input,
  outputPerMillion: output,
  effectiveFrom: new Date(from),
});

describe("what a call costs", () => {
  it("is the tokens times the price per million, in millionths of a dollar", () => {
    // 1,000 input tokens at $0.40 per million is 0.04 of a cent: 400 millionths of a dollar.
    expect(costMicros(1_000, 0, price("m", 0.4, 1.6))).toBe(400);
    expect(costMicros(1_000, 500, price("m", 0.4, 1.6))).toBe(1_200);
    expect(costMicros(2_000_000, 1_000_000, price("m", 0.25, 2))).toBe(2_500_000);
    expect(costMicros(-5, 0, price("m", 1, 1))).toBe(0);
  });
});

describe("which price counts for a call", () => {
  const prices = [price("gpt-x", 1, 2, "2026-01-01"), price("gpt-x", 3, 6, "2026-06-01"), price("gpt-x-mini", 0.1, 0.2, "2026-01-01"), price("other", 9, 9, "2026-01-01", "elsewhere")];

  it("is the one in force when the call was made, so a new price does not rewrite the past", () => {
    expect(matchPrice(prices, "acme", "gpt-x", new Date("2026-03-01"))?.inputPerMillion).toBe(1);
    expect(matchPrice(prices, "acme", "gpt-x", new Date("2026-07-01"))?.inputPerMillion).toBe(3);
    expect(matchPrice(prices, "acme", "gpt-x", new Date("2025-12-31"))).toBeNull();
  });

  it("takes a dated version of a model, and the most specific name, and only its own provider's", () => {
    expect(matchPrice(prices, "acme", "gpt-x-2026-05-01", new Date("2026-07-01"))?.inputPerMillion).toBe(3);
    expect(matchPrice(prices, "acme", "gpt-x-mini-2026-05-01", new Date("2026-07-01"))?.model).toBe("gpt-x-mini");
    expect(matchPrice(prices, "acme", "gpt-xy", new Date("2026-07-01"))).toBeNull();
    expect(matchPrice(prices, "acme", "other", new Date("2026-07-01"))).toBeNull();
  });
});

describe("amounts as written", () => {
  it("shows dollars from a dollar up and fractions of a cent below it", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(12_340_000)).toBe("$12.34");
    expect(formatUsd(1_234_567_890)).toBe("$1,234.57");
    expect(formatUsd(12_300)).toBe("$0.0123");
    expect(formatUsd(500_000)).toBe("$0.50");
    expect(formatUsd(40)).toBe("<$0.0001");
    expect(formatPerMillion(0.4)).toBe("$0.40");
    expect(formatPerMillion(0.02)).toBe("$0.02");
    expect(formatPerMillion(1.234567)).toBe("$1.234567");
  });
});

describe("the price form", () => {
  const form = (entries: Record<string, string>) => ({ get: (name: string) => entries[name] ?? null });

  it("reads a price, accepting a comma for the point", () => {
    expect(parsePriceForm(form({ provider: " openai ", model: "gpt-5-mini", input: "0,25", output: "2", note: "list" }))).toEqual({
      ok: true,
      price: { provider: "openai", model: "gpt-5-mini", inputPerMillion: 0.25, outputPerMillion: 2, note: "list" },
    });
  });

  it("names what is wrong", () => {
    const bad = parsePriceForm(form({ provider: "", model: "", input: "free", output: "-1" }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.problems).toHaveLength(4);
    expect(parsePriceForm(form({ provider: "a", model: "b", input: "20000", output: "1" })).ok).toBe(false);
    expect(parsePriceForm(form({ provider: "a", model: "b", input: "0", output: "0" })).ok).toBe(true);
  });
});
