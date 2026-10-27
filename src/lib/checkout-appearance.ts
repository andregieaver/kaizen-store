import type { Appearance, CssFontSource } from "@stripe/stripe-js";

import type { CheckoutFields } from "./theme";

/**
 * Stripe's payment form in the store's own look (D337, `docs/wave-7-storefront.md` C): what the checkout's client component needs to draw
 * Stripe's Appearance, worked out on the server from the theme by `checkoutAppearanceFor()` (`src/lib/checkout-look.ts`) and passed as plain
 * data. This module is drawn on a pay route, so it imports no zod and nothing of the server (types only from the theme, which are erased):
 * the pay routes' client bundle stays as `docs/pci.md` says.
 */

/** One colour set of the checkout, as `#rrggbb`. */
export type CheckoutColours = {
  /** Behind the form: the page's background, or the surface colour's panel. */
  area: string;
  /** A field's own fill. */
  field: string;
  text: string;
  muted: string;
  border: string;
  /** Stripe's main colour and the pay button's fill. */
  primary: string;
  primaryText: string;
  /** Whether the area is dark: Stripe's `night` theme under the store's colours. */
  night: boolean;
};

export type CheckoutAppearance = {
  light: CheckoutColours;
  dark: CheckoutColours;
  /** Corners in pixels, as Stripe takes them: the fields' from the theme's field corners, the buttons' from the button corners. */
  fieldRadius: string;
  buttonRadius: string;
  fields: CheckoutFields;
  /** The body font, when the theme has one: its CSS stack and our own stylesheet's address (`/api/fonts/css/{slug}`). */
  font: { stack: string; css: string } | null;
};

/** What shows when the theme has no font of its own, or Stripe cannot load the one it has. */
export const SYSTEM_FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** The fields' look as Stripe's rules: a box, a filled box, or a line under the field. */
function fieldRules(look: CheckoutAppearance, set: CheckoutColours): Record<string, Record<string, string>> {
  switch (look.fields) {
    case "filled":
      return { ".Input": { backgroundColor: set.field, borderColor: set.field, boxShadow: "none" } };
    case "underlined":
      return {
        ".Input": {
          backgroundColor: set.field,
          borderStyle: "solid",
          borderWidth: "0px 0px 1px 0px",
          borderColor: set.border,
          borderRadius: "0px",
          boxShadow: "none",
        },
      };
    default:
      return { ".Input": { backgroundColor: set.field, borderColor: set.border } };
  }
}

/**
 * Stripe's Appearance for the colours shown (light or dark, D99): the theme's (or the checkout's own) main colour, text, secondary text,
 * lines and background, the body font and the corners. Pure, so the same theme always draws the same form.
 */
export function stripeAppearance(look: CheckoutAppearance, dark: boolean): Appearance {
  const set = dark ? look.dark : look.light;
  return {
    theme: set.night ? "night" : "stripe",
    variables: {
      colorPrimary: set.primary,
      accessibleColorOnColorPrimary: set.primaryText,
      colorBackground: set.field,
      colorText: set.text,
      colorTextSecondary: set.muted,
      colorTextPlaceholder: set.muted,
      colorDanger: set.night ? "#f87171" : "#b91c1c",
      inputColorBorder: set.border,
      fontFamily: look.font?.stack ?? SYSTEM_FONT,
      fontSizeBase: "16px",
      borderRadius: look.fieldRadius,
      buttonBorderRadius: look.buttonRadius,
      buttonExpressCheckoutBorderRadius: look.buttonRadius,
    },
    rules: fieldRules(look, set),
  };
}

/**
 * The body font for Stripe's frames: our own stylesheet (`/api/fonts/css/{slug}`: `@font-face` rules pointing at our own files), as an
 * absolute address on the page's own origin, so the pay routes' policy needs no new origin (`connect-src`, `style-src` and `font-src` are
 * `'self'` for us; Stripe's frames are under Stripe's own policy). The stylesheet and the files are served with
 * `Access-Control-Allow-Origin: *`, so they load whether Stripe reads them from the page or from its frames (the address carries
 * `for=stripe`, so no copy a cache kept from before that header is used). If Stripe cannot load them anyway, the stack's system fonts
 * show: the form never waits for a font.
 */
export function stripeFonts(look: CheckoutAppearance, origin: string): CssFontSource[] {
  if (!look.font) return [];
  try {
    return [{ cssSrc: new URL(look.font.css, origin).href }];
  } catch {
    return [];
  }
}
