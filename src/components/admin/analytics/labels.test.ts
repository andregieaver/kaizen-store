import { describe, expect, it } from "vitest";

import { formatDate, formatMonth } from "@/lib/analytics-core";

import { lastOrderText, monthText as customersMonth } from "./customers-view";
import { monthText as discountsMonth } from "./discounts-view";
import { dayText as overviewDay } from "./overview-view";
import { dayText as productsDay } from "./products-view";
import { lastSeenText } from "./traffic-view";

// One way to write a month and a day on every analytics page: "Sep", never "Sept" (what `Intl` gives en-GB in newer runtimes).
describe("the analytics pages write months and days alike", () => {
  it("writes September as Sep on every page, a cohort's month included", () => {
    expect(customersMonth("2026-09")).toBe("Sep 2026");
    expect(discountsMonth("2026-09")).toBe("Sep 2026");
    expect(customersMonth("2026-09")).toBe(formatMonth("2026-09"));
    expect(discountsMonth("2026-09")).toBe(customersMonth("2026-09"));
    expect(overviewDay("2026-09-03")).toBe("3 Sep 2026");
    expect(productsDay("2026-09-03")).toBe(overviewDay("2026-09-03"));
    expect(overviewDay("2026-09-03")).toBe(formatDate("2026-09-03"));
  });

  it("writes the day of an order or a search in the store's time zone with the same month names", () => {
    // 23:30 UTC on 30 September is 01:30 on 1 October in Oslo.
    expect(lastOrderText("2026-09-30T23:30:00Z", "Europe/Oslo")).toBe("1 Oct 2026");
    expect(lastOrderText("2026-09-30T23:30:00Z", "UTC")).toBe("30 Sep 2026");
    expect(lastSeenText("2026-09-30T12:00:00Z", "Europe/Oslo")).toBe("30 Sep 2026");
    expect(lastOrderText("not a date", "UTC")).toBe("–");
  });

  it("gives back what is not a month or a day as it came", () => {
    expect(customersMonth("soon")).toBe("soon");
    expect(overviewDay("soon")).toBe("soon");
  });

  it("never lets a month name differ from the shared list", () => {
    for (let m = 1; m <= 12; m++) {
      const key = `2026-${String(m).padStart(2, "0")}`;
      expect(customersMonth(key)).toBe(discountsMonth(key));
      expect(overviewDay(`${key}-15`)).toBe(`15 ${formatMonth(key).slice(0, 3)} 2026`);
    }
  });
});
