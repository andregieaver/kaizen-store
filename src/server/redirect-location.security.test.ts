import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({ notFound: () => {}, permanentRedirect: () => {} }));
vi.mock("@/db/client", () => ({ db: () => ({}), readDb: () => ({}) }));

import { locationIn } from "./redirect-resolve";

/**
 * Security review (wave 2 run 2): `permanentRedirect(locationIn(...))` puts the string in a `Location` header as it is. Node refuses a header value with a
 * character above U+00FF (ERR_INVALID_CHAR), so a stored manual target that holds one (the normal form is percent-DECODED, so a Greek, Cyrillic or Polish
 * handle is stored as letters) makes the market route answer 500 instead of 308. The header must be ASCII (percent-encoded).
 */
describe("the Location of a redirect in a market", () => {
  it.each(["/products/ζώνη", "/p/łódź", "/p/blåbær", "/p/x?q=æ#ø"])("is a valid header value for the target %s", (target) => {
    const location = locationIn("demo", "no", target);
    expect(/^[\x21-\x7e]*$/.test(location), location).toBe(true);
  });
});
