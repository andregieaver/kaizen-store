import { describe, expect, it } from "vitest";

import { ADMIN_LANG_KEY, adminLangOf, adminLangScript, browserAdminLang, storedAdminLocale } from "./admin-lang";
import { adminText, adminTexts } from "./admin-text";

describe("the admin's language (D312 A0)", () => {
  it("is what the account keeps, English for none or one no longer offered", () => {
    expect(adminLangOf("nb-NO")).toBe("nb");
    expect(adminLangOf("en")).toBe("en");
    expect(adminLangOf(null)).toBe("en");
    expect(adminLangOf("sv-SE")).toBe("en");
    expect(storedAdminLocale("nb")).toBe("nb-NO");
  });

  it("starts as the first language the browser asks for that the admin has", () => {
    expect(browserAdminLang("nb-NO,nb;q=0.9,en;q=0.8")).toBe("nb");
    expect(browserAdminLang("no")).toBe("nb");
    expect(browserAdminLang("nn-NO")).toBe("nb");
    expect(browserAdminLang("en-US,nb;q=0.5")).toBe("en");
    // By weight, not by place.
    expect(browserAdminLang("en;q=0.3,nb;q=0.9")).toBe("nb");
    expect(browserAdminLang("de-DE,fr;q=0.8")).toBe("en");
    expect(browserAdminLang(null)).toBe("en");
  });

  it("is put on <html lang> before paint from the browser's copy", () => {
    const script = adminLangScript();
    expect(script).toContain(ADMIN_LANG_KEY);
    const html = { lang: "en" };
    new Function("localStorage", "document", script)({ getItem: () => "nb" }, { documentElement: html });
    expect(html.lang).toBe("nb");
  });

  it("has every area's words in every language", () => {
    expect(adminText("nb", "common").accountMenu.yourAccount).toBe("Din konto");
    expect(adminText("en", "common").accountMenu.yourAccount).toBe("Your account");
    expect(Object.keys(adminTexts("nb", ["common"]))).toEqual(["common"]);
  });
});

describe("the catalogues' placeholders (D312 A1)", () => {
  const leaves = (value: unknown, path = ""): [string, string][] =>
    typeof value === "string" ? [[path, value]] : Object.entries(value as object).flatMap(([key, inner]) => leaves(inner, `${path}.${key}`));
  const names = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  it("names the same placeholders in Norwegian as in English, so fillWords() fills them all", () => {
    for (const area of ["common", "domains", "signIn"] as const) {
      const nb = new Map(leaves(adminText("nb", area)));
      for (const [path, en] of leaves(adminText("en", area))) expect(names(nb.get(path) ?? ""), `${area}${path}`).toEqual(names(en));
    }
  });

  it("fills them and leaves an unknown one as written", async () => {
    const { fillWords } = await import("./admin-fill");
    expect(fillWords("{app} as {email} {other}", { app: "Kaizen Life", email: "a@b.no" })).toBe("Kaizen Life as a@b.no {other}");
  });
});
