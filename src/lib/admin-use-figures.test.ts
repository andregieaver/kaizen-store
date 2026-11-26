import { describe, expect, it } from "vitest";

import { adminScreenRows } from "./admin-use-figures";

describe("admin heatmaps' figures per screen (D895 phase 3b)", () => {
  it("works the shares out in code, leaves them out below the minimum, and puts the most frustrated screen first", () => {
    const rows = adminScreenRows([
      {
        screen: "s/products",
        views: 40,
        frustrated: 4,
        dead: 6,
        rage: 1,
        deep: 10,
      },
      {
        screen: "s/settings/payments",
        views: 25,
        frustrated: 10,
        dead: 12,
        rage: 4,
        deep: 25,
      },
      {
        screen: "a/billing",
        views: 5,
        frustrated: 5,
        dead: 5,
        rage: 0,
        deep: 1,
      },
      { screen: "s", views: 0, frustrated: 0, dead: 0, rage: 0, deep: 0 },
    ]);
    expect(rows).toEqual([
      {
        screen: "s/settings/payments",
        views: 25,
        deadClicks: 12,
        rageClicks: 4,
        frustratedPct: 40,
        endPct: 100,
      },
      {
        screen: "s/products",
        views: 40,
        deadClicks: 6,
        rageClicks: 1,
        frustratedPct: 10,
        endPct: 25,
      },
      {
        screen: "a/billing",
        views: 5,
        deadClicks: 5,
        rageClicks: 0,
        frustratedPct: null,
        endPct: null,
      },
    ]);
  });
});
