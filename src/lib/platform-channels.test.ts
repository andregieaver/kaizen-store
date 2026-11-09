import { describe, expect, it } from "vitest";

import { channelRows, ownerCohorts, touchChannel } from "./platform-channels";

describe("where Kaizena Flow's owners come from (D522)", () => {
  it("classifies a sign-up's first touch as a visit's channel is, and nothing without one", () => {
    expect(touchChannel(null, ["kaizenaflow.com"])).toBeNull();
    expect(touchChannel({ source: "google", medium: "cpc", campaign: "Winter", day: "2026-11-01" }, ["kaizenaflow.com"])).toMatchObject({ channel: "paid_search", source: "google" });
    expect(touchChannel({ ref: "www.google.com", day: "2026-11-01" }, ["kaizenaflow.com"])).toMatchObject({ channel: "organic_search" });
    expect(touchChannel({ ref: "kaizenaflow.com", day: "2026-11-01" }, ["kaizenaflow.com"])?.channel).toBe("direct");
  });

  it("groups owners by the month their store was made, with what they paid", () => {
    const rows = ownerCohorts([
      { joinedMonth: "2026-10", opened: true, payingNow: true, paidMinor: 79_000 },
      { joinedMonth: "2026-10", opened: true, payingNow: false, paidMinor: 39_500 },
      { joinedMonth: "2026-10", opened: false, payingNow: false, paidMinor: 0 },
      { joinedMonth: "2026-11", opened: false, payingNow: false, paidMinor: 0 },
    ]);
    expect(rows).toEqual([
      { month: "2026-11", stores: 1, opened: 0, payingNow: 0, everPaid: 0, paidMinor: 0, perStoreMinor: 0, perPayerMinor: null },
      { month: "2026-10", stores: 3, opened: 2, payingNow: 1, everPaid: 2, paidMinor: 118_500, perStoreMinor: 39_500, perPayerMinor: 59_250 },
    ]);
  });

  it("sets each channel's new owners against its spend, showing spend that brought no one", () => {
    const rows = channelRows(
      [
        { channel: "paid_search", storeMade: true, opened: true, payingNow: true },
        { channel: "paid_search", storeMade: true, opened: false, payingNow: false },
        { channel: "paid_search", storeMade: false, opened: false, payingNow: false },
        { channel: null, storeMade: true, opened: true, payingNow: false },
      ],
      [
        { channel: "paid_search", amountMinor: 300_000 },
        { channel: "paid_social", amountMinor: 50_000 },
      ],
    );
    expect(rows).toEqual([
      { channel: "paid_search", requests: 3, owners: 2, opened: 1, payingNow: 1, spendMinor: 300_000, perOwnerMinor: 150_000, perPayingMinor: 300_000 },
      { channel: "paid_social", requests: 0, owners: 0, opened: 0, payingNow: 0, spendMinor: 50_000, perOwnerMinor: null, perPayingMinor: null },
      { channel: "unknown", requests: 1, owners: 1, opened: 1, payingNow: 0, spendMinor: 0, perOwnerMinor: null, perPayingMinor: null },
    ]);
  });
});
