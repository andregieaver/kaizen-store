import { describe, expect, it } from "vitest";

import { bookingPrice, datePrice, feeFor, pricedDates, seasonCovers, seasonName, type Season } from "./booking-prices";

const summer: Season = { name: "Høysesong", names: { "sv-SE": "Högsäsong" }, fromDay: "06-15", toDay: "08-15", weekdays: [1, 2, 3, 4, 5, 6, 7], percent: 30 };
const weekend: Season = { name: "Helg", names: {}, fromDay: null, toDay: null, weekdays: [5, 6], percent: 20 };
const winter: Season = { name: "Jul", names: {}, fromDay: "12-20", toDay: "01-05", weekdays: [1, 2, 3, 4, 5, 6, 7], percent: -10 };

describe("season names", () => {
  it("are shown in the market's language where the store gave one, else in its own", () => {
    expect(seasonName(summer, "sv-SE")).toBe("Högsäsong");
    expect(seasonName(summer, "da-DK")).toBe("Høysesong");
    expect(seasonName(summer, "nb-NO")).toBe("Høysesong");
    expect(seasonName({ name: "Helg", names: { "da-DK": "  " } }, "da-DK")).toBe("Helg");
  });
});

describe("seasons (D70)", () => {
  it("cover their days every year, across the new year too, and their weekdays", () => {
    expect(seasonCovers(summer, "2027-06-15")).toBe(true);
    expect(seasonCovers(summer, "2027-08-16")).toBe(false);
    expect(seasonCovers(winter, "2026-12-31")).toBe(true);
    expect(seasonCovers(winter, "2027-01-05")).toBe(true);
    expect(seasonCovers(winter, "2027-01-06")).toBe(false);
    // 2026-10-02 is a Friday, the 4th a Sunday.
    expect(seasonCovers(weekend, "2026-10-02")).toBe(true);
    expect(seasonCovers(weekend, "2026-10-04")).toBe(false);
  });

  it("change a date's price, one on top of another, in whole units", () => {
    expect(datePrice(145000, "2026-10-01", [summer, weekend])).toBe(145000);
    expect(datePrice(145000, "2027-07-01", [summer, weekend])).toBe(188500);
    // Friday 2 July 2027: summer and weekend, 1450 × 1.3 × 1.2 = 2262.
    expect(datePrice(145000, "2027-07-02", [summer, weekend])).toBe(226200);
    expect(datePrice(99900, "2026-12-24", [winter])).toBe(89900);
  });
});

describe("a booking's price (D70)", () => {
  it("adds up a stay's nights at their seasons' prices, and the fee once", () => {
    // Thursday 1 to Sunday 4 July 2027: Thu, Fri, Sat nights.
    const stay = bookingPrice({
      kind: "stay",
      period: "day",
      startDate: "2027-07-01",
      count: 3,
      baseMinor: 145000,
      seasons: [summer, weekend],
      feeMinor: 50000,
    });
    expect(stay).toEqual({ itemsMinor: 188500 + 226200 + 226200, feeMinor: 50000, totalMinor: 640900 + 50000, seasonal: true });
    expect(bookingPrice({ kind: "stay", period: "day", startDate: "2026-10-05", count: 2, baseMinor: 145000, seasons: [], feeMinor: 0 })).toEqual({
      itemsMinor: 290000,
      feeMinor: 0,
      totalMinor: 290000,
      seasonal: false,
    });
  });

  it("prices hours and half days by the date they are on", () => {
    expect(pricedDates("rental", "hour", "2027-07-02", 3)).toEqual(["2027-07-02"]);
    const hours = bookingPrice({ kind: "rental", period: "hour", startDate: "2027-07-02", count: 3, baseMinor: 12000, seasons: [weekend], feeMinor: 0 });
    expect(hours.totalMinor).toBe(14400 * 3);
    const half = bookingPrice({ kind: "rental", period: "half_day", startDate: "2027-07-01", count: 1, baseMinor: 30000, seasons: [weekend], feeMinor: 5000 });
    expect(half.totalMinor).toBe(35000);
  });

  it("reads a market's fee, or none", () => {
    expect(feeFor({ NO: 50000, DK: 37500 }, "DK")).toBe(37500);
    expect(feeFor({ NO: 50000 }, "SE")).toBe(0);
    expect(feeFor(null, "NO")).toBe(0);
  });
});
