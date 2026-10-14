/**
 * The signed-in admin tests' people (e2e/fixtures/auth-stub.mjs signs only them in). The owner owns `E2E_STORE`, a store
 * approved as the platform does (so it is a copy of the template with its demo products); the reader is a member of it with
 * the store's Read-only role, and the quiet member has the plain admin role and leaves no entry. Each has a browser state saved by `auth.setup.ts`; a spec takes one with `test.use()`.
 */
export const E2E_PASSWORD = "e2e-Password-1";
export const E2E_STORE = "e2e-shop";
export const OWNER = { email: "e2e-owner@example.com", name: "Eva Owner", state: "e2e/.auth/owner.json" } as const;
export const READER = { email: "e2e-reader@example.com", name: "Rune Reader", state: "e2e/.auth/reader.json" } as const;
/** A member who never signs in or acts: who may see their name is the Team page's to say. */
export const QUIET = { email: "e2e-quiet@example.com", name: "Quentin Quiet" } as const;
