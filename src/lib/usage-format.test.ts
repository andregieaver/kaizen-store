import { describe, expect, it } from "vitest";

import { aiMinor, EURO_MONEY, formatLimit, formatUsage, type AiMoney } from "./usage-format";

describe("usage and limits written for people (D314)", () => {
  it("writes AI money in euros the language's way, as plans' limits are typed (D474)", () => {
    expect(formatUsage("ai_cost_micros", 5_000_000)).toBe("€5.00");
    expect(formatUsage("ai_cost_micros", 1_234_560_000, "en-GB")).toBe("€1,234.56");
    expect(formatLimit("ai_cost_month_micros", 5_000_000, "en")).toBe("€5.00");
    expect(formatLimit("ai_cost_month_micros", 5_000_000, "nb")).toMatch(/^5,00\s€$/);
    expect(formatUsage("ai_cost_micros", 250_000_000, "nb-NO")).toMatch(/^250,00\s€$/);
    expect(formatLimit("ai_cost_month_micros", 5_000_000, "en", { ...EURO_MONEY, decimals: "hide_whole" })).toBe("€5");
    // A limit with cents keeps them, whole amounts or not.
    expect(formatLimit("ai_cost_month_micros", 4_500_000, "en", { ...EURO_MONEY, decimals: "hide_whole" })).toBe("€4.50");
  });

  it("writes AI money in another currency at its rate: a limit in whole units, never more than it is, usage to the øre", () => {
    const nok: AiMoney = { currency: "NOK", perEuro: 11.71 };
    // €5 is 58.55 kroner: the limit says 58.
    expect(formatLimit("ai_cost_month_micros", 5_000_000, "nb-NO", nok)).toMatch(/^58,00\skr$/);
    expect(formatLimit("ai_cost_month_micros", 5_000_000, "nb-NO", { ...nok, decimals: "hide_whole" })).toMatch(/^58\skr$/);
    expect(formatUsage("ai_cost_micros", 1_000_000, "nb-NO", nok)).toMatch(/^11,71\skr$/);
    expect(aiMinor(1_000_000, nok)).toBe(1171);
    expect(aiMinor(5_000_000, nok, true)).toBe(5800);
    // Euros are never rounded to a whole unit.
    expect(aiMinor(4_567_890, EURO_MONEY, true)).toBe(457);
  });

  it("writes storage in GB and counts with the language's separators", () => {
    expect(formatLimit("storage_bytes", 5 * 1024 ** 3, "nb")).toBe("5 GB");
    expect(formatLimit("products", 10_000, "en-GB")).toBe("10,000");
    expect(formatLimit("requests_month", 1_000_000, "nb")).toMatch(/^1\s000\s000$/);
  });
});
