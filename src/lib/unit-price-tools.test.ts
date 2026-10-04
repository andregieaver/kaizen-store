import { describe, expect, it } from "vitest";

import { ADMIN_PAGES } from "./admin-map";
import { ASSISTANT_SKILLS } from "./assistant-skills";
import { t } from "./i18n";
import { MANAGER_TOOLS, PLATFORM_TOOLS, TOOL_WORDS } from "./manager-tools";
import { OWNER_TOOLS, OWNER_TOOLS_BY_NAME } from "./owner-tools";
import { TOOL_PERMISSIONS } from "./owner-tool-permissions";
import { unitPriceShown } from "./unit-price";
import { contentWords, unitPriceAnswer } from "./unit-price-tools";
import { WITH_VAT, priceVat } from "./pricing";

const en = t("en");
const gram250 = { amount: "250", unit: "g", base: "kg" } as const;

describe("the AI manager's unit price tool (D160)", () => {
  it("is one ungated read for the products' readers, with words and no write tool beside it", () => {
    const tool = OWNER_TOOLS_BY_NAME.unit_price_gaps;
    expect(tool.gate).toBeUndefined();
    expect(TOOL_PERMISSIONS.unit_price_gaps).toBe("products:read");
    expect(TOOL_WORDS.unit_price_gaps).toBeTruthy();
    expect(tool.description).toMatch(/Read only/);
    expect(tool.description).toMatch(/You cannot set/);
    expect(MANAGER_TOOLS.some((x) => (x.name as string) === "unit_price_gaps")).toBe(false);
    expect(PLATFORM_TOOLS.some((x) => (x.name as string) === "unit_price_gaps")).toBe(false);
    // A measure changes what the law says a page must show: no tool of the manager sets one.
    const writers = OWNER_TOOLS.filter((x) => /measure|content|unit_price/i.test(x.name)).map((x) => x.name);
    expect(writers).toEqual(["unit_price_gaps"]);
  });

  it("takes an optional product and a limit, and refuses nonsense", () => {
    const { input } = OWNER_TOOLS_BY_NAME.unit_price_gaps;
    expect(input.parse({})).toEqual({ limit: 25 });
    expect(input.parse({ product: "demo-keramikkopp", limit: 5 })).toEqual({ product: "demo-keramikkopp", limit: 5 });
    expect(input.safeParse({ limit: 0 }).success).toBe(false);
    expect(input.safeParse({ limit: 101 }).success).toBe(false);
    expect(input.safeParse({ product: "" }).success).toBe(false);
  });

  it("has a playbook that names tools and pages that exist and sets nothing itself", () => {
    const skill = ASSISTANT_SKILLS.find((s) => s.id === "unit-prices")!;
    expect(skill.area).toBe("store");
    const steps = skill.steps.join("\n");
    expect(steps).toContain("unit_price_gaps");
    expect(steps).toContain("get_product");
    expect(steps).toMatch(/cannot set content/);
    expect(steps).toMatch(/lawyer/);
    const ids = new Set(ADMIN_PAGES.map((p) => p.id));
    for (const page of ["product", "product.categories"]) expect(ids.has(page), page).toBe(true);
    expect(steps).toContain("(product, with productId)");
    expect(steps).toContain("(product.categories)");
  });
});

describe("contentWords", () => {
  it("writes what a pack holds as the owner reads it", () => {
    expect(contentWords({ ...gram250 })).toBe("250 g");
    expect(contentWords({ amount: "0.7500", unit: "l", base: "l" })).toBe("0.75 l");
    expect(contentWords({ amount: "1,5", unit: "m2", base: "m2" })).toBe("1.5 m²");
    expect(contentWords({ amount: "6", unit: "piece", base: "piece" })).toBe("6 pieces");
  });
});

describe("unitPriceAnswer", () => {
  it("is null for a variant with no content", () => {
    expect(unitPriceAnswer(null, "NOK", "nb-NO", en)).toBeNull();
  });

  it("says the figure unitPriceShown gives, with VAT for a consumer store", () => {
    const shown = unitPriceShown(4990, WITH_VAT, gram250, "kg");
    const answer = unitPriceAnswer(shown, "NOK", "en-GB", en)!;
    // 49.90 for 250 g is 199.60 per kg: the same figure the page shows, never computed here.
    expect(answer.with_vat).toMatch(/199\.60\/kg$/);
    expect(answer.without_vat).toBeUndefined();
    expect(answer.not_shown).toBeUndefined();
  });

  it("gives both for a store that sells to both, and only the net for businesses", () => {
    const vat = priceVat("both", 0.25);
    const both = unitPriceAnswer(unitPriceShown(12500, vat, gram250, "kg"), "NOK", "en-GB", en)!;
    expect(both.with_vat).toMatch(/500\.00\/kg$/);
    expect(both.without_vat).toMatch(/400\.00\/kg$/);
    const net = unitPriceAnswer(unitPriceShown(12500, priceVat("businesses", 0.25), gram250, "kg"), "NOK", "en-GB", en)!;
    expect(net.with_vat).toBeUndefined();
    expect(net.without_vat).toMatch(/400\.00\/kg$/);
  });

  it("says why nothing is shown, in plain words, never a zero", () => {
    const equal = unitPriceAnswer(unitPriceShown(4990, WITH_VAT, { amount: "1", unit: "kg" }, "kg"), "NOK", "en-GB", en)!;
    expect(equal.with_vat).toBeUndefined();
    expect(equal.not_shown).toMatch(/already is the unit price/);
    const free = unitPriceAnswer(unitPriceShown(0, WITH_VAT, gram250, "kg"), "NOK", "en-GB", en)!;
    expect(free.not_shown).toMatch(/price is 0/);
  });

  it("uses the base the market shows", () => {
    const shown = unitPriceShown(4990, WITH_VAT, gram250, "100g");
    expect(unitPriceAnswer(shown, "NOK", "en-GB", en)!.with_vat).toMatch(/19\.96\/100 g$/);
  });
});
