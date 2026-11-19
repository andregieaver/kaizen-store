import { describe, expect, it } from "vitest";

import { cheapestCover, coverSaving, type CoverOption } from "./extension-cover";
import type { ExtensionId } from "./extensions";

/** The cheapest way to have some extensions (D748 E6): the first price sheet's founding prices, in euro cents a month. */

const single = (id: ExtensionId, amountMinor: number): CoverOption => ({ kind: "extension", id, priceId: `price-${id}`, covers: [id], amountMinor });
const bundle = (id: string, covers: ExtensionId[], amountMinor: number): CoverOption => ({ kind: "bundle", id, priceId: `price-${id}`, covers, amountMinor });

const options = [
  single("ab_testing", 1900),
  single("support_desk", 2900),
  single("email_automation", 1900),
  single("work", 2500),
  single("deals", 2900),
  bundle("customers", ["support_desk", "email_automation", "deals"], 5900),
  bundle("everything", ["ab_testing", "support_desk", "email_automation", "work", "deals"], 8900),
];
const ids = (cover: ReturnType<typeof cheapestCover>) => cover?.picks.map((p) => p.id);

describe("cheapestCover", () => {
  it("buys one extension on its own", () => {
    expect(cheapestCover(["work"], [], options)).toEqual({ picks: [options[3]], totalMinor: 2500, singlesMinor: 2500 });
  });

  it("buys the bundle when it costs less than its parts, and says what it saves", () => {
    const cover = cheapestCover(["support_desk", "email_automation", "deals"], [], options)!;
    expect(ids(cover)).toEqual(["customers"]);
    expect(coverSaving(cover)).toBe(2900 + 1900 + 2900 - 5900);
  });

  it("takes a bundle with more in it when that is still cheaper", () => {
    // Support desk and deals alone: 58 € one by one, 59 € as Customers: one by one wins.
    expect(ids(cheapestCover(["support_desk", "deals"], [], options))).toEqual(["support_desk", "deals"]);
    // Everything but A/B testing: Customers and Work 84 €, Everything 89 €.
    expect(ids(cheapestCover(["support_desk", "email_automation", "work", "deals"], [], options))).toEqual(["customers", "work"]);
    // All five: 120 € one by one, Customers with the other two 103 €, Everything 89 €.
    expect(ids(cheapestCover(["ab_testing", "support_desk", "email_automation", "work", "deals"], [], options))).toEqual(["everything"]);
  });

  it("never charges for what the plan includes", () => {
    // Grow includes A/B testing: the rest one by one or as Customers plus Work, never Everything (it holds A/B testing).
    expect(ids(cheapestCover(["ab_testing", "support_desk", "email_automation", "work", "deals"], ["ab_testing"], options))).toEqual(["customers", "work"]);
    expect(cheapestCover(["ab_testing"], ["ab_testing"], options)).toEqual({ picks: [], totalMinor: 0, singlesMinor: 0 });
  });

  it("never buys one extension twice through two bundles", () => {
    const overlapping = [...options, bundle("support-pair", ["support_desk", "work"], 100)];
    const cover = cheapestCover(["support_desk", "email_automation", "work", "deals"], [], overlapping)!;
    const covered = cover.picks.flatMap((p) => p.covers);
    expect(new Set(covered).size).toBe(covered.length);
    expect(ids(cover)).toEqual(["support-pair", "email_automation", "deals"]);
  });

  it("leaves out a bundle holding an extension the owner said no to", () => {
    expect(ids(cheapestCover(["support_desk", "email_automation", "work"], [], options, ["deals"]))).toEqual(["support_desk", "email_automation", "work"]);
  });

  it("answers null when something wanted has no price, and covers it by a bundle when only a bundle has one", () => {
    const noWork = options.filter((o) => o.id !== "work" && o.id !== "everything");
    expect(cheapestCover(["work"], [], noWork)).toBeNull();
    const onlyBundle = options.filter((o) => o.id !== "deals");
    const cover = cheapestCover(["deals"], [], onlyBundle)!;
    expect(ids(cover)).toEqual(["customers"]);
    expect(cover.singlesMinor).toBeNull();
    expect(coverSaving(cover)).toBe(0);
  });
});
