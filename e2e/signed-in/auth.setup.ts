import { expect, test as setup, type Page } from "@playwright/test";

import { testDb } from "../db";
import { totp } from "../fixtures/totp.mjs";
import { ADMIN, E2E_PASSWORD, E2E_STORE, OWNER, QUIET, READER } from "./accounts";

/**
 * Signs the test people in through the admin's own sign-in form, against the Auth stand-in (e2e/fixtures/auth-stub.mjs), and
 * keeps each browser's state for the specs. Runs before every signed-in spec (the `signed-in-setup` project); it arranges
 * the accounts first, so it holds on a fresh database and again on one it ran against before.
 */

async function signIn(page: Page, email: string, next: string) {
  await page.goto(`/admin/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => url.pathname === next);
}

setup("the platform admin signs in with the second step", async ({ browser }) => {
  const sql = testDb();
  try {
    await sql`
      insert into commerce.accounts (email, name, platform_admin) values (${ADMIN.email}, ${ADMIN.name}, true)
      on conflict do nothing`;
    await sql`update commerce.accounts set platform_admin = true, disabled_at = null where lower(email) = ${ADMIN.email}`;
  } finally {
    await sql.end();
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/admin/sign-in?next=${encodeURIComponent("/admin/platform")}`);
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // The password alone is the first step: the gate holds a platform admin at the second.
  await page.waitForURL((url) => url.pathname === "/admin/sign-in/two-step");
  await page.getByLabel("Code").fill(totp());
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL((url) => url.pathname === "/admin/platform");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await context.storageState({ path: ADMIN.state });
  await context.close();
});

setup("the owner and the reader sign in", async ({ browser }) => {
  const sql = testDb();
  try {
    // The owner and their store, approved as the platform does; then the reader's account, not yet a member.
    const [store] = await sql`select id from commerce.stores where slug = ${E2E_STORE}`;
    if (!store) {
      const [request] = await sql`
        insert into commerce.access_requests (email, name, store_name) values (${OWNER.email}, ${OWNER.name}, 'E2E Shop') returning id`;
      await sql`select commerce.approve_access_request(${request.id}, ${E2E_STORE}, 'E2E Shop', null)`;
    }
    // A store past its setup wizard, as most stores an owner works in are (the wizard is a page of its own).
    await sql`update commerce.stores set setup_completed_at = coalesce(setup_completed_at, now()) where slug = ${E2E_STORE}`;
    for (const person of [READER, QUIET]) {
      await sql`
        insert into commerce.accounts (email, name) select ${person.email}, ${person.name}
        where not exists (select 1 from commerce.accounts where lower(email) = ${person.email})`;
    }
    await sql`
      insert into commerce.store_members (store_id, account_id, role, kind)
      select s.id, a.id, 'admin', 'staff' from commerce.stores s join commerce.accounts a on lower(a.email) = ${QUIET.email}
       where s.slug = ${E2E_STORE}
      on conflict (store_id, account_id) do nothing`;

    const owner = await browser.newContext();
    const ownerPage = await owner.newPage();
    await signIn(ownerPage, OWNER.email, `/admin/${E2E_STORE}`);
    await expect(ownerPage.getByRole("heading", { level: 1 })).toBeVisible();
    // The Team page offers the store its role templates on the first visit (`ensureStoreRoles()`).
    await ownerPage.goto(`/admin/${E2E_STORE}/staff`);
    await expect(ownerPage.getByRole("heading", { level: 1, name: "Team" })).toBeVisible();
    await owner.storageState({ path: OWNER.state });
    await owner.close();

    await sql`
      insert into commerce.store_members (store_id, account_id, role, role_id, kind)
      select s.id, a.id, 'admin', r.id, 'staff'
        from commerce.stores s
        join commerce.store_roles r on r.store_id = s.id and r.template = 'read_only'
        join commerce.accounts a on lower(a.email) = ${READER.email}
       where s.slug = ${E2E_STORE}
      on conflict (store_id, account_id) do update set role_id = excluded.role_id, disabled_at = null`;

    const reader = await browser.newContext();
    const readerPage = await reader.newPage();
    await signIn(readerPage, READER.email, `/admin/${E2E_STORE}`);
    await expect(readerPage.getByRole("heading", { level: 1 })).toBeVisible();
    await reader.storageState({ path: READER.state });
    await reader.close();
  } finally {
    await sql.end();
  }
});
