import { expect, type Page } from "@playwright/test";

import { signInFor } from "../src/lib/sign-in-for";

/**
 * A visitor without a session who opened `path` ends on the sign-in page. A page the admin's session check sends there keeps where
 * they were going (`signInFor()`, D511); a route that sends them itself (`requireAccount()`) goes to the plain page. Any other `next`
 * fails.
 */
export async function expectSentToSignIn(page: Page, path: string): Promise<void> {
  const kept = signInFor(path);
  await expect(page, path).toHaveURL((url) => {
    const at = `${url.pathname}${url.search}`;
    return at === "/admin/sign-in" || at === kept;
  });
}
