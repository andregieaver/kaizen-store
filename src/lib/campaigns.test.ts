import { describe, expect, it } from "vitest";

import {
  applyCampaigns,
  campaignInput,
  campaignStatus,
  describeCampaign,
  memberOffAfterCampaign,
  multiBuyOff,
  percentOff,
  reaches,
  type Campaign,
  type CampaignLine,
} from "./campaigns";

let n = 0;
const campaign = (over: Partial<Campaign>): Campaign => ({
  id: `c${++n}`,
  name: `Campaign ${n}`,
  kind: "percent",
  active: true,
  startsAt: null,
  endsAt: null,
  percent: 20,
  buyQuantity: 3,
  payQuantity: 2,
  giftVariantId: null,
  giftQuantity: 1,
  thresholds: {},
  productIds: [],
  termIds: [],
  tierIds: [],
  usageLimit: null,
  perCustomerLimit: null,
  markets: [],
  stacks: false,
  createdAt: `2026-01-01T00:00:${String(n).padStart(2, "0")}Z`,
  ...over,
});
const line = (key: string, unitMinor: number, quantity = 1, over: Partial<CampaignLine> = {}): CampaignLine => ({
  key,
  productId: `p-${key}`,
  termIds: [],
  unitMinor,
  quantity,
  discountable: true,
  valueMinor: unitMinor * quantity,
  ...over,
});

describe("what a campaign reaches", () => {
  it("is everything, chosen products, or products in chosen categories and tags", () => {
    const l = line("a", 100, 1, { termIds: ["shoes"] });
    expect(reaches({ productIds: [], termIds: [] }, l)).toBe(true);
    expect(reaches({ productIds: ["p-a"], termIds: [] }, l)).toBe(true);
    expect(reaches({ productIds: ["p-b"], termIds: [] }, l)).toBe(false);
    expect(reaches({ productIds: ["p-b"], termIds: ["shoes"] }, l)).toBe(true);
    expect(reaches({ productIds: [], termIds: ["hats"] }, l)).toBe(false);
  });
});

describe("a percentage off", () => {
  it("takes the lowered unit price off each unit, as a group's discount does", () => {
    expect(percentOff(9999, 3, 20)).toBe((9999 - 7999) * 3);
    const result = applyCampaigns([campaign({ percent: 25 })], [line("a", 10000, 2), line("b", 5000)], "NO");
    expect(result.lineOff).toEqual({ a: 5000, b: 1250 });
    expect(result.applied).toMatchObject([{ offMinor: 6250, kind: "percent" }]);
  });

  it("leaves what it does not reach, and lines that are not goods bought once", () => {
    const c = campaign({ productIds: ["p-a"] });
    const result = applyCampaigns([c], [line("a", 1000), line("b", 1000), line("s", 1000, 1, { discountable: false })], "NO");
    expect(result.lineOff).toEqual({ a: 200 });
    expect(applyCampaigns([campaign({})], [line("s", 1000, 1, { discountable: false }), line("z", 0)], "NO").applied).toEqual([]);
  });
});

describe("buy N pay for M", () => {
  it("makes the cheapest of every full group free, across the lines it reaches", () => {
    // Three units: 300, 200, 100: pay for the two dearest.
    expect(multiBuyOff([{ key: "a", unitMinor: 300, quantity: 1 }, { key: "b", unitMinor: 200, quantity: 1 }, { key: "c", unitMinor: 100, quantity: 1 }], 3, 2)).toEqual({ c: 100 });
    // Six units of one price: two groups, one free in each.
    expect(multiBuyOff([{ key: "a", unitMinor: 500, quantity: 6 }], 3, 2)).toEqual({ a: 1000 });
    // Five: one group only.
    expect(multiBuyOff([{ key: "a", unitMinor: 500, quantity: 5 }], 3, 2)).toEqual({ a: 500 });
    // Too few units, nothing free.
    expect(multiBuyOff([{ key: "a", unitMinor: 500, quantity: 2 }], 3, 2)).toEqual({});
    // Buy 4 pay for 1: three free in a group.
    expect(multiBuyOff([{ key: "a", unitMinor: 100, quantity: 2 }, { key: "b", unitMinor: 50, quantity: 2 }], 4, 1)).toEqual({ a: 100, b: 100 });
  });

  it("works through applyCampaigns for the products it is set for", () => {
    const c = campaign({ kind: "multi_buy", buyQuantity: 3, payQuantity: 2, productIds: ["p-a", "p-b"] });
    const result = applyCampaigns([c], [line("a", 300), line("b", 200, 2), line("other", 999, 3)], "NO");
    expect(result.lineOff).toEqual({ b: 200 });
    expect(result.applied).toMatchObject([{ offMinor: 200, name: c.name }]);
  });
});

describe("campaigns that meet", () => {
  it("give a unit at most one: the campaign giving most wins the lines it reaches", () => {
    const big = campaign({ percent: 30 });
    const small = campaign({ percent: 10 });
    const result = applyCampaigns([small, big], [line("a", 1000)], "NO");
    expect(result.lineOff).toEqual({ a: 300 });
    expect(result.lineBy).toEqual({ a: big.id });
    expect(result.applied).toHaveLength(1);
  });

  it("each take the products they are for", () => {
    const shoes = campaign({ percent: 50, productIds: ["p-a"] });
    const socks = campaign({ kind: "multi_buy", productIds: ["p-b"] });
    const result = applyCampaigns([shoes, socks], [line("a", 1000), line("b", 100, 3)], "NO");
    expect(result.lineOff).toEqual({ a: 500, b: 100 });
    expect(new Set(Object.values(result.lineBy))).toEqual(new Set([shoes.id, socks.id]));
  });

  it("tie: the older one", () => {
    const first = campaign({ percent: 10 });
    const second = campaign({ percent: 10 });
    expect(applyCampaigns([second, first], [line("a", 1000)], "NO").lineBy).toEqual({ a: first.id });
  });
});

describe("a percentage that stacks", () => {
  it("comes off what the campaign that won left, and off lines nothing else reached", () => {
    const sale = campaign({ percent: 20 });
    const extra = campaign({ percent: 10, stacks: true });
    const result = applyCampaigns([sale, extra], [line("a", 10000)], "NO");
    // 20 % of 100,00 is 20,00; 10 % of the 80,00 left is 8,00.
    expect(result.lineOff).toEqual({ a: 2800 });
    expect(result.lineParts.a.map((p) => [p.campaignId, p.minor])).toEqual([[sale.id, 2000], [extra.id, 800]]);
    expect(result.lineBy).toEqual({ a: sale.id });
    expect(result.applied.map((a) => [a.campaignId, a.offMinor])).toEqual([[sale.id, 2000], [extra.id, 800]]);
    // Alone, it is just a percentage.
    expect(applyCampaigns([extra], [line("a", 10000)], "NO").lineOff).toEqual({ a: 1000 });
  });

  it("comes off the units a 3 for 2 left paid for, and never below nothing", () => {
    const deal = campaign({ kind: "multi_buy" });
    const extra = campaign({ percent: 50, stacks: true });
    const two = applyCampaigns([deal, extra], [line("a", 1000, 3)], "NO");
    // One of three free (1000), then 50 % of the 2000 left.
    expect(two.lineOff).toEqual({ a: 2000 });
    const all = applyCampaigns([campaign({ percent: 100 }), extra], [line("a", 1000)], "NO");
    expect(all.lineOff).toEqual({ a: 1000 });
    expect(all.applied).toHaveLength(1);
  });

  it("stacks in the order they were made, and reaches only its own products", () => {
    const first = campaign({ percent: 10, stacks: true, productIds: ["p-a"] });
    const second = campaign({ percent: 10, stacks: true });
    const result = applyCampaigns([second, first], [line("a", 10000), line("b", 10000)], "NO");
    expect(result.lineOff).toEqual({ a: 1000 + 900, b: 1000 });
    expect(result.lineParts.a.map((p) => p.campaignId)).toEqual([first.id, second.id]);
  });

  it("counts towards a free product's amount", () => {
    const extra = campaign({ percent: 50, stacks: true });
    const gift = campaign({ kind: "gift", giftVariantId: "v", thresholds: { NO: 6000 } });
    expect(applyCampaigns([extra, gift], [line("a", 10000)], "NO").gifts).toEqual([]);
    expect(applyCampaigns([extra, gift], [line("a", 12000)], "NO").gifts).toHaveLength(1);
  });
});

describe("a stacking buy N pay for M", () => {
  it("takes the units still to be paid for, so two 3 for 2 free two of six, then one more of the four", () => {
    const mugs = campaign({ kind: "multi_buy", productIds: ["p-a"] });
    const home = campaign({ kind: "multi_buy", stacks: true });
    // Six at 100,00 under the mugs' 3 for 2: two free (200,00). The store-wide one takes the 4 left: one more free.
    const result = applyCampaigns([mugs, home], [line("a", 10000, 6)], "NO");
    expect(result.lineOff).toEqual({ a: 30000 });
    expect(result.lineParts.a.map((p) => [p.campaignId, p.minor])).toEqual([[mugs.id, 20000], [home.id, 10000]]);
    expect(result.applied.map((a) => a.offMinor)).toEqual([20000, 10000]);
  });

  it("works over the lines the first left, cheapest free, and never frees a unit twice", () => {
    const first = campaign({ kind: "multi_buy" });
    const second = campaign({ kind: "multi_buy", stacks: true });
    // Three at 300 and three at 100: the first frees one at 100 and one at 100 (the cheapest of each group of three).
    const result = applyCampaigns([first, second], [line("a", 30000, 3), line("b", 10000, 3)], "NO");
    // First: sorted 300,300,300 | 100,100,100 → free 300 and 100. Left to pay: a 2 (600), b 2 (200): four units, one group of three → the cheapest of them, 100.
    expect(result.lineOff.a).toBe(30000);
    expect(result.lineOff.b).toBe(20000);
    expect(result.lineOff.a + result.lineOff.b).toBeLessThanOrEqual(30000 * 3 + 10000 * 3);
  });

  it("stacks in order with a percentage, and takes nothing when little is left to pay for", () => {
    const first = campaign({ percent: 50 });
    const second = campaign({ kind: "multi_buy", stacks: true });
    // 50 % off three at 100 leaves 150 for three units, 50 each on average: one free of three → 50 more.
    expect(applyCampaigns([first, second], [line("a", 10000, 3)], "NO").lineOff).toEqual({ a: 15000 + 5000 });
    expect(applyCampaigns([second], [line("a", 10000, 2)], "NO").lineOff).toEqual({});
  });
});

describe("a free product over an amount", () => {
  const gift = (over: Partial<Campaign> = {}) => campaign({ kind: "gift", giftVariantId: "v-gift", thresholds: { NO: 50000 }, ...over });

  it("is earned when the basket comes to the amount, and not before", () => {
    expect(applyCampaigns([gift()], [line("a", 49999)], "NO").gifts).toEqual([]);
    expect(applyCampaigns([gift()], [line("a", 50000)], "NO").gifts).toMatchObject([{ variantId: "v-gift", quantity: 1 }]);
  });

  it("counts what is left after a price campaign", () => {
    const sale = campaign({ percent: 20 });
    // 60 000 less 20 % is 48 000: under the amount.
    expect(applyCampaigns([sale, gift()], [line("a", 60000)], "NO").gifts).toEqual([]);
    expect(applyCampaigns([sale, gift()], [line("a", 65000)], "NO").gifts).toHaveLength(1);
  });

  it("has an amount per market, and none where none is set", () => {
    expect(applyCampaigns([gift()], [line("a", 90000)], "SE").gifts).toEqual([]);
  });

  it("can count only the products it is for, and counts any kind of line", () => {
    const g = gift({ productIds: ["p-a"] });
    expect(applyCampaigns([g], [line("a", 30000), line("b", 30000)], "NO").gifts).toEqual([]);
    expect(applyCampaigns([g], [line("a", 50000, 1, { discountable: false })], "NO").gifts).toHaveLength(1);
  });

  it("gives several at once when several campaigns are earned", () => {
    const result = applyCampaigns([gift(), gift({ giftVariantId: "v-two", thresholds: { NO: 10000 } })], [line("a", 60000)], "NO");
    expect(result.gifts.map((g) => g.variantId).sort()).toEqual(["v-gift", "v-two"]);
  });
});

describe("the buyer's group discount", () => {
  it("is a percentage of what a campaign left, else as before", () => {
    expect(memberOffAfterCampaign(1000, 2, 0, 10)).toBe(200);
    expect(memberOffAfterCampaign(1000, 3, 1000, 10)).toBe(200);
  });
});

describe("a campaign's dates", () => {
  const c = { active: true, startsAt: "2026-05-01T00:00:00Z", endsAt: "2026-06-01T00:00:00Z" };
  it("say where it stands", () => {
    expect(campaignStatus(c, new Date("2026-04-30T00:00:00Z"))).toBe("scheduled");
    expect(campaignStatus(c, new Date("2026-05-15T00:00:00Z"))).toBe("active");
    expect(campaignStatus(c, new Date("2026-06-01T00:00:00Z"))).toBe("ended");
    expect(campaignStatus({ ...c, active: false })).toBe("off");
  });
});

describe("the admin's form", () => {
  const base = { name: "Summer", kind: "percent" as const };
  it("takes a percentage, a multi-buy or a gift", () => {
    expect(campaignInput.safeParse({ ...base, percent: "15" }).data?.percent).toBe(15);
    expect(campaignInput.safeParse({ ...base, kind: "multi_buy", buyQuantity: "3", payQuantity: "2" }).success).toBe(true);
    expect(campaignInput.safeParse({ ...base, kind: "gift", giftVariantId: crypto.randomUUID() }).success).toBe(true);
  });
  it("refuses what makes no sense", () => {
    expect(campaignInput.safeParse({ ...base, name: " " }).success).toBe(false);
    expect(campaignInput.safeParse({ ...base, percent: 101 }).success).toBe(false);
    expect(campaignInput.safeParse({ ...base, kind: "multi_buy", buyQuantity: 2, payQuantity: 3 }).success).toBe(false);
    expect(campaignInput.safeParse({ ...base, kind: "gift" }).success).toBe(false);
    expect(campaignInput.safeParse({ ...base, startsAt: "2026-06-01T10:00", endsAt: "2026-05-01T10:00" }).success).toBe(false);
    // "Only some" needs something chosen: else it would be everything.
    expect(campaignInput.safeParse({ ...base, scope: "some" }).success).toBe(false);
    expect(campaignInput.safeParse({ ...base, scope: "some", termIds: [crypto.randomUUID()] }).success).toBe(true);
    // Uses, customer groups, and stacking only for a percentage.
    expect(campaignInput.safeParse({ ...base, usageLimit: "50", tierIds: [crypto.randomUUID()], stacks: true }).data).toMatchObject({ usageLimit: 50, stacks: true });
    expect(campaignInput.safeParse({ ...base, usageLimit: "" }).data?.usageLimit).toBeNull();
    expect(campaignInput.safeParse({ ...base, usageLimit: 0 }).success).toBe(false);
    expect(campaignInput.safeParse({ ...base, kind: "multi_buy", stacks: true }).success).toBe(true);
    expect(campaignInput.safeParse({ ...base, kind: "gift", giftVariantId: crypto.randomUUID(), stacks: true }).success).toBe(false);
    // Once per customer, and only in some countries.
    expect(campaignInput.safeParse({ ...base, perCustomerLimit: "1", markets: ["NO", "SE"] }).data).toMatchObject({ perCustomerLimit: 1, markets: ["NO", "SE"] });
    expect(campaignInput.safeParse({ ...base, perCustomerLimit: 0 }).success).toBe(false);
    expect(campaignInput.safeParse({ ...base, markets: ["norway"] }).success).toBe(false);
  });
  it("is described for the list", () => {
    const money = (minor: number, code: string) => `${code} ${minor / 100}`;
    expect(describeCampaign({ kind: "percent", percent: 20, buyQuantity: 3, payQuantity: 2, thresholds: {} }, money)).toBe("20 % off");
    expect(describeCampaign({ kind: "multi_buy", percent: 0, buyQuantity: 3, payQuantity: 2, thresholds: {} }, money)).toBe("3 for 2");
    expect(describeCampaign({ kind: "gift", percent: 0, buyQuantity: 3, payQuantity: 2, thresholds: { NO: 50000 } }, money)).toBe("Free product over NO 500");
  });
});
