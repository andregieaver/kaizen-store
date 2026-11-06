import { describe, expect, it } from "vitest";

import { formatLimit, formatUsage } from "./usage-format";

describe("usage and limits written for people (D314)", () => {
  it("writes AI money in US dollars the language's way, the sign where the language puts it", () => {
    expect(formatUsage("ai_cost_micros", 5_000_000)).toBe("$5.00");
    expect(formatUsage("ai_cost_micros", 1_234_560_000, "en-GB")).toBe("$1,234.56");
    expect(formatLimit("ai_cost_month_micros", 5_000_000, "en")).toBe("$5.00");
    expect(formatLimit("ai_cost_month_micros", 5_000_000, "nb")).toMatch(/^5,00\s\$$/);
    expect(formatUsage("ai_cost_micros", 250_000_000, "nb-NO")).toMatch(/^250,00\s\$$/);
    expect(formatUsage("ai_cost_micros", 5_000_000, "sv-SE")).toMatch(/^5,00\s\$$/);
  });

  it("writes storage in GB and counts with the language's separators", () => {
    expect(formatLimit("storage_bytes", 5 * 1024 ** 3, "nb")).toBe("5 GB");
    expect(formatLimit("products", 10_000, "en-GB")).toBe("10,000");
    expect(formatLimit("requests_month", 1_000_000, "nb")).toMatch(/^1\s000\s000$/);
  });
});
