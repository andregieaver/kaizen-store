import { createElement, type AnchorHTMLAttributes } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { BlockLink, isAppAddress } from "./block-link";

/** PolicyLink as a plain anchor that says its policy, so the markup shows which branch drew the link. */
vi.mock("./policy-link", () => ({
  PolicyLink: ({ policy, href, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { policy: string; href: string }) =>
    createElement("a", { "data-policy": policy, href, ...rest }),
}));

type Props = Parameters<typeof BlockLink>[0];
const draw = (props: Props, text = "t") => renderToStaticMarkup(createElement(BlockLink, props, text));

/**
 * Built pages' links (bloat review step 2.7, PF-4): an address of the app is a navigation inside it, fetched on intent; a pay path, a file, a
 * handler, another site, a hash, a mail or phone link and a new tab stay plain anchors (`docs/pci.md`).
 */
describe("isAppAddress", () => {
  it.each(["/s/demo/no/p/x", "/om-oss", "/s/demo/no/category/a?sort=price", "/no/blog/x#top"])("%s is an address of the app", (href) => {
    expect(isAppAddress(href)).toBe(true);
  });

  it.each([
    "/s/demo/no/cart",
    "/cart",
    "/no/checkout",
    "/s/demo/no/order/1",
    "https://example.com",
    "//example.com/x",
    "#contact",
    "mailto:a@b.no",
    "tel:123",
    "/downloads/a.pdf",
    "/api/x",
    "/admin",
    "/admin/demo",
    "/auth/callback",
    "/oauth/authorize",
    "/r/abc",
    "",
  ])("%j is not", (href) => {
    expect(isAppAddress(href)).toBe(false);
  });
});

describe("BlockLink", () => {
  it("stays in the app, on intent, for an address of the app, keeping its attributes", () => {
    const html = draw({ href: "/om-oss", className: "x", "data-block-id": "b1" } as Props);
    expect(html).toContain('data-policy="intent"');
    expect(html).toContain('class="x"');
    expect(html).toContain('data-block-id="b1"');
  });

  it("is a plain anchor in the builder's canvas, for a new tab and for a pay path", () => {
    expect(draw({ href: "/om-oss", plain: true })).not.toContain("data-policy");
    expect(draw({ href: "/om-oss", target: "_blank" })).not.toContain("data-policy");
    expect(draw({ href: "/s/demo/no/cart" })).not.toContain("data-policy");
  });
});

describe("both branches keep every attribute", () => {
  it("draws the same markup but for the policy", () => {
    const attrs = {
      className: "c",
      style: { color: "red" },
      "aria-label": "l",
      "aria-hidden": true,
      tabIndex: -1,
      rel: "next",
      "data-block-id": "b1",
      "data-hover": "lift",
      "data-button-frame": "",
      "data-kz-text": "button",
    };
    const inApp = draw({ href: "/om-oss", ...attrs } as Props);
    const plain = draw({ href: "/om-oss", plain: true, ...attrs } as Props);
    expect(inApp).toContain(' data-policy="intent"');
    expect(inApp.replace(' data-policy="intent"', "")).toBe(plain);
  });
});
