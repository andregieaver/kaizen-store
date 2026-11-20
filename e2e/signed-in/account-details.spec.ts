import { createHash, randomBytes } from "node:crypto";

import { expect, test, type Browser, type Page } from "@playwright/test";

import { testDb } from "../db";
import { totp } from "../fixtures/totp.mjs";
import { ADMIN, E2E_PASSWORD, E2E_STORE, MOVER, OWNER } from "./accounts";

/**
 * A person's own name and email (D836). The mover, a throwaway member, signs in here (so the sign-in is from the last ten minutes, as asking
 * for a new email needs), changes their name on Your account and asks for a new email: the link goes to the new address, its token never in
 * the email log, so the test gives the waiting change a token of its own in the database and opens that link signed out. This build has no
 * Supabase secret key (uploads stay off, `builder-animation.spec.ts`), so the mover's confirmation cannot reach Supabase Auth's admin API: the
 * page says nothing was changed, and nothing is (the change through Supabase is `email-change.int.test.ts`'s). A platform admin corrects an
 * invited member's name and sends a link to a new address for them; that account has no Supabase Auth user yet, so the link moves it, and the
 * new address shows on the platform's customer page.
 */

const run = Date.now().toString(36);

async function signIn(browser: Browser, email: string, next: string, secondStep = false): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/admin/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  if (secondStep) {
    await page.waitForURL((url) => url.pathname === "/admin/sign-in/two-step");
    await page.getByLabel("Code").fill(totp());
    await page.getByRole("button", { name: "Continue" }).click();
  }
  await page.waitForURL((url) => url.pathname === next);
  return page;
}

/** Gives the account's waiting change a token the test knows, as only its hash is kept; the link with it is what the email carried. */
async function knownLink(accountId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const sql = testDb();
  try {
    const changed = await sql`
      update commerce.account_email_changes set token_hash = ${createHash("sha256").update(token).digest("hex")}
      where account_id = ${accountId} and used_at is null returning id`;
    expect(changed).toHaveLength(1);
  } finally {
    await sql.end();
  }
  return `/admin/account/email/confirm?token=${token}`;
}

test("a person changes their name and asks for a new email; the link's page changes nothing it cannot finish", async ({ browser }) => {
  const sql = testDb();
  let moverId = "";
  try {
    await sql`
      insert into commerce.accounts (email, name) select ${MOVER.email}, ${MOVER.name}
      where not exists (select 1 from commerce.accounts where lower(email) = ${MOVER.email})`;
    const [mover] = await sql`update commerce.accounts set name = ${MOVER.name}, disabled_at = null where lower(email) = ${MOVER.email} returning id`;
    moverId = String(mover.id);
    await sql`delete from commerce.account_email_changes where account_id = ${moverId}`;
    await sql`
      insert into commerce.store_members (store_id, account_id, role, kind)
      select s.id, ${moverId}, 'admin', 'staff' from commerce.stores s where s.slug = ${E2E_STORE}
      on conflict (store_id, account_id) do update set disabled_at = null`;
  } finally {
    await sql.end();
  }

  const page = await signIn(browser, MOVER.email, "/admin/account");
  const details = page.getByRole("region", { name: "Name and email" });
  await expect(details.getByText(MOVER.name)).toBeVisible();
  await expect(details.getByText(MOVER.email)).toBeVisible();

  // The name: Change, the field, Save.
  const name = `Mona ${run}`;
  await details.getByRole("button", { name: "Change your name" }).click();
  await details.getByLabel("Name", { exact: true }).fill(`  ${name}  `);
  await details.getByRole("button", { name: "Save name" }).click();
  await expect(details.getByText("Name saved.")).toBeVisible();
  await expect(page.getByText(`Signed in as ${name} (${MOVER.email}).`)).toBeVisible();

  // The email: one step away, with the line that says how it works.
  await details.getByRole("link", { name: "Change your email" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Change your email" })).toBeVisible();
  await expect(page.getByText("A link goes to the new address, and your email changes when you open it.")).toBeVisible();
  await page.getByLabel("New email").fill(OWNER.email);
  await page.getByRole("button", { name: "Send the link" }).click();
  await expect(page.getByText("Another Kaizena Flow account uses that address. Use another one.").first()).toBeVisible();

  const moved = `e2e-moved-${run}@example.com`;
  await page.getByLabel("New email").fill(moved);
  await page.getByRole("button", { name: "Send the link" }).click();
  await expect(page.getByText(`A link is on its way to ${moved}.`)).toBeVisible();
  const pending = page.getByRole("region", { name: "Waiting for the link" });
  await expect(pending).toContainText(moved);

  // The link went to the new address without its token in the log; the old address was told, the new one half hidden.
  const db = testDb();
  try {
    const [link] = await db`select text from commerce.email_messages where kind = 'security.email_change_confirm' and to_address = ${moved}`;
    expect(String(link.text)).toContain("/admin/account/email/confirm?token=[code]");
    const [notice] = await db`select text from commerce.email_messages where kind = 'security.email_change_requested' and to_address = ${MOVER.email} order by created_at desc limit 1`;
    expect(String(notice.text)).toContain("e•••@example.com");
  } finally {
    await db.end();
  }
  await page.goto("/admin/account");
  await expect(page.getByText(`Waiting for you to open the link sent to ${moved}.`)).toBeVisible();

  // The link, opened signed out on another device: the page names the address, its button confirms. Without the Supabase secret key in
  // this build the change cannot reach Supabase Auth, so nothing changes and the person is told.
  const address = await knownLink(moverId);
  const elsewhere = await (await browser.newContext()).newPage();
  await elsewhere.goto(address);
  await expect(elsewhere.getByRole("heading", { level: 1, name: "Use your new email address" })).toBeVisible();
  await expect(elsewhere.getByText(`Your Kaizena Flow account will use ${moved}.`)).toBeVisible();
  await elsewhere.getByRole("button", { name: "Use this address" }).click();
  await expect(elsewhere.getByText("The change could not be made just now, so nothing was changed.")).toBeVisible();
  const check = testDb();
  try {
    const [still] = await check`select email from commerce.accounts where id = ${moverId}`;
    expect(still.email).toBe(MOVER.email);
  } finally {
    await check.end();
  }

  // Cancelled, the link no longer works.
  await page.goto("/admin/account/email");
  await page.getByRole("region", { name: "Waiting for the link" }).getByRole("button", { name: "Cancel the change" }).click();
  await expect(page.getByRole("region", { name: "Waiting for the link" })).toHaveCount(0);
  await elsewhere.goto(address);
  await expect(elsewhere.getByRole("heading", { level: 1, name: "This link does not work" })).toBeVisible();
  await elsewhere.context().close();
  await page.context().close();
});

test("a platform admin corrects a member's name and sends a link to their new address, which moves the account once opened", async ({ browser }) => {
  const invited = `e2e-invited-${run}@example.com`;
  const sql = testDb();
  let id = "";
  try {
    const [made] = await sql`insert into commerce.accounts (email, name) values (${invited}, 'Ivar Invited') returning id`;
    id = String(made.id);
    await sql`
      insert into commerce.store_members (store_id, account_id, role, kind)
      select s.id, ${id}, 'admin', 'staff' from commerce.stores s where s.slug = ${E2E_STORE}`;
  } finally {
    await sql.end();
  }

  // Sending a link for someone needs the admin's own sign-in from the last ten minutes.
  const page = await signIn(browser, ADMIN.email, `/admin/platform/customers/${id}`, true);
  const details = page.getByRole("region", { name: "Name and email" });
  await details.getByLabel("Name", { exact: true }).fill("Ivar Rettet");
  await details.getByRole("button", { name: "Save name" }).click();
  await expect(details.getByText("Name saved.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: /Ivar Rettet/ })).toBeVisible();

  const moved = `e2e-invited-new-${run}@example.com`;
  await details.getByLabel("New email").fill(moved);
  await details.getByRole("button", { name: "Send the link" }).click();
  await expect(details.getByText(`A link is on its way to ${moved}.`)).toBeVisible();
  await expect(details.getByText(`Waiting for the link sent to ${moved}`)).toBeVisible();

  // Opened by the person, signed out: never signed in before, the account moves by its own row, and nobody is signed in by it.
  const address = await knownLink(id);
  const person = await (await browser.newContext()).newPage();
  await person.goto(address);
  await person.getByRole("button", { name: "Use this address" }).click();
  await expect(person.getByRole("heading", { level: 1, name: "Your email address is changed" })).toBeVisible();
  await expect(person.getByText(`Your Kaizena Flow account now uses ${moved}.`)).toBeVisible();
  await expect(person.getByRole("link", { name: "Sign in" })).toBeVisible();
  await person.context().close();

  await page.reload();
  await expect(page.getByRole("link", { name: moved })).toBeVisible();
  await expect(page.getByRole("region", { name: "Name and email" }).getByText("Waiting for the link")).toHaveCount(0);
  await page.context().close();
});
