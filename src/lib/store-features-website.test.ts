import { describe, expect, it } from "vitest";

import { SHOP_DESTINATIONS, SHOP_TOOLS, storeTools } from "./chat";
import { LEGAL_ROLES, LEGAL_ROLE_NEEDS, legalRoleNeeded } from "./legal-roles";
import { SHOP_LINK_KINDS, shopLink } from "./navigation";
import { toolFeature, toolOffered } from "./owner-tool-features";
import { afterSaleIsOpen, isFeatureId, showsWithdrawalLink } from "./store-features";

/** Website mode (D178 step 5, `docs/store-features.md` 4e): the online shop switched off. */
describe("website mode (D178 step 5)", () => {
  it("is after-sale open while an order can still be withdrawn from or a return is open", () => {
    expect(afterSaleIsOpen({ withdrawable: 0, openReturns: 0 })).toBe(false);
    expect(afterSaleIsOpen({ withdrawable: 1, openReturns: 0 })).toBe(true);
    expect(afterSaleIsOpen({ withdrawable: 0, openReturns: 2 })).toBe(true);
  });

  it("keeps the withdrawal link while the shop is on, and in a website only while after-sale is open", () => {
    expect(showsWithdrawalLink(["shop"], false)).toBe(true);
    expect(showsWithdrawalLink([], true)).toBe(true);
    expect(showsWithdrawalLink([], false)).toBe(false);
    // Kept on features without the shop are asleep: still a website.
    expect(showsWithdrawalLink(["bonus", "subscriptions"], false)).toBe(false);
  });

  it("needs the checkout's legal pages only while the shop is on, the withdrawal information and returns policy also after the sale", () => {
    for (const role of LEGAL_ROLES) {
      const feature = LEGAL_ROLE_NEEDS[role].feature;
      if (feature) expect(isFeatureId(feature), role).toBe(true);
      expect(legalRoleNeeded(role, true, false), role).toBe(true);
    }
    expect(LEGAL_ROLES.filter((role) => legalRoleNeeded(role, false, false))).toEqual(["privacy", "imprint", "accessibility"]);
    expect(LEGAL_ROLES.filter((role) => legalRoleNeeded(role, false, true))).toEqual(["privacy", "returns_policy", "withdrawal_info", "imprint", "accessibility"]);
  });

  it("leaves the shop's links out of a website's menus", () => {
    for (const kind of SHOP_LINK_KINDS) expect(shopLink({ kind }), kind).toBe(true);
    for (const kind of ["home", "page", "article", "blog", "blogCategory", "url"]) expect(shopLink({ kind }), kind).toBe(false);
  });

  it("gives a website's chat agent no product tools and none of the shop's places", () => {
    const names = (selling: boolean) => storeTools(selling).map((tool) => tool.name);
    expect(names(true)).toEqual(expect.arrayContaining([...SHOP_TOOLS]));
    expect(names(false)).toEqual(["search_content", "store_info", "navigate"]);
    const navigate = storeTools(false).find((tool) => tool.name === "navigate")!;
    const places = (navigate.parameters.properties as { to: { enum: string[] } }).to.enum;
    for (const place of SHOP_DESTINATIONS) expect(places, place).not.toContain(place);
    expect(places).toEqual(["home", "page", "article", "blog"]);
  });

  it("puts the AI manager's selling tools behind the shop, and keeps the site's own", () => {
    for (const name of ["sales_summary", "list_orders", "get_order", "list_products", "set_stock", "create_discount", "create_campaign", "list_customers", "vat_report", "refund_order"]) {
      expect(toolFeature(name), name).toBe("shop");
      expect(toolOffered({ features: [] }, name), name).toBe(false);
      expect(toolOffered({ features: ["shop"] }, name), name).toBe(true);
    }
    for (const name of ["store_overview", "list_pages", "list_field_groups", "setup_progress", "list_experiments", "redirect_overview", "list_privacy_requests"]) {
      expect(toolOffered({ features: [] }, name), name).toBe(true);
    }
  });
});
