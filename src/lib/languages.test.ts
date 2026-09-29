import { describe, expect, it } from "vitest";

import { defaultLocale, directionOf, isLanguageCode, nativeName, worldLanguage, worldLanguages } from "./languages";

describe("the world's languages", () => {
  it("are listed by name with a main locale", () => {
    const list = worldLanguages();
    expect(list.length).toBeGreaterThan(80);
    expect(list.find((l) => l.lang === "de")).toEqual({ lang: "de", name: "German", locale: "de-DE", direction: "ltr" });
    expect(list.find((l) => l.lang === "ar")?.direction).toBe("rtl");
    expect(new Set(list.map((l) => l.lang)).size).toBe(list.length);
    expect([...list].map((l) => l.name)).toEqual([...list].map((l) => l.name).sort((a, b) => a.localeCompare(b)));
  });

  it("have a main locale from their likeliest region", () => {
    expect(defaultLocale("pl")).toBe("pl-PL");
    expect(defaultLocale("nb")).toBe("nb-NO");
    expect(defaultLocale("ja")).toBe("ja-JP");
  });

  it("recognise a language code, and name a language in itself", () => {
    expect(isLanguageCode("fr")).toBe(true);
    expect(isLanguageCode("xx")).toBe(false);
    expect(isLanguageCode("french")).toBe(false);
    expect(nativeName("de")).toBe("Deutsch");
    expect(directionOf("he")).toBe("rtl");
    expect(worldLanguage("sv").name).toBe("Swedish");
  });
});
