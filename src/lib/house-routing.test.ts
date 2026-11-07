import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { PLATFORM_ROUTES, PLATFORM_ROUTES_NB, houseHostStore, houseServedPath, platformKeeps } from "./house-routing";
import { localizationOf } from "./localization";
import { toMarket } from "./markets";
import { marketPath } from "./paths";
import {
  addressDecision,
  addressSegment,
  afterMarket,
  forgetStoreAddresses,
  rememberStoreAddress,
  reservedChoiceSlugs,
  shortChoiceOf,
  storeAddressOf,
  storePathOf,
  writtenChoice,
  type StoreAddress,
} from "./store-address";

const APP = join(__dirname, "..", "app");

/** The folders and files of a route folder, route groups opened (`(platform)`) and private folders (`_parts`) left out. */
function routesIn(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name.startsWith("_")) return [];
    if (/^\(.+\)$/.test(name) && statSync(path).isDirectory()) return routesIn(path);
    return [name];
  });
}

/** The site's own pages, which the store serves while the switch is on: the front page, a page by its slug, the blog and its lists, the cookie page. */
const SITE_PAGES = ["[slug]", "blog", "category", "cookies", "tag", "page.tsx", "layout.tsx", "not-found.tsx"];
/** Files of the app's root that are no route, and the store's own folder (`s` stays the platform's: it is where every store's pages are). */
const NOT_ROUTES = ["globals.css", "motion.css", "global-error.tsx", "global-not-found.tsx", "no"];

describe("what stays the platform's on Kaizena Flow's own host (D484, plan step 5)", () => {
  it("lists every route of the app that is no page of the site", () => {
    const routes = [...new Set(routesIn(APP))].filter((name) => !SITE_PAGES.includes(name) && !NOT_ROUTES.includes(name));
    for (const route of routes) expect(PLATFORM_ROUTES, `src/app/${route} is a route of the platform's: list it in PLATFORM_ROUTES`).toContain(route);
  });

  it("lists every Norwegian route that is no page of the site", () => {
    const nb = ["(platform-nb)", "(docs-nb)", "(theme-preview-nb)"].flatMap((group) => routesIn(join(APP, group, "no")));
    const routes = [...new Set(nb)].filter((name) => !SITE_PAGES.includes(name));
    for (const route of routes) expect(PLATFORM_ROUTES_NB, `src/app/(…-nb)/no/${route}: list it in PLATFORM_ROUTES_NB`).toContain(route);
  });

  it("keeps the platform's routes and gives the store everything else", () => {
    for (const path of ["/admin", "/admin/kaizenaflow/pages", "/api/health", "/sign-up", "/themes/atelier", "/docs/x", "/status", "/report", "/get-domain", "/r/abc", "/support", "/unsubscribe/x", "/holding/x", "/.well-known/oauth-protected-resource", "/oauth/authorize", "/s/demo", "/robots.txt", "/sitemap.xml", "/sitemap-kaizen.xml", "/llms.txt"]) {
      expect(platformKeeps(path), path).toBe(true);
    }
    for (const path of ["/no/sign-up", "/no/themes", "/no/docs", "/no/status", "/no/report", "/no/get-domain"]) expect(platformKeeps(path), path).toBe(true);
    for (const path of ["/", "/about-us", "/blog", "/blog/x", "/category/news", "/tag/x", "/cookies", "/no", "/no/about-us", "/no/blog", "/no/cookies", "/pricing", "/agents.md", "/nb/about-us"]) {
      expect(platformKeeps(path), path).toBe(false);
    }
  });

  it("answers with the store only on the site's own host, with the switch on, for the store's paths", () => {
    const site = "kaizenaflow.com";
    expect(houseHostStore({ host: "kaizenaflow.com", pathname: "/about-us", site, house: "kaizenaflow" })).toBe("kaizenaflow");
    expect(houseHostStore({ host: "KaizenaFlow.com:443", pathname: "/", site, house: "kaizenaflow" })).toBe("kaizenaflow");
    expect(houseHostStore({ host: "kaizenaflow.com", pathname: "/sign-up", site, house: "kaizenaflow" })).toBeNull();
    // The switch off: no store.
    expect(houseHostStore({ host: "kaizenaflow.com", pathname: "/about-us", site, house: null })).toBeNull();
    // Another host: a store's own, the theme store's, a held domain.
    expect(houseHostStore({ host: "demo.kaizenstore.site", pathname: "/about-us", site, house: "kaizenaflow" })).toBeNull();
    expect(houseHostStore({ host: "themes.kaizenaflow.com", pathname: "/", site, house: "kaizenaflow" })).toBeNull();
    expect(houseServedPath("kaizenaflow", "/")).toBe("/s/kaizenaflow");
    expect(houseServedPath("kaizenaflow", "/no-nb/about-us")).toBe("/s/kaizenaflow/no-nb/about-us");
  });
});

const NO_EN = toMarket({ code: "NO", currency: "NOK", defaultLocale: "en-GB" });
const NO_NB = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });

/** Kaizena Flow's own store as D466 made it: Norway, English its own language, Norwegian offered (Several languages on). */
function house(options: { locales?: string[]; languages?: boolean; own?: typeof NO_EN; isHouse?: boolean } = {}): StoreAddress {
  const markets = [options.own ?? NO_EN];
  const localization = localizationOf(options.locales ?? ["en-GB", "nb-NO"], [], markets, { kept: markets, languages: options.languages ?? true, currencies: false });
  const address = storeAddressOf({ markets, keptMarkets: markets, allMarkets: markets, localization, house: options.isHouse ?? true });
  if (!address) throw new Error("no address");
  return address;
}

const onHost = (parts: string[]) => ({ store: "kaizenaflow", hostBased: true, parts });

afterEach(() => forgetStoreAddresses());

describe("Kaizena Flow's own store keeps Norwegian at /no/ (D484)", () => {
  it("has the alias only as Kaizena Flow's own store, in Norway, with English its own language", () => {
    expect(house().aliases).toEqual({ no: "nb" });
    expect(house({ isHouse: false }).aliases).toBeUndefined();
    // Norwegian its own language: `/no/` would mean nothing else, so no alias.
    expect(house({ own: NO_NB, locales: ["nb-NO", "en-GB"] }).aliases).toEqual({});
  });

  it("serves /no/… from Norwegian and / from English, and moves /nb/… and /no-nb/… to /no/…", () => {
    const address = house();
    expect(addressDecision(onHost([]), address)).toEqual({ rewrite: "/no" });
    expect(addressDecision(onHost(["about-us"]), address)).toEqual({ rewrite: "/no/about-us" });
    expect(addressDecision(onHost(["no"]), address)).toEqual({ rewrite: "/no-nb" });
    expect(addressDecision(onHost(["no", "about-us"]), address)).toEqual({ rewrite: "/no-nb/about-us" });
    expect(addressDecision(onHost(["NO", "blog", "x"]), address)).toEqual({ rewrite: "/no-nb/blog/x" });
    expect(addressDecision(onHost(["nb", "about-us"]), address)).toEqual({ redirect: "/no/about-us" });
    expect(addressDecision(onHost(["no-nb", "about-us"]), address)).toEqual({ redirect: "/no/about-us" });
    // Under /s/{store} on another host the same, with the store's base.
    expect(addressDecision({ store: "kaizenaflow", hostBased: false, parts: ["no", "x"] }, address)).toEqual({ rewrite: "/s/kaizenaflow/no-nb/x" });
  });

  it("leaves another store in Norway as it was: /no/… is its own country's long address", () => {
    const address = house({ isHouse: false });
    expect(addressDecision(onHost(["no", "about-us"]), address)).toEqual({ redirect: "/about-us" });
    expect(addressDecision(onHost(["nb", "about-us"]), address)).toEqual({ rewrite: "/no-nb/about-us" });
    expect(addressSegment(address, "no-nb")).toBe("nb");
  });

  it("leaves /no/… to the route once Norwegian is kept but not offered, and reads it as the own country once it is gone", () => {
    // Several languages off: Norwegian is kept, so the long form serves it and the route moves it, as any kept choice.
    const kept = house({ languages: false });
    expect(shortChoiceOf(kept, "no")).toBe("kept");
    expect(addressDecision(onHost(["no", "about-us"]), kept)).toEqual({ rewrite: "/no-nb/about-us" });
    // Norwegian taken out of the store's languages: `/no/…` is the own country's long address again.
    const gone = house({ locales: ["en-GB"] });
    expect(shortChoiceOf(gone, "no")).toBeNull();
    expect(addressDecision(onHost(["no", "about-us"]), gone)).toEqual({ redirect: "/about-us" });
  });

  it("writes links to Norwegian at /no/…", () => {
    const address = house();
    expect(addressSegment(address, "no")).toBe("");
    expect(addressSegment(address, "no-nb")).toBe("no");
    expect(writtenChoice(address, "nb")).toBe("no");
    expect(writtenChoice(address, "en")).toBe("en");
    rememberStoreAddress("kaizenaflow", address);
    expect(marketPath("kaizenaflow", "no-nb", "/about-us")).toMatch(/\/no\/about-us$/);
    expect(marketPath("kaizenaflow", "no", "/about-us")).toMatch(/\/about-us$/);
    expect(marketPath("kaizenaflow", "no", "/about-us")).not.toMatch(/\/no\//);
  });

  it("knows the market of a path written either way, and keeps the alias from pages' addresses", () => {
    const address = house();
    expect(afterMarket(["no", "about-us"], address)).toEqual({ market: "no-nb", rest: ["about-us"] });
    expect(afterMarket(["about-us"], address)).toEqual({ market: "no", rest: ["about-us"] });
    expect(reservedChoiceSlugs(address)).toEqual(expect.arrayContaining(["nb", "no"]));
    expect(storePathOf("/no/about-us", "kaizenaflow")).toEqual(onHost(["no", "about-us"]));
  });
});
