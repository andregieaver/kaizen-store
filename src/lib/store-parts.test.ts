import { describe, expect, it } from "vitest";

import { pageInput } from "./page-content";
import { starterPage } from "./page-roles";
import { pageBlocks } from "./page-content";
import { t } from "./i18n";
import {
  PIECE_GROUPS,
  SHOP_PART_KEYS,
  STORE_PARTS,
  STORE_PIECES,
  STORE_PIECE_KEYS,
  isShopPart,
  piecesOf,
  routeOfPart,
  shopPartCopy,
} from "./store-parts";

let n = 0;
const id = () => `id-${++n}`;

describe("the pieces of the working pages", () => {
  it("each belong to a working page, and no two share a name there", () => {
    for (const piece of STORE_PIECE_KEYS) {
      expect(Object.hasOwn(STORE_PARTS, STORE_PIECES[piece].route), piece).toBe(true);
      // A piece is never a page's name, so a block's part says which it is.
      expect(Object.hasOwn(STORE_PARTS, piece), piece).toBe(false);
    }
    for (const group of PIECE_GROUPS) {
      const names = piecesOf(group.route).map((piece) => STORE_PIECES[piece].name);
      expect(names.length, group.route).toBeGreaterThan(1);
      expect(new Set(names).size, group.route).toBe(names.length);
    }
    // Only pages that come apart are grouped for the builder.
    expect(PIECE_GROUPS.map((group) => group.route).sort()).toEqual(
      [...new Set(STORE_PIECE_KEYS.map((p) => STORE_PIECES[p].route))].sort(),
    );
  });

  it("are named for their page, in the order the standard page draws them", () => {
    for (const piece of STORE_PIECE_KEYS) expect(piece.startsWith(`${routeOfPart(piece)}_`), piece).toBe(true);
    expect(piecesOf("cart")).toEqual(["cart_lines", "cart_summary", "cart_code", "cart_checkout", "cart_continue"]);
    expect(piecesOf("wishlist")).toEqual([]);
  });

  it("know their page and their words", () => {
    expect(routeOfPart("cart")).toBe("cart");
    expect(routeOfPart("order_totals")).toBe("order");
    expect(shopPartCopy("checkout_payment").hint).toMatch(/pay/i);
    expect(shopPartCopy("cart").name).toBe(STORE_PARTS.cart.name);
    expect(isShopPart("cart_lines")).toBe(true);
    expect(isShopPart("basket")).toBe(false);
    expect(SHOP_PART_KEYS).toHaveLength(Object.keys(STORE_PARTS).length + STORE_PIECE_KEYS.length);
  });

  it("all come from what the browser sends, and only the known ones", () => {
    const page = starterPage("cart", t("en"), id, "/s/demo/no");
    for (const part of SHOP_PART_KEYS) {
      const withBlock = {
        ...page,
        rows: [{ ...page.rows[0], columns: [{ id: "c", blocks: [{ id: "b", type: "storePart", part }] }] }],
      };
      expect(pageInput.safeParse(withBlock).success, part).toBe(true);
    }
  });

  it("start the cart, checkout and order pages, each piece once", () => {
    for (const route of ["cart", "checkout", "order"] as const) {
      const parts = pageBlocks(starterPage(route, t("nb"), id, "/s/demo/no"))
        .filter((block) => block.type === "storePart")
        .map((block) => block.part);
      // What the standard page draws is there, and nothing twice; the cart's own way back is an extra.
      expect([...parts].sort()).toEqual(piecesOf(route).filter((piece) => piece !== "cart_continue").sort());
    }
  });
});
