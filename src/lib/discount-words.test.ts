import { describe, expect, it } from "vitest";

import { discountsEn } from "./admin-messages/discounts.en";
import { discountsNb } from "./admin-messages/discounts.nb";
import { describeCampaign } from "./campaigns";
import { discountProblemText, discountProblemsText } from "./discount-words";
import { describeDiscount } from "./discounts";

describe("discountProblemText", () => {
  it("leaves English as it is", () => {
    expect(discountProblemText("The code must end after it starts.", discountsEn)).toBe("The code must end after it starts.");
  });

  it("says a refusal written exactly so in Norwegian, with its values carried over", () => {
    expect(discountProblemText("The code must end after it starts.", discountsNb)).toBe("Koden må slutte etter at den starter.");
    expect(discountProblemText("The store already has a code SUMMER.", discountsNb)).toBe("Butikken har allerede en kode SUMMER.");
    expect(discountProblemText("Step 3 must ask for more than step 2 in Norway.", discountsNb)).toBe("Trinn 3 må kreve mer enn trinn 2 i Norway.");
  });

  it("says the amount a refusal names, and takes the more particular template first", () => {
    expect(discountProblemText("The minimum order for Sweden is not a valid amount.", discountsNb)).toBe("Minste ordre for Sweden er ikke et gyldig beløp.");
    expect(discountProblemText("Step 2's amount for Norway is not a valid amount.", discountsNb)).toBe("Beløpet for trinn 2 for Norway er ikke et gyldig beløp.");
    expect(discountProblemText("No customer has the email a@b.no, c@d.no, e@f.no and 2 more.", discountsNb)).toBe(
      "Ingen kunde har e-postadressen a@b.no, c@d.no, e@f.no og 2 til.",
    );
  });

  it("leaves other text as written", () => {
    expect(discountProblemsText(["Something else.", "Unknown code."], discountsNb)).toEqual(["Something else.", "Ukjent kode."]);
  });

  it("has a Norwegian template for every English one, with the same placeholders", () => {
    const names = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const [key, english] of Object.entries(discountsEn.problems)) {
      expect(names((discountsNb.problems as Record<string, string>)[key]), key).toEqual(names(english));
    }
  });
});

describe("what a code or a campaign gives, in Norwegian", () => {
  const money = (minor: number, market: string) => `${market} ${minor / 100}`;
  it("describes a code", () => {
    expect(describeDiscount({ kind: "percent", percent: 20, amounts: {}, recurring: true }, money, discountsNb.describe)).toBe("20 % rabatt, hver fornyelse");
    expect(describeDiscount({ kind: "fixed", percent: 0, amounts: { NO: 5000 }, recurring: false }, money, discountsNb.describe)).toBe("NO 50 i rabatt");
  });
  it("describes a campaign", () => {
    const plain = { percent: 0, buyQuantity: 3, payQuantity: 2, thresholds: {} };
    expect(describeCampaign({ ...plain, kind: "multi_buy" }, money, discountsNb.describe)).toBe("3 for 2");
    expect(describeCampaign({ ...plain, kind: "gift", thresholds: { NO: 50000 } }, money, discountsNb.describe)).toBe("Gratis produkt over NO 500");
    expect(describeCampaign({ ...plain, kind: "bxgy", buyMinQuantity: 2, getQuantity: 1, getKind: "free" }, money, discountsNb.describe)).toBe("Kjøp 2, få 1 gratis");
  });
});
