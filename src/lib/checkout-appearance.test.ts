import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SYSTEM_FONT, stripeAppearance, stripeFonts } from "./checkout-appearance";
import { CHECKOUT_LOOK_DEFAULTS, checkoutAppearanceFor, checkoutLookOf, checkoutLookOwn, followTheme, patchCheckoutLook, radiusPx } from "./checkout-look";
import { parseStoreTheme, templateSettings, themeCss, themeSettingsSchema, type ThemeSettings } from "./theme";

/** Stripe's payment form in the store's look (D337, `docs/wave-7-storefront.md` C): two themes, light and dark, corners and font. */
describe("Stripe's appearance from the theme (D337)", () => {
  const minimal = templateSettings("minimal");
  const warm = templateSettings("warm");

  it("takes Minimal's colours in light and in dark, with the system font", () => {
    const look = checkoutAppearanceFor(minimal, null);
    const light = stripeAppearance(look, false);
    const dark = stripeAppearance(look, true);
    expect(light.theme).toBe("stripe");
    expect(light.variables).toMatchObject({
      colorPrimary: "#171717",
      accessibleColorOnColorPrimary: "#ffffff",
      colorBackground: "#ffffff",
      colorText: "#171717",
      colorTextSecondary: "#525252",
      inputColorBorder: "#e5e5e5",
      fontFamily: SYSTEM_FONT,
    });
    expect(dark.theme).toBe("night");
    expect(dark.variables).toMatchObject({
      colorPrimary: "#ededed",
      accessibleColorOnColorPrimary: "#0a0a0a",
      colorBackground: "#0a0a0a",
      colorText: "#ededed",
      colorTextSecondary: "#a3a3a3",
      inputColorBorder: "#2e2e2e",
    });
    // Pill buttons, small field corners: the fields' corners are the theme's fields', the buttons' its buttons'.
    expect(light.variables).toMatchObject({ borderRadius: "6px", buttonBorderRadius: "9999px", buttonExpressCheckoutBorderRadius: "9999px" });
    expect(stripeFonts(look, "https://shop.example")).toEqual([]);
  });

  it("takes Warm classic's terracotta, cream, Lora and rounded corners, and its own dark colours", () => {
    const look = checkoutAppearanceFor(warm, '"Lora", ui-serif, Georgia, Cambria, "Times New Roman", serif');
    const light = stripeAppearance(look, false);
    const dark = stripeAppearance(look, true);
    expect(light.theme).toBe("stripe");
    expect(light.variables).toMatchObject({
      colorPrimary: "#a84a26",
      accessibleColorOnColorPrimary: "#fffaf3",
      colorBackground: "#faf6ef",
      colorText: "#2b2118",
      colorTextSecondary: "#6b5a4a",
      inputColorBorder: "#e2d5c1",
      fontFamily: '"Lora", ui-serif, Georgia, Cambria, "Times New Roman", serif',
      borderRadius: "6px",
      buttonBorderRadius: "6px",
    });
    expect(dark.theme).toBe("night");
    expect(dark.variables).toMatchObject({ colorPrimary: "#e58a5f", colorBackground: "#1c1612", colorText: "#f3eadf", inputColorBorder: "#43362c" });
    // Our own stylesheet, on the page's own origin: no other site's address.
    expect(stripeFonts(look, "https://shop.example")).toEqual([{ cssSrc: "https://shop.example/api/fonts/css/lora?v=1&for=stripe" }]);
  });

  it("differs between the two themes in every part the theme decides", () => {
    const a = stripeAppearance(checkoutAppearanceFor(minimal, null), false).variables!;
    const b = stripeAppearance(checkoutAppearanceFor(warm, '"Lora", serif'), false).variables!;
    for (const key of ["colorPrimary", "colorBackground", "colorText", "colorTextSecondary", "inputColorBorder", "fontFamily", "buttonBorderRadius"] as const) {
      expect(a[key], key).not.toBe(b[key]);
    }
  });

  it("takes Bold modern's square corners for fields and buttons", () => {
    const look = checkoutAppearanceFor(templateSettings("bold"), null);
    expect(stripeAppearance(look, false).variables).toMatchObject({ borderRadius: "0px", buttonBorderRadius: "0px" });
  });

  it("uses the checkout's own pay button colour and corners, with readable text on it", () => {
    const settings: ThemeSettings = { ...minimal, checkout: { button: { light: "#1d4ed8", dark: "#fde047" }, corners: "rounded" } };
    const look = checkoutAppearanceFor(settings, null);
    expect(stripeAppearance(look, false).variables).toMatchObject({ colorPrimary: "#1d4ed8", accessibleColorOnColorPrimary: "#ffffff", buttonBorderRadius: "6px" });
    expect(stripeAppearance(look, true).variables).toMatchObject({ colorPrimary: "#fde047", accessibleColorOnColorPrimary: "#0a0a0a" });
    // The storefront's own pay button reads the same colours through `.checkout-look` (globals.css).
    const css = themeCss(settings, "html");
    expect(css).toContain("--checkout-accent: #1d4ed8; --checkout-accent-foreground: #ffffff");
    expect(css).toContain("--checkout-accent: #fde047; --checkout-accent-foreground: #0a0a0a");
    expect(css).toContain("--checkout-button-radius: 0.375rem");
    expect(readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8")).toMatch(/\.checkout-look \{\s*--accent: var\(--checkout-accent\);/);
  });

  it("follows the accent and the theme's button corners when the checkout sets none", () => {
    const css = themeCss(minimal, "html");
    expect(css).toContain("--checkout-accent: #171717; --checkout-accent-foreground: #ffffff");
    expect(css).toContain("--checkout-button-radius: 9999px");
  });

  it("draws the field styles and the surface panel", () => {
    const panel = checkoutAppearanceFor({ ...warm, checkout: { background: "surface", fields: "filled" } }, null);
    // On the surface colour's panel a filled field takes the page's background.
    expect(panel.light).toMatchObject({ area: "#f1e8da", field: "#faf6ef" });
    expect(stripeAppearance(panel, false).rules![".Input"]).toMatchObject({ backgroundColor: "#faf6ef", borderColor: "#faf6ef" });
    const under = checkoutAppearanceFor({ ...minimal, checkout: { fields: "underlined" } }, null);
    expect(stripeAppearance(under, false).rules![".Input"]).toMatchObject({ borderWidth: "0px 0px 1px 0px", borderRadius: "0px", borderColor: "#e5e5e5" });
    expect(stripeAppearance(checkoutAppearanceFor(minimal, null), true).rules![".Input"]).toEqual({ backgroundColor: "#0a0a0a", borderColor: "#2e2e2e" });
  });

  it("writes radii in pixels, as Stripe takes them", () => {
    expect(radiusPx("0")).toBe("0px");
    expect(radiusPx("0.375rem")).toBe("6px");
    expect(radiusPx("0.75rem")).toBe("12px");
    expect(radiusPx("9999px")).toBe("9999px");
  });
});

describe("the checkout look in the theme's settings (D337)", () => {
  it("is in every template and parses as it is", () => {
    for (const key of ["minimal", "warm", "bold"] as const) {
      const settings = templateSettings(key);
      expect(settings.checkout).toEqual(CHECKOUT_LOOK_DEFAULTS);
      expect(themeSettingsSchema.parse(settings).checkout).toEqual(CHECKOUT_LOOK_DEFAULTS);
    }
  });

  it("is filled in from the template for a theme stored before it existed", () => {
    const stored = { base: "warm", savedId: null, settings: { ...templateSettings("warm"), checkout: undefined } };
    expect(parseStoreTheme(JSON.parse(JSON.stringify(stored))).settings.checkout).toEqual(CHECKOUT_LOOK_DEFAULTS);
  });

  it("refuses a colour that is not #rrggbb and corners that are not the theme's", () => {
    const base = templateSettings("minimal");
    expect(themeSettingsSchema.safeParse({ ...base, checkout: { button: { light: "red", dark: "#000000" } } }).success).toBe(false);
    expect(themeSettingsSchema.safeParse({ ...base, checkout: { corners: "round" } }).success).toBe(false);
    expect(themeSettingsSchema.safeParse({ ...base, checkout: { button: { light: "#AABBCC", dark: "#000000" } } }).data?.checkout?.button?.light).toBe("#aabbcc");
  });

  it("is saved by the card as the choices laid over, and taken back to the theme with the logo kept", () => {
    const start = patchCheckoutLook(CHECKOUT_LOOK_DEFAULTS, { mark: true, background: "surface", button: { light: "#1d4ed8", dark: "#93c5fd" }, corners: "square" });
    expect(start).toEqual({ mark: true, background: "surface", fields: "outlined", button: { light: "#1d4ed8", dark: "#93c5fd" }, corners: "square" });
    expect(patchCheckoutLook(start, { button: undefined, corners: undefined })).toEqual({ mark: true, background: "surface", fields: "outlined" });
    const settings = { ...templateSettings("minimal"), checkout: start };
    expect(checkoutLookOwn(settings)).toBe(true);
    const back = followTheme(start);
    expect(back).toEqual({ mark: true, background: "page", fields: "outlined" });
    expect(checkoutLookOwn({ ...settings, checkout: back })).toBe(false);
    expect(checkoutLookOf({ ...settings, checkout: back }).mark).toBe(true);
    // What the card saves passes the theme's schema.
    expect(themeSettingsSchema.safeParse(settings).success).toBe(true);
  });
});
