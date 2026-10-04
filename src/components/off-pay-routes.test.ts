import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

let current = "/s/demo/no";
vi.mock("next/navigation", () => ({ usePathname: () => current }));

import { OffPayRoutes } from "./off-pay-routes";

const draw = (path: string) => {
  current = path;
  return renderToString(createElement(OffPayRoutes, null, createElement("p", null, "banner and chat")));
};

describe("what the pay routes do not draw (wave 1, 1e)", () => {
  it("draws its children on the store's own pages", () => {
    for (const path of [
      "/s/demo/no",
      "/s/demo/no/products",
      "/s/demo/no/p/lampe",
      "/s/demo/no/account",
      "/s/demo/no/withdraw",
      "/no",
      "/no/products",
    ]) {
      expect(draw(path), path).toContain("banner and chat");
    }
  });

  it("draws nothing on the cart, the checkout and an order, on either shape of address and in any market", () => {
    for (const path of [
      "/s/demo/no/cart",
      "/s/demo/se/checkout",
      "/s/demo/no/order/abc",
      "/s/demo/no/order/abc/terms/terms",
      "/no/cart",
      "/no-en-eur/checkout",
      "/no~tok_1/order/x",
    ]) {
      expect(draw(path), path).not.toContain("banner and chat");
    }
  });
});
