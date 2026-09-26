import { describe, expect, it } from "vitest";

import {
  EMPTY_NAVIGATION,
  isMenuAddress,
  linkExists,
  menuHref,
  menuLabel,
  navigationSchema,
  parseNavigation,
  platformMenuLink,
  platformNavigationSchema,
  termNames,
} from "./navigation";

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

  it("reads menus saved before the logo for dark backgrounds as having none (D60)", () => {
    const logo = { url: "/demo/logo.svg", width: 120, height: 32 };
    expect(parseNavigation({ logo, header: [], footer: [] })).toEqual({ logo, logoDark: null, header: [], footer: [] });
    const logoDark = { ...logo, url: "/demo/logo-light.svg" };
    expect(parseNavigation({ logo, logoDark, header: [], footer: [] }).logoDark).toEqual(logoDark);
    expect(navigationSchema.safeParse({ logo, logoDark: { ...logoDark, url: "javascript:alert(1)" }, header: [], footer: [] }).success).toBe(false);
  });
});

describe("category and tag links (D50)", () => {
  const names = termNames([
    { kind: "category", slug: "kopper", name: "Kopper" },
    { kind: "tag", slug: "nyhet", name: "Nyhet" },
  ]);

  it("lead to the store's listings, named after the category or tag unless given a text", () => {
    expect(menuHref({ kind: "category", slug: "kopper" }, "/s/demo/no")).toEqual({ href: "/s/demo/no/category/kopper", external: false });
    expect(menuHref({ kind: "tag", slug: "nyhet" }, "/s/demo/no")).toEqual({ href: "/s/demo/no/tag/nyhet", external: false });
    expect(menuLabel({ label: {}, link: { kind: "category", slug: "kopper" } }, "nb-NO", builtIn, names)).toBe("Kopper");
    expect(menuLabel({ label: { "nb-NO": "Krus" }, link: { kind: "category", slug: "kopper" } }, "nb-NO", builtIn, names)).toBe("Krus");
  });

  it("are left out once the category or tag is gone", () => {
    expect(linkExists({ kind: "category", slug: "kopper" }, names)).toBe(true);
    expect(linkExists({ kind: "tag", slug: "gone" }, names)).toBe(false);
    expect(linkExists({ kind: "home" }, names)).toBe(true);
    const platform = { home: "Home", signUp: "Start", signIn: "Sign in" };
    expect(platformMenuLink({ label: {}, link: { kind: "tag", slug: "nyhet" } }, new Map(), platform, names)).toEqual({
      href: "/tag/nyhet",
      text: "Nyhet",
      external: false,
    });
    expect(platformMenuLink({ label: { en: "Old" }, link: { kind: "category", slug: "gone" } }, new Map(), platform, names)).toBeNull();
  });

  it("need an address", () => {
    const menu = (link: unknown) => ({ logo: null, header: [{ label: {}, link }], footer: [] });
    expect(navigationSchema.safeParse(menu({ kind: "category", slug: "kopper" })).success).toBe(true);
    expect(navigationSchema.safeParse(menu({ kind: "category", slug: "" })).success).toBe(false);
    expect(platformNavigationSchema.safeParse(menu({ kind: "tag", slug: "Not Ok" })).success).toBe(false);
  });
});

describe("links to a store's pages (D54)", () => {
  const names = {
    ...termNames([]),
    page: new Map([
      ["om-oss", { slug: "om-oss", title: "Om oss" }],
      // A page that moved is also known by its old address.
      ["levering", { slug: "frakt", title: "Frakt" }],
    ]),
  };

  it("lead to the page where it is now, named after it unless given a text", () => {
    expect(menuHref({ kind: "page", slug: "om-oss" }, "/s/demo/no", names)).toEqual({ href: "/s/demo/no/om-oss", external: false });
    expect(menuHref({ kind: "page", slug: "levering" }, "/s/demo/no", names).href).toBe("/s/demo/no/frakt");
    expect(menuLabel({ label: {}, link: { kind: "page", slug: "levering" } }, "nb-NO", builtIn, names)).toBe("Frakt");
    expect(menuLabel({ label: { "nb-NO": "Hvem vi er" }, link: { kind: "page", slug: "om-oss" } }, "nb-NO", builtIn, names)).toBe(
      "Hvem vi er",
    );
  });

  it("are left out while the page is not published, and need an address", () => {
    expect(linkExists({ kind: "page", slug: "om-oss" }, names)).toBe(true);
    expect(linkExists({ kind: "page", slug: "utkast" }, names)).toBe(false);
    // Kaizen's page links are by id, and checked where its menus are drawn.
    expect(linkExists({ kind: "page", pageId: "00000000-0000-4000-8000-000000000000" }, names)).toBe(true);
    const menu = (link: unknown) => ({ logo: null, header: [{ label: {}, link }], footer: [] });
    expect(navigationSchema.safeParse(menu({ kind: "page", slug: "om-oss" })).success).toBe(true);
    expect(navigationSchema.safeParse(menu({ kind: "page", slug: "" })).success).toBe(false);
    expect(navigationSchema.safeParse(menu({ kind: "page", pageId: "00000000-0000-4000-8000-000000000000" })).success).toBe(false);
  });
});

describe("links to the blog (D57)", () => {
  const names = {
    ...termNames([]),
    article: new Map([["hei", { slug: "hei-igjen", title: "Hei igjen" }]]),
    blogCategory: new Map([["nyheter", "Nyheter"]]),
  };

  it("lead to a store's blog, its articles where they are now, and its categories", () => {
    expect(menuHref({ kind: "blog" }, "/s/demo/no").href).toBe("/s/demo/no/blog");
    expect(menuHref({ kind: "article", slug: "hei" }, "/s/demo/no", names).href).toBe("/s/demo/no/blog/hei-igjen");
    expect(menuHref({ kind: "blogCategory", slug: "nyheter" }, "/s/demo/no").href).toBe("/s/demo/no/blog/category/nyheter");
    expect(menuLabel({ label: {}, link: { kind: "blog" } }, "nb-NO", { ...builtIn, blog: "Blogg" }, names)).toBe("Blogg");
    expect(menuLabel({ label: {}, link: { kind: "article", slug: "hei" } }, "nb-NO", builtIn, names)).toBe("Hei igjen");
    expect(menuLabel({ label: {}, link: { kind: "blogCategory", slug: "nyheter" } }, "nb-NO", builtIn, names)).toBe("Nyheter");
    expect(linkExists({ kind: "article", slug: "utkast" }, names)).toBe(false);
    expect(linkExists({ kind: "blogCategory", slug: "borte" }, names)).toBe(false);
    const menu = (link: unknown) => ({ logo: null, header: [{ label: {}, link }], footer: [] });
    expect(navigationSchema.safeParse(menu({ kind: "article", slug: "hei" })).success).toBe(true);
    expect(navigationSchema.safeParse(menu({ kind: "blog" })).success).toBe(true);
  });

  it("lead to Kaizen's blog and its articles by id, left out while not published", () => {
    const platform = { home: "Home", signUp: "Start", signIn: "Sign in", blog: "Blog" };
    const id = "00000000-0000-4000-8000-000000000001";
    const blog = {
      articles: new Map([[id, { id, slug: "welcome", title: "Welcome" }]]),
      categories: new Map([["news", "News"]]),
    };
    const link = (l: unknown) => platformMenuLink({ label: {}, link: l as never }, new Map(), platform, undefined, blog);
    expect(link({ kind: "blog" })).toEqual({ href: "/blog", text: "Blog", external: false });
    expect(link({ kind: "article", pageId: id })).toEqual({ href: "/blog/welcome", text: "Welcome", external: false });
    expect(link({ kind: "article", pageId: "00000000-0000-4000-8000-000000000002" })).toBeNull();
    expect(link({ kind: "blogCategory", slug: "news" })).toEqual({ href: "/blog/category/news", text: "News", external: false });
    const menu = (l: unknown) => ({ logo: null, header: [{ label: {}, link: l }], footer: [] });
    expect(platformNavigationSchema.safeParse(menu({ kind: "article", pageId: id })).success).toBe(true);
    expect(platformNavigationSchema.safeParse(menu({ kind: "article", slug: "welcome" })).success).toBe(false);
  });
});
