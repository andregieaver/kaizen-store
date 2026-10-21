import { describe, expect, it } from "vitest";

import { cardNotices, nextStepText, noticeText, noticesFor, type CampaignNotice } from "./campaign-notices";
import { t } from "./i18n";

const notice = (over: Partial<CampaignNotice>): CampaignNotice => ({
  id: "n1",
  name: "Sommersalg",
  kind: "percent",
  percent: 20,
  buyQuantity: 3,
  payQuantity: 2,
  giftTitle: null,
  thresholdMinor: null,
  amountMinor: null,
  tierBasis: null,
  tiers: [],
  endsAt: null,
  productIds: null,
  signIn: false,
  ...over,
});
const money = (minor: number) => `kr ${minor / 100}`;

describe("campaign notices", () => {
  it("reach a product they are for, or every product", () => {
    const all = notice({ id: "all" });
    const some = notice({ id: "some", productIds: ["p1"] });
    expect(noticesFor({ items: [all, some] }, "p1").map((n) => n.id)).toEqual(["all", "some"]);
    expect(noticesFor({ items: [all, some] }, "p2").map((n) => n.id)).toEqual(["all"]);
    expect(noticesFor(undefined, "p1")).toEqual([]);
  });

  it("say what the offer is in the shopper's language", () => {
    expect(noticeText(notice({}), t("nb"), money)).toBe("20 % rabatt");
    expect(noticeText(notice({ kind: "multi_buy" }), t("sv"), money)).toBe("3 för 2");
    expect(noticeText(notice({ kind: "multi_buy" }), t("en"), money)).toBe("3 for 2");
    expect(noticeText(notice({ kind: "gift", giftTitle: "Notatbok", thresholdMinor: 50000 }), t("nb"), money)).toBe("Gratis Notatbok når du handler for kr 500");
    expect(noticeText(notice({}), t("xx"), money)).toBe("20 % off");
  });

  it("put two offers at most on a card, and never a gift", () => {
    const gift = notice({ id: "g", kind: "gift" });
    const sale = notice({ id: "s" });
    const other = notice({ id: "o", percent: 5 });
    const third = notice({ id: "t", percent: 1 });
    expect(cardNotices([gift, sale, other, third]).map((n) => n.id)).toEqual(["s", "o"]);
    expect(cardNotices([gift])).toEqual([]);
  });

  it("say amounts off, free shipping and a tiered campaign's ladder (D299 E3)", () => {
    expect(noticeText(notice({ kind: "amount", amountMinor: 10000 }), t("nb"), money)).toBe("kr 100 rabatt");
    expect(noticeText(notice({ kind: "amount", amountMinor: 10000, thresholdMinor: 50000 }), t("en"), money)).toBe("kr 100 off when you spend kr 500");
    expect(noticeText(notice({ kind: "free_shipping" }), t("sv"), money)).toBe("Fri frakt");
    expect(noticeText(notice({ kind: "free_shipping", thresholdMinor: 50000 }), t("da"), money)).toBe("Gratis fragt, når du handler for kr 500");
    const ladder = notice({ kind: "tiered", tierBasis: "quantity", tiers: [{ at: 2, percent: 10 }, { at: 4, percent: 15 }] });
    expect(noticeText(ladder, t("en"), money)).toBe("10 % off when you buy 2 · 15 % off when you buy 4");
    expect(noticeText(ladder, t("nb"), money, { card: true })).toBe("Opptil 15 % rabatt");
    const spend = notice({ kind: "tiered", tierBasis: "spend", tiers: [{ at: 50000, percent: 10 }, { at: 100000, percent: 20 }] });
    expect(noticeText(spend, t("sv"), money)).toBe("10 % rabatt när du handlar för kr 500 · 20 % rabatt när du handlar för kr 1000");
  });

  it("put tiered campaigns on cards, never amounts off or free shipping", () => {
    const kinds = cardNotices([
      notice({ id: "a", kind: "amount", amountMinor: 100 }),
      notice({ id: "f", kind: "free_shipping" }),
      notice({ id: "t", kind: "tiered", tierBasis: "quantity", tiers: [{ at: 2, percent: 10 }] }),
    ]).map((n) => n.id);
    expect(kinds).toEqual(["t"]);
  });

  it("say in the cart how far a campaign's next step is", () => {
    const step = { campaignId: "c", name: "Høst", percent: null, offMinor: null, missingUnits: null, missingMinor: null };
    expect(nextStepText({ ...step, kind: "tiered", missingUnits: 2, percent: 15 }, t("en"), money)).toBe("Buy 2 more to get 15 % off");
    expect(nextStepText({ ...step, kind: "tiered", missingMinor: 12000, percent: 15 }, t("nb"), money)).toBe("Handle for kr 120 til for å få 15 % rabatt");
    expect(nextStepText({ ...step, kind: "amount", missingMinor: 12000, offMinor: 10000 }, t("sv"), money)).toBe("Handla för kr 120 till för att få kr 100 rabatt");
    expect(nextStepText({ ...step, kind: "free_shipping", missingMinor: 12000 }, t("da"), money)).toBe("Handl for kr 120 mere for at få gratis fragt");
  });
});
