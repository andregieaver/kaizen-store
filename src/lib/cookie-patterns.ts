import type { ConsentCategory } from "./cookie-consent";

/**
 * Every cookie Kaizen knows by its name: the pattern that matches its real name and its category, and nothing else. The consent manager
 * reads this to forget a withdrawn category's cookies (D58), so it lives apart from the purposes, providers and days
 * (`known-cookies.ts`, read by the server and the cookie page), which a visitor's scripts do not need.
 */
export const COOKIE_PATTERNS = [
  {
    name: "color_mode_…",
    pattern: /^color_mode_[0-9a-f-]{36}$/,
    category: "necessary",
  },
  {
    name: "kaizen_lang_…",
    pattern: /^kaizen_lang_[0-9a-f-]{36}$/,
    category: "necessary",
  },
  {
    name: "kaizen_admin_color_mode",
    pattern: /^kaizen_admin_color_mode$/,
    category: "necessary",
  },
  {
    name: "kaizen_admin_scheme",
    pattern: /^kaizen_admin_scheme$/,
    category: "necessary",
  },
  {
    name: "kaizen_admin_lang",
    pattern: /^kaizen_admin_lang$/,
    category: "necessary",
  },
  {
    name: "kaizen-admin-shell-…",
    pattern: /^kaizen-admin-shell-\d+$/,
    category: "necessary",
  },
  {
    name: "kaizen_admin_rail",
    pattern: /^kaizen_admin_rail$/,
    category: "necessary",
  },
  {
    name: "kaizen_admin_builder_…",
    pattern: /^kaizen_admin_builder_((left|right)(_width)?|css_width)$/,
    category: "necessary",
  },
  {
    name: "kaizen_site_css_panel",
    pattern: /^kaizen_site_css_panel$/,
    category: "necessary",
  },
  {
    name: "kaizen_chat",
    pattern: /^kaizen_chat$/,
    category: "necessary",
  },
  {
    name: "kaizen_rec",
    pattern: /^kaizen_rec$/,
    category: "necessary",
  },
  {
    name: "kaizen_touch_…",
    pattern: /^kaizen_touch_[0-9a-f-]{36}$/,
    category: "statistics",
  },
  {
    name: "kaizen_ab_…",
    pattern: /^kaizen_ab(_[0-9a-f-]{36}|_reload)?$/,
    category: "statistics",
  },
  {
    name: "kaizen_modal_…",
    pattern: /^kaizen_modal_[a-z0-9-]+$/,
    category: "preferences",
  },
  {
    name: "kaizen_lang_hint",
    pattern: /^kaizen_lang_hint$/,
    category: "preferences",
  },
  {
    name: "kaizen_ref",
    pattern: /^kaizen_ref$/,
    category: "marketing",
  },
  {
    name: "kaizen_aff_…",
    pattern: /^kaizen_aff_[0-9a-f-]{36}$/,
    category: "marketing",
  },
  {
    name: "cart_…",
    pattern: /^cart_[0-9a-f-]{36}_[a-z]{2}$/,
    category: "necessary",
  },
  {
    name: "account_…",
    pattern: /^account_[0-9a-f-]{36}$/,
    category: "necessary",
  },
  {
    name: "wishlist_…",
    pattern: /^wishlist_[0-9a-f-]{36}$/,
    category: "necessary",
  },
  {
    name: "kaizen_mine_…",
    pattern: /^kaizen_mine_[0-9a-f-]{36}$/,
    category: "necessary",
  },
  {
    name: "buyer_…",
    pattern: /^buyer_[0-9a-f-]{36}$/,
    category: "necessary",
  },
  {
    name: "consent_…",
    pattern: /^consent_([0-9a-f-]{36}|kaizen)$/,
    category: "necessary",
  },
  {
    name: "sb-…-auth-token",
    pattern: /^sb-[a-z0-9]+-auth-token(\.\d+)?$/,
    category: "necessary",
  },
  {
    name: "kaizen_life_link",
    pattern: /^kaizen_life_link$/,
    category: "necessary",
  },
  {
    name: "kaizen_slack_connect",
    pattern: /^kaizen_slack_connect$/,
    category: "necessary",
  },
  {
    name: "kaizen_google",
    pattern: /^kaizen_google$/,
    category: "necessary",
  },
  {
    name: "kaizen_mollie_connect",
    pattern: /^kaizen_mollie_connect$/,
    category: "necessary",
  },
  {
    name: "kaizen_sandbox",
    pattern: /^kaizen_sandbox$/,
    category: "necessary",
  },
  {
    name: "kaizen_edit",
    pattern: /^kaizen_edit$/,
    category: "necessary",
  },
  {
    name: "kaizen_unlock_…",
    pattern: /^kaizen_unlock_[0-9a-f-]{36}$/,
    category: "necessary",
  },
  {
    name: "__stripe_mid, __stripe_sid",
    pattern: /^__stripe_(mid|sid)$/,
    category: "necessary",
  },
  {
    name: "_ga",
    pattern: /^_ga$/,
    category: "statistics",
  },
  {
    name: "_ga_…",
    pattern: /^_ga_[A-Z0-9]+$/,
    category: "statistics",
  },
  {
    name: "_gcl_au",
    pattern: /^_gcl_(au|aw|dc|gb|ag)$/,
    category: "marketing",
  },
  {
    name: "_fbp",
    pattern: /^_fbp$/,
    category: "marketing",
  },
  {
    name: "_fbc",
    pattern: /^_fbc$/,
    category: "marketing",
  },
  {
    name: "_ttp",
    pattern: /^(_ttp|_tt_enable_cookie|ttcsid.*)$/,
    category: "marketing",
  },
  {
    name: "_pin_unauth",
    pattern: /^(_pin_unauth|_pinterest_ct_ua|_epik|_derived_epik)$/,
    category: "marketing",
  },
] as const satisfies readonly { name: string; pattern: RegExp; category: ConsentCategory }[];

export type KnownCookieName = (typeof COOKIE_PATTERNS)[number]["name"];

/** The category of the cookie a name belongs to, if Kaizen knows it. */
export const cookieCategory = (name: string): ConsentCategory | null => COOKIE_PATTERNS.find((c) => c.pattern.test(name))?.category ?? null;
