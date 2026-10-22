import { describe, expect, it } from "vitest";

import { RESERVED_PAGE_SLUGS } from "./page-content";
import { englishPath, LANGUAGE_PREFIXES, langOfLocale, langOfPath, languageAlternates, platformPath, suggestedLang } from "./platform-lang";

describe("the site's languages (D312 P1)", () => {
  it("puts a language's prefix before the site's own addresses and leaves English as it is", () => {
    expect(platformPath("en", "/themes")).toBe("/themes");
    expect(platformPath("nb", "/")).toBe("/no");
    expect(platformPath("nb", "/themes")).toBe("/no/themes");
    expect(platformPath("nb", "/sign-up?theme=orbit#form")).toBe("/no/sign-up?theme=orbit#form");
    expect(platformPath("nb", "/?x=1")).toBe("/no?x=1");
    expect(platformPath("nb", "/no/themes")).toBe("/no/themes");
  });

  it("leaves what is not one of the site's pages as written", () => {
    for (const path of ["/s/demo", "/admin", "/admin/sign-in", "/api/consent", "/auth/callback", "/r/abc", "/robots.txt", "/og.png", "https://example.com/", "mailto:a@b.no", "#main", "//cdn.example/x"]) {
      expect([path, platformPath("nb", path)]).toEqual([path, path]);
    }
  });

  it("reads the language of an address and its English address", () => {
    expect(langOfPath("/no")).toBe("nb");
    expect(langOfPath("/no/themes/orbit")).toBe("nb");
    expect(langOfPath("/themes")).toBeNull();
    expect(langOfPath("/en/themes")).toBeNull();
    // The language's tag is no address: Norwegian lives at /no, so /nb is just a path.
    expect(langOfPath("/nb/themes")).toBeNull();
    expect(englishPath("/no")).toBe("/");
    expect(englishPath("/no/themes/orbit")).toBe("/themes/orbit");
    expect(englishPath("/themes")).toBe("/themes");
    expect(langOfLocale("nb-NO")).toBe("nb");
    expect(langOfLocale("en-GB")).toBe("en");
    expect(langOfLocale("sv-SE")).toBeNull();
  });

  it("names each language's address of a page, and nothing while English is the only one", () => {
    expect(languageAlternates("/themes", [])).toBeUndefined();
    expect(languageAlternates("/themes", ["en"])).toBeUndefined();
    expect(languageAlternates("/themes", ["en", "nb"])).toEqual({ en: "/themes", nb: "/no/themes", "x-default": "/themes" });
    expect(languageAlternates("/", ["nb"])).toEqual({ en: "/", nb: "/no", "x-default": "/" });
  });

  it("suggests the browser's first language the site offers, never the page's own", () => {
    expect(suggestedLang(["nb-NO", "en"], "en", ["nb"])).toBe("nb");
    expect(suggestedLang(["no"], "en", ["nb"])).toBe("nb");
    expect(suggestedLang(["nn-NO"], "en", ["nb"])).toBe("nb");
    expect(suggestedLang(["en-GB", "nb"], "en", ["nb"])).toBeNull();
    expect(suggestedLang(["de-DE", "nb"], "en", ["nb"])).toBe("nb");
    expect(suggestedLang(["nb-NO"], "en", [])).toBeNull();
    expect(suggestedLang(["en-US"], "nb", ["nb"])).toBe("en");
    expect(suggestedLang(["fr"], "en", ["nb"])).toBeNull();
  });

  it("keeps every language prefix from being a page's address", () => {
    for (const prefix of LANGUAGE_PREFIXES) expect(RESERVED_PAGE_SLUGS).toContain(prefix);
  });
});

describe("offering the site in a language (D312)", () => {
  it("keeps English first in the settings and the others in the site's order", async () => {
    const { localesFor } = await import("./platform-lang");
    expect(localesFor([])).toEqual(["en-GB"]);
    expect(localesFor(["nb", "en"])).toEqual(["en-GB", "nb-NO"]);
  });
});
