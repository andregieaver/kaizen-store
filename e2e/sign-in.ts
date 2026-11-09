import { expect, type Page } from "@playwright/test";

import { signInFor } from "../src/lib/sign-in-for";

/**
 * A visitor without a session who opened `path` ends on the sign-in page. A page the admin's session check sends there keeps where
 * they were going (`signInFor()`, D511): `path` itself, or the page `path` leads to (an old address, a platform page that moved); a
 * route that sends them itself (`requireAccount()`) goes to the plain page. A `next` that `signInFor()` would not write fails.
 */
export async function expectSentToSignIn(page: Page, path: string): Promise<void> {
  await expect(page, path).toHaveURL((url) => {
    if (url.pathname !== "/admin/sign-in") return false;
    const next = url.searchParams.get("next");
    if (next === null) return url.search === "";
    return [...url.searchParams.keys()].length === 1 && signInFor(next) === `${url.pathname}${url.search}`;
  });
}
