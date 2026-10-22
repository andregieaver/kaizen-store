import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { domainLanguages } from "./custom-domains";
import { localizationOf } from "./localization";
import { toMarket } from "./markets";
import { marketHost, marketLink, marketPath, marketUrl, withoutLanguage } from "./paths";
import { languageHostDecision, storeAddressOf, storePathOf, type LanguageHostFacts, type StoreAddress } from "./store-address";
import { storeHostRoutes } from "./store-hosts";

/** A language's own domain (D313, `docs/language-domains.md`). */

const NO = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const SE = toMarket({ code: "SE", currency: "SEK", defaultLocale: "sv-SE" });
const EUR = { currency: "EUR", rate: 1, roundTo: 1 };
const NOK = { currency: "NOK", rate: 11.6, roundTo: 100 };

function shape(countries: (typeof NO)[], locales: string[]): StoreAddress {
  const localization = localizationOf(locales, [NOK, EUR], countries, { kept: countries, languages: true, currencies: true });
  return storeAddressOf({ markets: countries, keptMarkets: countries, allMarkets: countries, localization })!;
}

/** One country (Norway), Norwegian with English on `nordic-en.com`. */
const single = shape([NO], ["nb-NO", "en"]);
/** Norway and Sweden, with Swedish on `nordic.se`. */
const several = shape([NO, SE], ["nb-NO", "sv-SE", "en"]);

const enHost: LanguageHostFacts = { here: "en", origins: { en: "https://nordic-en.com" }, primary: "https://nordic.com" };
const onPrimary: LanguageHostFacts = { ...enHost, here: null };
const at = (path: string) => storePathOf(path, "nordic")!;

describe("requests on a language's own domain (D313)", () => {
  it("serves the store's own country in the domain's language, its addresses without the language", () => {
    expect(languageHostDecision(at("/"), single, enHost)).toEqual({ rewrite: "/no-en" });
    expect(languageHostDecision(at("/home"), single, enHost)).toEqual({ rewrite: "/no-en/home" });
    expect(languageHostDecision(at("/p/cup"), single, enHost)).toEqual({ rewrite: "/no-en/p/cup" });
    expect(languageHostDecision(at("/eur/home"), single, enHost)).toEqual({ rewrite: "/no-en-eur/home" });
  });

  it("moves an address that names the domain's own language, or the long form, to the short one", () => {
    expect(languageHostDecision(at("/en/home"), single, enHost)).toEqual({ redirect: "/home" });
    expect(languageHostDecision(at("/no-en/home"), single, enHost)).toEqual({ redirect: "/home" });
    expect(languageHostDecision(at("/en-eur/x"), single, enHost)).toEqual({ redirect: "/eur/x" });
  });

  it("moves the store's address's language there, and the domain's language from the store's address here", () => {
    expect(languageHostDecision(at("/en/home"), single, onPrimary)).toEqual({ redirect: "https://nordic-en.com/home" });
    expect(languageHostDecision(at("/en-eur/home"), single, onPrimary)).toEqual({ redirect: "https://nordic-en.com/eur/home" });
    // Norwegian has no domain of its own on the store's address: the usual rules decide there.
    expect(languageHostDecision(at("/home"), single, onPrimary)).toBeUndefined();
    expect(languageHostDecision(at("/no/home"), single, onPrimary)).toBeUndefined();
  });

  it("reads a country without a language as the domain's language, for a store that sells in several", () => {
    const svHost: LanguageHostFacts = { here: "sv", origins: { sv: "https://nordic.se" }, primary: "https://nordic.com" };
    // Sweden in Swedish is its own view: `se` as it is.
    expect(languageHostDecision(at("/se/x"), several, svHost)).toEqual({ rewrite: "/se/x" });
    // Norway in Swedish.
    expect(languageHostDecision(at("/no/x"), several, svHost)).toEqual({ rewrite: "/no-sv/x" });
    expect(languageHostDecision(at("/no-sv/x"), several, svHost)).toEqual({ redirect: "/no/x" });
    // English is on the store's address.
    expect(languageHostDecision(at("/no-en/x"), several, svHost)).toEqual({ redirect: "https://nordic.com/no-en/x" });
    // On the store's address, Sweden in its own language moves to the Swedish domain.
    expect(languageHostDecision(at("/se/x"), several, { ...svHost, here: null })).toEqual({ redirect: "https://nordic.se/se/x" });
    // An address with no country is the usual rules'.
    expect(languageHostDecision(at("/collections/x"), several, svHost)).toBeUndefined();
  });

  it("does nothing for a store without language domains, or on Kaizena Flow's own address", () => {
    expect(languageHostDecision(at("/en/home"), single, { here: null, origins: {}, primary: "https://nordic.com" })).toBeUndefined();
    expect(languageHostDecision(storePathOf("/s/nordic/en/home", null)!, single, onPrimary)).toBeUndefined();
  });
});

describe("links to a language's own domain (D313)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_STORE_DOMAIN", "kaizenstore.site");
    vi.stubEnv(
      "NEXT_PUBLIC_STORE_HOSTS",
      JSON.stringify({ nordic: { primary: "nordic.com", hosts: ["nordic.com", "nordic-en.com"], languages: { en: "nordic-en.com" } } }),
    );
  });
  afterEach(() => vi.unstubAllEnvs());

  it("writes a market on its language's domain without the language", () => {
    expect(withoutLanguage("no-en-eur", "en")).toBe("no-eur");
    expect(marketHost("nordic", "no-en", single)).toBe("nordic-en.com");
    expect(marketHost("nordic", "no", single)).toBeNull();
    expect(marketPath("nordic", "no-en", "/home", single)).toBe("/home");
    expect(marketPath("nordic", "no-en-eur", "/home", single)).toBe("/eur/home");
    expect(marketPath("nordic", "no", "/home", single)).toBe("/home");
  });

  it("makes full addresses on the market's own origin", () => {
    expect(marketUrl("nordic", "no-en", "/home", single)).toBe("https://nordic-en.com/home");
    expect(marketUrl("nordic", "no", "/cart", single)).toBe("https://nordic.com/cart");
    expect(marketUrl("nordic", "no-en", "", single)).toBe("https://nordic-en.com");
  });

  it("links across origins with full addresses, within one with paths", () => {
    expect(marketLink("nordic", "no", "no-en", "", single)).toBe("https://nordic-en.com");
    expect(marketLink("nordic", "no-en", "no", "", single)).toBe("https://nordic.com");
    expect(marketLink("nordic", "no-en", "no-en-eur", "", single)).toBe("/eur");
    expect(marketLink("nordic", "no", "no-eur", "", single)).toBe("/eur");
  });

  it("routes a language's domain as the store's address, never moving it there", () => {
    const { redirects, rewrites } = storeHostRoutes("kaizenstore.site", "https://kaizenaflow.com", {
      nordic: { primary: "nordic.com", hosts: ["nordic.com", "nordic-en.com", "old-nordic.com"], languages: { en: "nordic-en.com" } },
    });
    const moved = redirects.flatMap((r) => r.has?.map((h) => h.value) ?? []);
    expect(moved).toContain("old-nordic\\.com");
    expect(moved).not.toContain("nordic-en\\.com");
    const served = rewrites.flatMap((r) => r.has.map((h) => h.value));
    expect(served).toContain("nordic-en\\.com");
  });
});

describe("the languages a domain may be for (D313)", () => {
  it("are the store's kept languages but its own country's own", () => {
    const store = { markets: [NO], localization: { keptLocales: ["nb-NO", "en", "de-DE"] } };
    expect(domainLanguages(store).map((l) => l.lang)).toEqual(["en", "de"]);
    expect(domainLanguages(store, "nb-NO").find((l) => l.lang === "en")?.name.toLowerCase()).toBe("engelsk");
  });
});
