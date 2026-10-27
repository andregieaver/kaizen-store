import type { CheckoutAppearance, CheckoutColours } from "./checkout-appearance";
import { fontCssHref } from "./fonts";
import { BUTTON_RADIUS, FIELD_RADIUS, checkoutButton, isDarkColor, type CheckoutLook, type ThemeSettings } from "./theme";

/**
 * The checkout's look worked out from a theme (D337): what `stripeAppearance()` draws Stripe's form with, and what the checkout section
 * draws around it. Pure; read on the server (the theme module carries zod) and handed to the checkout's client component as plain data.
 */

/** What a theme's checkout look leaves out: the logo in the header only, the form on the page's background, outlined fields. */
export const CHECKOUT_LOOK_DEFAULTS: Required<Pick<CheckoutLook, "mark" | "background" | "fields">> = {
  mark: false,
  background: "page",
  fields: "outlined",
};

/** The checkout look with every choice filled in from the defaults; `button` and `corners` stay absent where they follow the theme. */
export const checkoutLookOf = (settings: ThemeSettings): CheckoutLook & typeof CHECKOUT_LOOK_DEFAULTS => ({
  ...CHECKOUT_LOOK_DEFAULTS,
  ...Object.fromEntries(Object.entries(settings.checkout ?? {}).filter(([, value]) => value !== undefined)),
});

/**
 * The checkout look with a change laid over it, as Design settings' *Checkout look* card saves it into the theme: a choice set to
 * `undefined` is taken out, so it follows the theme again (the pay button's own colour and corners).
 */
export function patchCheckoutLook(current: CheckoutLook | undefined, patch: Partial<CheckoutLook>): CheckoutLook {
  const next: Record<string, unknown> = { ...current, ...patch };
  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
  return next as CheckoutLook;
}

/** Whether the checkout is drawn otherwise than the theme draws it: a background, field style, colour or corners of its own (the logo is not a look). */
export const checkoutLookOwn = (settings: ThemeSettings): boolean => {
  const look = checkoutLookOf(settings);
  return (
    look.background !== CHECKOUT_LOOK_DEFAULTS.background ||
    look.fields !== CHECKOUT_LOOK_DEFAULTS.fields ||
    look.button !== undefined ||
    look.corners !== undefined
  );
};

/** The checkout look drawn as the theme draws it again, its logo choice kept. */
export const followTheme = (current: CheckoutLook | undefined): CheckoutLook =>
  patchCheckoutLook(current, { background: CHECKOUT_LOOK_DEFAULTS.background, fields: CHECKOUT_LOOK_DEFAULTS.fields, button: undefined, corners: undefined });

/** A theme radius (`0`, `0.375rem`, `9999px`) in pixels, as Stripe's variables take it; a rem is 16 pixels. */
export function radiusPx(radius: string): string {
  const rem = /^([\d.]+)rem$/.exec(radius);
  if (rem) return `${Number(rem[1]) * 16}px`;
  return /^[\d.]+px$/.test(radius) ? radius : `${Number(radius) || 0}px`;
}

function colours(settings: ThemeSettings, scheme: "light" | "dark"): CheckoutColours {
  const set = settings[scheme];
  const look = checkoutLookOf(settings);
  const area = look.background === "surface" ? set.surface : set.background;
  // A filled field takes the other of the two, so it stands out from what it sits on; the others are the area's own colour.
  const field = look.fields === "filled" ? (area === set.background ? set.surface : set.background) : area;
  const button = checkoutButton(settings, scheme);
  return {
    area,
    field,
    text: set.text,
    muted: set.muted,
    border: set.border,
    primary: button.fill,
    primaryText: button.text,
    night: isDarkColor(area),
  };
}

/**
 * The checkout's appearance from a theme: both colour sets, the field corners (the theme's fields and menus), the button corners (the
 * checkout's own, else the theme's buttons'), the field style, and the body font. `bodyStack` is the body font's CSS stack (its family
 * and its category's fallbacks, which only the server's catalogue knows), or null for none.
 */
export function checkoutAppearanceFor(settings: ThemeSettings, bodyStack: string | null): CheckoutAppearance {
  const look = checkoutLookOf(settings);
  const body = settings.fonts.body;
  return {
    light: colours(settings, "light"),
    dark: colours(settings, "dark"),
    fieldRadius: radiusPx(FIELD_RADIUS[settings.corners.fields]),
    buttonRadius: radiusPx(BUTTON_RADIUS[look.corners ?? settings.buttons.corners]),
    fields: look.fields,
    font: body && bodyStack ? { stack: bodyStack, css: `${fontCssHref(body)}&for=stripe` } : null,
  };
}
