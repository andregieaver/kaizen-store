// @ts-expect-error Next bundles path-to-regexp, the router's own matcher, without types.
import { match } from "next/dist/compiled/path-to-regexp";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { localizationOf } from "./localization";
import { toMarket } from "./markets";
import { marketHome, marketPath } from "./paths";
import { STATIC_EXTENSIONS } from "./redirect-path";
import {
  MARKET_ROUTES,
  STORE_MATCHER,
  addressDecision,
  addressSegment,
  afterMarket,
  forgetStoreAddresses,
  rememberStoreAddress,
  reservedChoiceSlugs,
  shortChoiceOf,
  storeAddressOf,
  storePathOf,
  type StoreAddress,
} from "./store-address";

const NO = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const SE = toMarket({ code: "SE", currency: "SEK", defaultLocale: "sv-SE" });
const DK = toMarket({ code: "DK", currency: "DKK", defaultLocale: "da-DK" });
const EUR = { currency: "EUR", rate: 1, roundTo: 1 };
/** The country's own currency needs a rate for another to be shown. */
const NOK = { currency: "NOK", rate: 11.6, roundTo: 100 };

/** A store as `getStore()` reads it: countries kept and offered, languages and currencies chosen and switched on or off. */
function shape(options: { kept?: typeof NO[]; countries?: boolean; locales?: string[]; currencies?: (typeof EUR)[]; languages?: boolean; currencyChoice?: boolean } = {}): StoreAddress {
  const kept = options.kept ?? [NO];
  const markets = options.countries ? kept : kept.slice(0, 1);
  const localization = localizationOf(options.locales ?? [], options.currencies ?? [], markets, {
    kept,
    languages: options.languages ?? true,
    currencies: options.currencyChoice ?? true,
  });
  const address = storeAddressOf({ markets, keptMarkets: kept, allMarkets: kept, localization });
  if (!address) throw new Error("no address");
  return address;
}

const single = shape({ locales: ["nb-NO", "en-GB"], currencies: [EUR, NOK] });
const multi = shape({ kept: [NO, SE, DK], countries: true, locales: ["nb-NO", "en-GB"], currencies: [EUR, NOK] });

afterEach(() => forgetStoreAddresses());

describe("a store's address shape (D181)", () => {
  it("has no country while one country is offered: Several countries off, or one country kept", () => {
    expect(single).toMatchObject({ home: "no", marketless: true, languages: ["en"], currencies: ["eur"] });
    expect(shape({ kept: [NO, SE], countries: false }).marketless).toBe(true);
    expect(shape({ kept: [NO, SE], countries: false }).countries).toEqual(["no", "se"]);
    expect(multi.marketless).toBe(false);
    expect(shape({ kept: [SE], countries: true }).home).toBe("se");
  });

  it("keeps languages and currencies switched off apart from those offered", () => {
    const off = shape({ locales: ["nb-NO", "en-GB", "de-DE"], currencies: [EUR, NOK], languages: false, currencyChoice: false });
    expect(off.languages).toEqual([]);
    expect(off.currencies).toEqual([]);
    expect(off.keptLanguages).toEqual(["en", "de"]);
    expect(off.keptCurrencies).toEqual(["eur"]);
  });

  it("reads a short first part as a choice it offers or keeps, else as a page's address", () => {
    expect(shortChoiceOf(single, "en")).toBe("offered");
    expect(shortChoiceOf(single, "eur")).toBe("offered");
    expect(shortChoiceOf(single, "en-eur")).toBe("offered");
    const off = shape({ locales: ["nb-NO", "en-GB"], currencies: [EUR, NOK], languages: false });
    expect(shortChoiceOf(off, "en")).toBe("kept");
    expect(shortChoiceOf(off, "en-eur")).toBe("kept");
    expect(shortChoiceOf(off, "eur")).toBe("offered");
    for (const page of ["om", "om-oss", "faq", "de", "usd", "home", "p", ""]) expect(shortChoiceOf(single, page), page).toBeNull();
  });

  it("reserves the choices it keeps as page addresses", () => {
    expect(reservedChoiceSlugs(single).sort()).toEqual(["en", "en-eur", "eur"]);
    expect(reservedChoiceSlugs(null)).toEqual([]);
  });
});

describe("links to a store's pages (marketPath)", () => {
  it("leave the country out for a store that sells in one, and keep it otherwise", () => {
    expect(addressSegment(single, "no")).toBe("");
    expect(addressSegment(single, "no-en")).toBe("en");
    expect(addressSegment(single, "no-eur")).toBe("eur");
    expect(addressSegment(single, "no-en-eur")).toBe("en-eur");
    // Another country, a view neither offered nor kept, an A/B version: as they are (the route moves them).
    expect(addressSegment(single, "se")).toBe("se");
    expect(addressSegment(single, "no-de")).toBe("no-de");
    expect(addressSegment(single, "no~aaaaaaaab")).toBe("no~aaaaaaaab");
    expect(addressSegment(multi, "no")).toBe("no");
    expect(addressSegment(null, "no-en")).toBe("no-en");
  });

  it("follow the shape `getStore()` last read, and have the country for a store not read yet", () => {
    expect(marketPath("kaiza", "no", "/home")).toBe("/s/kaiza/no/home");
    rememberStoreAddress("kaiza", single);
    expect(marketPath("kaiza", "no", "/home")).toBe("/s/kaiza/home");
    expect(marketPath("kaiza", "no-en", "/cart")).toBe("/s/kaiza/en/cart");
    expect(marketPath("kaiza", "no")).toBe("/s/kaiza");
    expect(marketHome("kaiza", "no")).toBe("/s/kaiza");
    // The caller's own knowledge of the shape wins (the proxy's facts).
    expect(marketPath("kaiza", "no", "/home", multi)).toBe("/s/kaiza/no/home");
    expect(marketPath("kaiza", "no", "/home", null)).toBe("/s/kaiza/no/home");
    rememberStoreAddress("kaiza", multi);
    expect(marketPath("kaiza", "no", "/home")).toBe("/s/kaiza/no/home");
  });

  it("are empty for the front page on the store's own host, which marketHome() makes `/`", () => {
    const before = process.env.NEXT_PUBLIC_STORE_DOMAIN;
    process.env.NEXT_PUBLIC_STORE_DOMAIN = "kaizenstores.com";
    try {
      rememberStoreAddress("kaiza", single);
      expect(marketPath("kaiza", "no")).toBe("");
      expect(marketHome("kaiza", "no")).toBe("/");
      expect(marketPath("kaiza", "no", "/home")).toBe("/home");
      expect(marketPath("kaiza", "no-en")).toBe("/en");
    } finally {
      if (before === undefined) delete process.env.NEXT_PUBLIC_STORE_DOMAIN;
      else process.env.NEXT_PUBLIC_STORE_DOMAIN = before;
    }
  });
});

describe("where a request for a store's page goes (addressDecision)", () => {
  const at = (pathname: string, host: string | null = null) => {
    const request = storePathOf(pathname, host);
    if (!request) throw new Error(pathname);
    return request;
  };

  it("serves a store that sells in one country without its country, on Kaizen's address and its own host", () => {
    expect(addressDecision(at("/s/kaiza"), single)).toEqual({ rewrite: "/s/kaiza/no" });
    expect(addressDecision(at("/s/kaiza/home"), single)).toEqual({ rewrite: "/s/kaiza/no/home" });
    expect(addressDecision(at("/s/kaiza/p/kopp"), single)).toEqual({ rewrite: "/s/kaiza/no/p/kopp" });
    expect(addressDecision(at("/s/kaiza/cart"), single)).toEqual({ rewrite: "/s/kaiza/no/cart" });
    expect(addressDecision(at("/s/kaiza/en/home"), single)).toEqual({ rewrite: "/s/kaiza/no-en/home" });
    expect(addressDecision(at("/s/kaiza/en-eur"), single)).toEqual({ rewrite: "/s/kaiza/no-en-eur" });
    expect(addressDecision(at("/s/kaiza/eur/checkout"), single)).toEqual({ rewrite: "/s/kaiza/no-eur/checkout" });
    expect(addressDecision(at("/", "kaiza"), single)).toEqual({ rewrite: "/no" });
    expect(addressDecision(at("/home", "kaiza"), single)).toEqual({ rewrite: "/no/home" });
    expect(addressDecision(at("/en/home", "kaiza"), single)).toEqual({ rewrite: "/no-en/home" });
    // An old shop's address and a page whose address has a market's shape are its own country's pages.
    expect(addressDecision(at("/collections/shoes", "kaiza"), single)).toEqual({ rewrite: "/no/collections/shoes" });
    expect(addressDecision(at("/s/kaiza/om-oss"), single)).toEqual({ rewrite: "/s/kaiza/no/om-oss" });
    expect(addressDecision(at("/s/kaiza/no-way"), single)).toEqual({ rewrite: "/s/kaiza/no/no-way" });
    expect(addressDecision(at("/s/kaiza/de/x"), single)).toEqual({ rewrite: "/s/kaiza/no/de/x" });
  });

  it("moves its old addresses with the country to the short ones, keeping the rest of the path", () => {
    expect(addressDecision(at("/s/kaiza/no"), single)).toEqual({ redirect: "/s/kaiza" });
    expect(addressDecision(at("/s/kaiza/no/home"), single)).toEqual({ redirect: "/s/kaiza/home" });
    expect(addressDecision(at("/s/kaiza/NO/p/kopp"), single)).toEqual({ redirect: "/s/kaiza/p/kopp" });
    expect(addressDecision(at("/s/kaiza/no-en/home"), single)).toEqual({ redirect: "/s/kaiza/en/home" });
    expect(addressDecision(at("/s/kaiza/no-en-eur/cart"), single)).toEqual({ redirect: "/s/kaiza/en-eur/cart" });
    expect(addressDecision(at("/no", "kaiza"), single)).toEqual({ redirect: "/" });
    expect(addressDecision(at("/no/home", "kaiza"), single)).toEqual({ redirect: "/home" });
  });

  it("leaves another country it had, and a view it keeps but no longer offers, to the route that moves them", () => {
    const kept = shape({ kept: [NO, SE], countries: false, locales: ["nb-NO", "en-GB"], languages: false });
    expect(addressDecision(at("/s/kaiza/se/home"), kept)).toBeNull();
    expect(addressDecision(at("/s/kaiza/no-en/home"), kept)).toBeNull();
    expect(addressDecision(at("/s/kaiza/en/home"), kept)).toEqual({ rewrite: "/s/kaiza/no-en/home" });
  });

  it("serves a store that sells in several countries as it is, and moves a short address back to the long one", () => {
    for (const path of ["/s/demo/no", "/s/demo/no/home", "/s/demo/se-en/p/x", "/s/demo", "/s/demo/dk-en"]) expect(addressDecision(at(path), multi), path).toBeNull();
    expect(addressDecision(at("/s/demo/en/home"), multi)).toEqual({ redirect: "/s/demo/no-en/home" });
    expect(addressDecision(at("/eur/cart", "demo"), multi)).toEqual({ redirect: "/no-eur/cart" });
    expect(addressDecision(at("/s/demo/home"), multi)).toEqual({ marketless: { path: "/home", first: "home" } });
    expect(addressDecision(at("/p/kopp", "demo"), multi)).toEqual({ marketless: { path: "/p/kopp", first: "p" } });
  });

  it("knows no store without a shape, and no request that is not a store's page", () => {
    expect(addressDecision(at("/s/kaiza/home"), null)).toBeNull();
    expect(storePathOf("/home", null)).toBeNull();
    expect(storePathOf("/api/health", "kaiza")).toBeNull();
    expect(storePathOf("/admin/x", "kaiza")).toBeNull();
    expect(storePathOf("/s/Bad_Slug/x", null)).toBeNull();
  });
});

describe("the parts after the market, on any shape of address", () => {
  it("reads the short and the long form alike", () => {
    expect(afterMarket(["p", "x"], single)).toEqual({ market: "no", rest: ["p", "x"] });
    expect(afterMarket(["en", "p", "x"], single)).toEqual({ market: "no-en", rest: ["p", "x"] });
    expect(afterMarket(["no", "p", "x"], single)).toEqual({ market: "no", rest: ["p", "x"] });
    expect(afterMarket([], single)).toEqual({ market: "no", rest: [] });
    expect(afterMarket(["se-en", "cart"], multi)).toEqual({ market: "se-en", rest: ["cart"] });
    expect(afterMarket(["cart"], multi)).toEqual({ market: null, rest: ["cart"] });
  });
});

describe("the proxy's store matcher", () => {
  const matched = (pathname: string): boolean => Boolean(match(STORE_MATCHER.source)(pathname));

  it("runs for every store page, short or long, on Kaizen's address and a store's host", () => {
    for (const path of ["/", "/home", "/en/home", "/eur", "/no", "/no/p/lamp", "/no-en/cart", "/cart", "/s/kaiza", "/s/kaiza/", "/s/kaiza/home", "/s/kaiza/no/p/x", "/collections/shoes", "/pages/page.html", "/old.php", "/om-oss"]) {
      expect(matched(path), path).toBe(true);
    }
  });

  it("leaves Next.js's files, the API, the admin, shared files and static files alone", () => {
    for (const path of ["/_next/static/chunks/a.js", "/_next/image", "/api/health", "/admin/demo/pages", "/demo/x", "/kaizen/favicon.ico", "/favicon.ico", "/robots.txt", "/s/kaiza/store-sitemap.xml", "/s/kaiza/llms.txt", "/images/logo.PNG", "/files/a.pdf"]) {
      expect(matched(path), path).toBe(false);
    }
    for (const ext of STATIC_EXTENSIONS) expect(STORE_MATCHER.source, ext).toContain(ext);
  });

  it("is written out in the proxy, a plain source with no capturing group beyond Next's own", () => {
    expect(readFileSync(join(process.cwd(), "src/proxy.ts"), "utf8")).toContain(JSON.stringify(STORE_MATCHER.source));
    expect(STORE_MATCHER.source.startsWith("/(")).toBe(true);
    expect(/\((?!\?)/.exec(STORE_MATCHER.source.slice(2))).toBeNull();
  });
});

describe("the market's routes", () => {
  it("are the folders of the market route", () => {
    const dir = join(process.cwd(), "src/app/s/[store]/[market]");
    const folders = readdirSync(dir).filter((name) => statSync(join(dir, name)).isDirectory() && /^[a-z]/.test(name));
    expect([...MARKET_ROUTES].sort()).toEqual(folders.sort());
  });
});
