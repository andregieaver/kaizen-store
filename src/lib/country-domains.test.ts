import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { domainCountries } from "./custom-domains";
import { localizationOf } from "./localization";
import { toMarket } from "./markets";
import { marketHost, marketLink, marketMetaPath, marketPath, marketUrl, withoutCountry } from "./paths";
import { countryHostDecision, storeAddressOf, storePathOf, type CountryHostFacts, type StoreAddress } from "./store-address";
import { storeHostRoutes } from "./store-hosts";

/** A country's own domain (D338, `docs/wave-7-storefront.md` D2): requests both ways, links, routing and the countries offered. */

const NO = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const SE = toMarket({ code: "SE", currency: "SEK", defaultLocale: "sv-SE" });
const DK = toMarket({ code: "DK", currency: "DKK", defaultLocale: "da-DK" });
const EUR = { currency: "EUR", rate: 1, roundTo: 1 };
const NOK = { currency: "NOK", rate: 11.6, roundTo: 100 };

function shape(countries: (typeof NO)[], locales: string[]): StoreAddress {
  const localization = localizationOf(locales, [NOK, EUR], countries, { kept: countries, languages: true, currencies: true });
  return storeAddressOf({ markets: countries, keptMarkets: countries, allMarkets: countries, localization })!;
}

/** Norway (its address `nordic.com`), Sweden on `nordic.se`, Denmark on the store's address; Norwegian, Swedish, Danish and English. */
const nordic = shape([NO, SE, DK], ["nb-NO", "sv-SE", "da-DK", "en"]);
const onSe: CountryHostFacts = { here: "se", origins: { se: "https://nordic.se" }, primary: "https://nordic.com" };
const onPrimary: CountryHostFacts = { ...onSe, here: null };
const at = (path: string) => storePathOf(path, "nordic")!;

describe("requests on a country's own domain (D338)", () => {
  it("serves that country without its code: its front page, pages and views", () => {
    expect(countryHostDecision(at("/"), nordic, onSe)).toEqual({ rewrite: "/se" });
    expect(countryHostDecision(at("/p/cup"), nordic, onSe)).toEqual({ rewrite: "/se/p/cup" });
    expect(countryHostDecision(at("/en/p/cup"), nordic, onSe)).toEqual({ rewrite: "/se-en/p/cup" });
    expect(countryHostDecision(at("/eur/cart"), nordic, onSe)).toEqual({ rewrite: "/se-eur/cart" });
    expect(countryHostDecision(at("/en-eur/x"), nordic, onSe)).toEqual({ rewrite: "/se-en-eur/x" });
    // Norwegian is one of the store's languages: Sweden in Norwegian.
    expect(countryHostDecision(at("/nb/x"), nordic, onSe)).toEqual({ rewrite: "/se-nb/x" });
  });

  it("moves an address that names the country, or its own language, to the short one", () => {
    expect(countryHostDecision(at("/se/p/cup"), nordic, onSe)).toEqual({ redirect: "/p/cup" });
    expect(countryHostDecision(at("/se-en/x"), nordic, onSe)).toEqual({ redirect: "/en/x" });
    expect(countryHostDecision(at("/sv/x"), nordic, onSe)).toEqual({ redirect: "/x" });
  });

  it("moves another country to its own address", () => {
    expect(countryHostDecision(at("/no/x"), nordic, onSe)).toEqual({ redirect: "https://nordic.com/no/x" });
    expect(countryHostDecision(at("/dk-en/x"), nordic, onSe)).toEqual({ redirect: "https://nordic.com/dk-en/x" });
  });

  it("moves the country from the store's address to its domain, and leaves the others to the usual rules", () => {
    expect(countryHostDecision(at("/se/p/cup"), nordic, onPrimary)).toEqual({ redirect: "https://nordic.se/p/cup" });
    expect(countryHostDecision(at("/se"), nordic, onPrimary)).toEqual({ redirect: "https://nordic.se/" });
    expect(countryHostDecision(at("/se-en/x"), nordic, onPrimary)).toEqual({ redirect: "https://nordic.se/en/x" });
    expect(countryHostDecision(at("/no/x"), nordic, onPrimary)).toBeUndefined();
    expect(countryHostDecision(at("/collections/x"), nordic, onPrimary)).toBeUndefined();
  });

  it("does nothing for a store without country domains, or on Kaizena Flow's own address", () => {
    expect(countryHostDecision(at("/se/x"), nordic, { here: null, origins: {}, primary: "https://nordic.com" })).toBeUndefined();
    expect(countryHostDecision(storePathOf("/s/nordic/se/x", null)!, nordic, onPrimary)).toBeUndefined();
  });
});

describe("links to a country's own domain (D338)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_STORE_DOMAIN", "kaizenstore.site");
    vi.stubEnv("NEXT_PUBLIC_STORE_HOSTS", JSON.stringify({ nordic: { primary: "nordic.com", hosts: ["nordic.com", "nordic.se"], countries: { se: "nordic.se" } } }));
  });
  afterEach(() => vi.unstubAllEnvs());

  it("writes a market on its country's domain without the country", () => {
    expect(withoutCountry("se-en-eur")).toBe("en-eur");
    expect(withoutCountry("se")).toBe("");
    expect(marketHost("nordic", "se-en", nordic)).toBe("nordic.se");
    expect(marketHost("nordic", "no", nordic)).toBeNull();
    expect(marketPath("nordic", "se", "/cart", nordic)).toBe("/cart");
    expect(marketPath("nordic", "se-en", "/cart", nordic)).toBe("/en/cart");
    expect(marketPath("nordic", "no", "/cart", nordic)).toBe("/no/cart");
  });

  it("makes full addresses on the market's own origin, also in a page's metadata", () => {
    expect(marketUrl("nordic", "se", "/p/cup", nordic)).toBe("https://nordic.se/p/cup");
    expect(marketUrl("nordic", "dk", "/p/cup", nordic)).toBe("https://nordic.com/dk/p/cup");
    expect(marketMetaPath("nordic", "se-en", "/p/cup", nordic)).toBe("https://nordic.se/en/p/cup");
  });

  it("links across origins with full addresses, within one with paths", () => {
    expect(marketLink("nordic", "no", "se", "", nordic)).toBe("https://nordic.se");
    expect(marketLink("nordic", "se", "se-en", "", nordic)).toBe("/en");
    expect(marketLink("nordic", "se", "dk", "/x", nordic)).toBe("https://nordic.com/dk/x");
  });

  it("routes a country's domain as the store's address, never moving it there", () => {
    const { redirects, rewrites } = storeHostRoutes("kaizenstore.site", "https://kaizenaflow.com", {
      nordic: { primary: "nordic.com", hosts: ["nordic.com", "nordic.se", "old-nordic.com"], countries: { se: "nordic.se" } },
    });
    const moved = redirects.flatMap((r) => r.has?.map((h) => h.value) ?? []);
    expect(moved).toContain("old-nordic\\.com");
    expect(moved).not.toContain("nordic\\.se");
    expect(rewrites.flatMap((r) => r.has.map((h) => h.value))).toContain("nordic\\.se");
  });
});

describe("the countries a domain may be for (D338)", () => {
  it("are the store's kept countries but its own, and none for a store in one country", () => {
    expect(domainCountries({ markets: [NO, SE], keptMarkets: [NO, SE, DK] }).map((c) => c.code)).toEqual(["SE", "DK"]);
    expect(domainCountries({ markets: [NO, SE], keptMarkets: [NO, SE] }, "nb-NO")[0].name).toBe("Sverige");
    expect(domainCountries({ markets: [NO], keptMarkets: [NO] })).toEqual([]);
  });
});
