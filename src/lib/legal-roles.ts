/**
 * The pages a store points to for its legal texts (wave 1, 1e, `docs/wave-1-trust.md` 3.1): terms of sale, privacy,
 * returns, shipping, withdrawal information, imprint and the accessibility statement.
 *
 * They are *linked* roles, not entries of `PAGE_ROLES` (D112): a D112 role with no address of its own is drawn at the
 * role's place and its page is a 404 at its own address, but a legal page must be served at its own address and be in
 * the sitemap once published. The rows live in the same table (`commerce.page_roles`, whose check allows these names)
 * and keep its one-role-per-page key.
 *
 * No imports: `src/db/schema.ts` reads this file for its check constraint, and drizzle-kit loads it without the app's
 * path aliases.
 */
export const LEGAL_ROLES = ["terms", "privacy", "returns_policy", "shipping_policy", "withdrawal_info", "imprint", "accessibility"] as const;
export type LegalRole = (typeof LEGAL_ROLES)[number];

export const isLegalRole = (value: unknown): value is LegalRole => (LEGAL_ROLES as readonly unknown[]).includes(value);

/** What the admin calls each, and a line on what it is for. English only: the admin is. */
export const LEGAL_ROLE_COPY: Record<LegalRole, { name: string; hint: string }> = {
  terms: {
    name: "Terms of sale",
    hint: "The page checkout names as the terms the shopper accepts by ordering. It is linked from the footer.",
  },
  privacy: {
    name: "Privacy statement",
    hint: "The page checkout names as the privacy statement. It is linked from the footer.",
  },
  returns_policy: {
    name: "Returns policy",
    hint: "How the store takes goods back: the window, who pays, when the refund is made.",
  },
  shipping_policy: {
    name: "Shipping policy",
    hint: "Where the store delivers, what it costs and how long it takes.",
  },
  withdrawal_info: {
    name: "Withdrawal information",
    hint: "The right to withdraw from a purchase and how to use it, with the model withdrawal form.",
  },
  imprint: {
    name: "Imprint",
    hint: "Who the business is: name, number, address and contact details.",
  },
  accessibility: {
    name: "Accessibility statement",
    hint: "How accessible the site is, what is known to be missing and who to contact.",
  },
};

/**
 * What each legal page is needed for (D178 step 5): the checkout's pages (the terms of sale, the returns and shipping policies, the
 * withdrawal information) only while the store sells online (`shop`); privacy, imprint and accessibility always, a website included.
 * `afterSale`: also while the online shop is off and an order can still be withdrawn from or returned, as the footer's withdrawal link.
 * The store feature is written as its id (no imports here); `src/lib/legal-roles.test.ts` holds it to the registry.
 */
export const LEGAL_ROLE_NEEDS: Record<LegalRole, { feature?: "shop"; afterSale?: boolean }> = {
  terms: { feature: "shop" },
  privacy: {},
  returns_policy: { feature: "shop", afterSale: true },
  shipping_policy: { feature: "shop" },
  withdrawal_info: { feature: "shop", afterSale: true },
  imprint: {},
  accessibility: {},
};

/**
 * Whether a store needs (and the footer links) a legal page now: always for privacy, imprint and accessibility; the checkout's while the
 * online shop is on, and the withdrawal information and returns policy also while after-sale is open with the shop off.
 */
export function legalRoleNeeded(role: LegalRole, shopOn: boolean, afterSaleOpen = false): boolean {
  const needs = LEGAL_ROLE_NEEDS[role];
  if (!needs.feature || shopOn) return true;
  return Boolean(needs.afterSale && afterSaleOpen);
}

/** The two roles checkout names in its terms sentence, in the order the sentence names them. */
export const CHECKOUT_TERMS_ROLES = ["terms", "privacy"] as const satisfies readonly LegalRole[];
