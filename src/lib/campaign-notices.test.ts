import { describe, expect, it } from "vitest";

import { cardNotices, noticeText, noticesFor, type CampaignNotice } from "./campaign-notices";
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
  endsAt: null,
  productIds: null,
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
});
