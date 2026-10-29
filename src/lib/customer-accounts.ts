/**
 * Customer accounts (wave 10 unit B, D365, `docs/wave-10-must-haves.md` 3): whether a store's shoppers may, must or cannot have an account.
 * `optional` is what stores always had: a guest checks out with an email address, and may open an account with the order. `required`: only a
 * signed-in customer buys (`placeOrder()` refuses `sign_in_required`, the cart and checkout ask to sign in first). `off`: the store draws no
 * sign-in or account, and its account pages answer 404 except the links a shopper is sent after a sale.
 */

export const ACCOUNT_MODES = ["optional", "required", "off"] as const;
export type AccountsMode = (typeof ACCOUNT_MODES)[number];

export const isAccountsMode = (value: unknown): value is AccountsMode => typeof value === "string" && (ACCOUNT_MODES as readonly string[]).includes(value);

/** The store's mode, as saved (a store from before D365 reads `optional`). */
export const accountsMode = (store: { customerAccounts?: AccountsMode }): AccountsMode => store.customerAccounts ?? "optional";

/** Whether the store draws sign-in and account links at all. */
export const accountsShown = (store: { customerAccounts?: AccountsMode }): boolean => accountsMode(store) !== "off";

/** Whether a shopper must sign in before checking out. */
export const signInRequired = (store: { customerAccounts?: AccountsMode }, signedIn: boolean): boolean => accountsMode(store) === "required" && !signedIn;

/** Whether checkout offers to open an account with the order (only where accounts are optional: required means signed in already). */
export const offersAccountAtCheckout = (store: { customerAccounts?: AccountsMode }): boolean => accountsMode(store) === "optional";

/**
 * Account pages a shopper reaches only through the account itself, which answer 404 while accounts are off. Everything else under
 * `/account` is reached by a link sent after a sale (an order's pay, change, exchange, invoice, documents, review, newsletter, stock or
 * support link) and stays.
 */
export const ACCOUNT_ONLY_SEGMENTS = ["", "sign-in", "addresses", "bonus", "catalogue", "company", "creator", "orders", "privacy", "referrals", "reviews"] as const;

/** The store features that need customer accounts: none of them can be on while accounts are off, and accounts cannot be switched off while one is. */
export const FEATURES_NEEDING_ACCOUNTS = ["subscriptions", "bonus", "referrals"] as const;
