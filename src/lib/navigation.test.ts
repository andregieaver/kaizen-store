import { describe, expect, it } from "vitest";

import { EMPTY_NAVIGATION, isMenuAddress, menuHref, menuLabel, navigationSchema, parseNavigation } from "./navigation";

const builtIn = { home: "Alle produkter", account: "Min konto", cart: "Handlekurv" };

describe("menuHref", () => {
  const base = "/s/demo/no";

  it("links Kaizen's own pages from the shopper's country", () => {
    expect(menuHref({ kind: "home" }, base)).toEqual({ href: base, external: false });
    expect(menuHref({ kind: "account" }, base)).toEqual({ href: `${base}/account`, external: false });
    expect(menuHref({ kind: "cart" }, base)).toEqual({ href: `${base}/cart`, external: false });
    expect(menuHref({ kind: "product", handle: "demo-notatbok" }, base)).toEqual({
      href: `${base}/p/demo-notatbok`,
      external: false,
    });
  });

  it("keeps paths in the store and marks other sites", () => {
    expect(menuHref({ kind: "url", url: "/p/demo-kopp" }, base)).toEqual({ href: `${base}/p/demo-kopp`, external: false });
    expect(menuHref({ kind: "url", url: "https://example.no" }, base)).toEqual({ href: "https://example.no", external: true });
  });
});

describe("menuLabel", () => {
  it("uses the owner's text, then Kaizen's name for its pages, then another language's", () => {
    expect(menuLabel({ label: { "nb-NO": "Alt" }, link: { kind: "home" } }, "nb-NO", builtIn)).toBe("Alt");
    expect(menuLabel({ label: {}, link: { kind: "cart" } }, "nb-NO", builtIn)).toBe("Handlekurv");
    expect(menuLabel({ label: { "sv-SE": "Om oss" }, link: { kind: "url", url: "/om" } }, "nb-NO", builtIn)).toBe("Om oss");
  });
});

describe("addresses and stored values", () => {
  it("takes web addresses and store paths, and nothing that runs code", () => {
    expect(isMenuAddress("https://example.no/om")).toBe(true);
    expect(isMenuAddress("/p/notatbok")).toBe(true);
    expect(isMenuAddress("javascript:alert(1)")).toBe(false);
    expect(isMenuAddress("//evil.example")).toBe(false);
    expect(isMenuAddress("")).toBe(false);
  });

  it("limits the menus and falls back to empty on a damaged value", () => {
    const item = { label: {}, link: { kind: "home" } };
    expect(navigationSchema.safeParse({ logo: null, header: Array(9).fill(item), footer: [] }).success).toBe(false);
    expect(navigationSchema.safeParse({ logo: null, header: Array(8).fill(item), footer: [] }).success).toBe(true);
    expect(parseNavigation({ header: "nope" })).toEqual(EMPTY_NAVIGATION);
    expect(parseNavigation(null)).toEqual(EMPTY_NAVIGATION);
  });
});
