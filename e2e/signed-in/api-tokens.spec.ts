import { expect, test, type Page } from "@playwright/test";

import { E2E_STORE, OWNER } from "./accounts";

/**
 * Settings → Apps and API's tokens as the owner meets them after D440's review: every everyday scope in plain words, ticked in the open,
 * and what the AI manager asks the owner's yes for (the powers) one deliberate step away under *Customise*. A token is shown once; a token
 * given `orders:read` alone reads orders and is refused customers with a 403 naming the scope; a power ticked under Customise is held (a
 * token with `customers:email` and `customers:read` reads customers); Revoke ends a token at once.
 */

test.use({ storageState: OWNER.state });
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const POWERS = "Customise: what the AI manager asks your yes for";

/** A scope's checkbox, found by the scope's own name printed under its words. */
const scopeBox = (page: Page, scope: string) => page.getByRole("checkbox", { name: new RegExp(`${scope}$`) });

async function makeToken(page: Page, name: string, scopes: string[], powers: string[] = []): Promise<string> {
  await page.goto(`/admin/${E2E_STORE}/settings/api`);
  await page.getByLabel("Name", { exact: true }).fill(name);
  for (const scope of scopes) await scopeBox(page, scope).check();
  if (powers.length > 0) {
    await page.getByText(POWERS, { exact: true }).click();
    for (const power of powers) await scopeBox(page, power).check();
  }
  await page.getByRole("button", { name: "Make a token" }).click();
  const shown = page.getByRole("status").filter({ hasText: "The token" });
  await expect(shown).toBeVisible();
  await expect(shown).toContainText("shown only this once");
  const token = ((await shown.locator("code").textContent()) ?? "").trim();
  expect(token.length).toBeGreaterThan(20);
  await shown.getByRole("button", { name: "Done" }).click();
  await expect(shown).toBeHidden();
  return token;
}

async function revoke(page: Page, name: string) {
  await page.goto(`/admin/${E2E_STORE}/settings/api`);
  const row = page.getByRole("listitem").filter({ hasText: name });
  page.once("dialog", (dialog) => void dialog.accept());
  await row.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: name })).toHaveCount(0);
}

test("the powers wait under Customise; a read token reads its area only; a power ticked there is held; Revoke ends both", async ({ page, request }) => {
  await page.goto(`/admin/${E2E_STORE}/settings/api`);
  // Homer's view: the everyday scopes in the open, the powers folded away.
  await expect(scopeBox(page, "orders:read")).toBeVisible();
  await expect(scopeBox(page, "customers:email")).toBeHidden();
  await expect(scopeBox(page, "orders:refund")).toBeHidden();
  await page.getByText(POWERS, { exact: true }).click();
  await expect(scopeBox(page, "customers:email")).toBeVisible();
  await expect(scopeBox(page, "orders:refund")).toBeVisible();

  const reader = `E2E orders reader ${run}`;
  const readerToken = await makeToken(page, reader, ["orders:read"]);
  const auth = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });
  expect((await request.get("/api/admin/v1/orders?limit=1", auth(readerToken))).status()).toBe(200);
  const refused = await request.get("/api/admin/v1/customers?limit=1", auth(readerToken));
  expect(refused.status()).toBe(403);
  expect(await refused.text()).toContain("customers:read");

  const emails = `E2E customer emails ${run}`;
  const emailsToken = await makeToken(page, emails, ["customers:read"], ["customers:email"]);
  expect((await request.get("/api/admin/v1/customers?limit=1", auth(emailsToken))).status()).toBe(200);
  await page.goto(`/admin/${E2E_STORE}/settings/api`);
  await expect(page.getByRole("listitem").filter({ hasText: emails })).toContainText("customers:email");

  await revoke(page, reader);
  await revoke(page, emails);
  expect((await request.get("/api/admin/v1/orders?limit=1", auth(readerToken))).status()).toBe(401);
  expect((await request.get("/api/admin/v1/customers?limit=1", auth(emailsToken))).status()).toBe(401);
});
