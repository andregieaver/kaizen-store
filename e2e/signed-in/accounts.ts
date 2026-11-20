/**
 * The signed-in admin tests' people (e2e/fixtures/auth-stub.mjs signs only them in). The owner owns `E2E_STORE`, a store
 * approved as the platform does (so it is a copy of the template with its demo products); the reader is a member of it with
 * the store's Read-only role, and the quiet member has the plain admin role and leaves no entry; the platform admin runs Kaizena Flow. Each has a browser state saved by `auth.setup.ts`; a spec takes one with `test.use()`.
 */
export const E2E_PASSWORD = "e2e-Password-1";
export const E2E_STORE = "e2e-shop";
export const OWNER = { email: "e2e-owner@example.com", name: "Eva Owner", state: "e2e/.auth/owner.json" } as const;
export const READER = { email: "e2e-reader@example.com", name: "Rune Reader", state: "e2e/.auth/reader.json" } as const;
/**
 * Kaizena Flow's platform admin, with an authenticator app already set up in the Auth stand-in (its secret is `E2E_TOTP_SECRET`
 * in e2e/fixtures/totp.mjs): signed in through the password and then the two-step form, so its browser state holds an `aal2` session.
 */
export const ADMIN = { email: "e2e-admin@example.com", name: "Pia Platform", state: "e2e/.auth/admin.json" } as const;
/**
 * A throwaway member of `E2E_STORE` who changes their own name and asks for a new email (D836, `account-details.spec.ts`), signed in by
 * that spec itself, so its sign-in is from the last ten minutes and no other spec's person changes.
 */
export const MOVER = { email: "e2e-mover@example.com", name: "Mona Mover" } as const;
/** A member who never signs in or acts: who may see their name is the Team page's to say. */
export const QUIET = { email: "e2e-quiet@example.com", name: "Quentin Quiet" } as const;

/**
 * Two accounts that read the admin in Norwegian (`accounts.admin_locale = 'nb-NO'`, set by `auth.setup.ts` after they sign in through
 * the English form). The owner has a store of their own, so no other spec's store changes; the admin runs Kaizena Flow like `ADMIN`.
 */
export const E2E_STORE_NB = "e2e-butikk";
export const OWNER_NB = { email: "e2e-eier@example.com", name: "Nora Eier", state: "e2e/.auth/owner-nb.json" } as const;
export const ADMIN_NB = { email: "e2e-admin-nb@example.com", name: "Per Plattform", state: "e2e/.auth/admin-nb.json" } as const;
