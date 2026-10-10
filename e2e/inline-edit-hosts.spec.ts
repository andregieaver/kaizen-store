import { expect, test, type Page } from "@playwright/test";

import { signGrant } from "../src/lib/edit-grant";

import { testDb } from "./db";

/**
 * Changing a page's words where they stand, on a store's own host (D193), where the admin's sign-in cannot be seen: the pass the admin
 * gives (a signed link, here made with the key the server under test was started with), the cookie the store's host swaps it for,
 * the editing in the browser, and every way the pass stops. Needs a build with the store domain set, as CI's `hosts` job makes
 * (see `e2e/store-hosts.spec.ts`).
 *
 * The admin's own route (`/api/platform/editor/grant`) needs a signed-in session, which no end-to-end test has; it is held by
 * `src/app/api/platform/editor/pass-routes.test.ts`.
 */
const domain = process.env.NEXT_PUBLIC_STORE_DOMAIN;
test.skip(!domain, "needs a build with NEXT_PUBLIC_STORE_DOMAIN set");

const key = Buffer.from(process.env.SETTINGS_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64"), "base64");
const onHost = (slug: string, path = "") => `http://${slug}.${domain}${path}`;
const doc = (words: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: words }] }] });

type Arranged = { slug: string; storeId: string; accountId: string; pageId: string; /** A second member (an admin), who can be taken off the team: a store keeps its only owner. */ memberId: string };

/** A new store with its owner, an admin and one published page of a heading and a text. */
async function arrange(): Promise<Arranged> {
  const slug = `redig-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
  const sql = testDb();
  try {
    const email = `${slug}@example.com`;
    const [request] = await sql`insert into commerce.access_requests (email, name, store_name) values (${email}, 'Kari', 'Karis Redigering') returning id`;
    const [{ id: storeId }] = await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Karis Redigering', null) as id`;
    const [{ id: accountId }] = await sql`select id from commerce.accounts where email = ${email}`;
    const [{ id: memberId }] = await sql`insert into commerce.accounts (email, name) values (${`admin-${email}`}, 'Ola') returning id`;
    await sql`insert into commerce.store_members (store_id, account_id, role) values (${storeId}, ${memberId}, 'admin')`;
    const content = {
      title: "Side",
      slug: "side",
      thumbnail: null,
      seo: { title: "", description: "" },
      searchEngines: true,
      aiAssistants: true,
      categories: [],
      tags: [],
      rows: [
        { id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks: [{ id: "h1", type: "heading", text: "Velkommen", level: 1 }, { id: "t1", type: "richText", doc: doc("Noen ord å lese") }] }] },
      ],
    };
    const [page] = await sql`
      insert into commerce.pages (store_id, slug, draft, published, published_at)
      values (${storeId}, 'side', ${sql.json(content as never)}, ${sql.json(content as never)}, now()) returning id`;
    return { slug, storeId, accountId, pageId: page.id, memberId };
  } finally {
    await sql.end();
  }
}

/** What the admin's route would send the browser to: the store's host, with a link token for the person. */
const linkFor = (who: Arranged, over: Partial<Parameters<typeof signGrant>[1]> = {}, now = Date.now()) =>
  signGrant(key, { kind: "enter", storeId: who.storeId, store: who.slug, account: who.accountId, ...over }, now);
const enterUrl = (slug: string, pass: string, to = "/side") => onHost(slug, `/api/platform/editor/enter?pass=${encodeURIComponent(pass)}&to=${encodeURIComponent(to)}`);

/** The editing route as the page's own scripts call it. */
const askText = (page: Page, who: Arranged, method: "GET" | "POST" = "GET", body?: unknown) =>
  page.evaluate(
    async ({ url, method, body }) => {
      const response = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      return { status: response.status, json: await response.json().catch(() => null) };
    },
    { url: onHost(who.slug, `/api/platform/editor/text${method === "GET" ? `?store=${who.slug}&page=${who.pageId}&block=h1` : ""}`), method, body },
  );

const passCookie = async (page: Page) => (await page.context().cookies()).find((cookie) => cookie.name === "kaizen_edit");

test("staff given a pass change a heading where it stands on the store's own host", async ({ page }) => {
  const who = await arrange();
  await page.goto(enterUrl(who.slug, linkFor(who)));

  // The pass is a cookie of the store's host that scripts cannot read, for the editing routes only; the address is cleaned.
  await expect(page).toHaveURL(onHost(who.slug, "/side"));
  const cookie = await passCookie(page);
  expect(cookie).toMatchObject({ httpOnly: true, path: "/api/platform/editor", sameSite: "Lax" });
  expect(await page.evaluate(() => document.cookie)).not.toContain("kaizen_edit");

  // The page opens in editing: the button says so, and the editor is there when the heading is pressed.
  await expect(page.getByRole("button", { name: "Done editing" })).toBeVisible();
  await page.waitForFunction(() => [...document.querySelectorAll("style")].some((el) => el.textContent?.includes("data-kz-page")));
  await page.waitForTimeout(200);
  await page.getByRole("heading", { name: "Velkommen" }).click();
  const editor = page.locator('[data-inline-editing="heading"]');
  await expect(editor).toBeVisible();
  await page.keyboard.press("End");
  await page.keyboard.type(" tilbake");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Velkommen tilbake" })).toBeVisible();

  // It is in the live page, and written down for the person it was done as.
  const sql = testDb();
  try {
    const [row] = await sql`select published #>> '{rows,0,columns,0,blocks,0,text}' as heading from commerce.pages where id = ${who.pageId}`;
    expect(row.heading).toBe("Velkommen tilbake");
    const [entry] = await sql`select account_id, action from commerce.audit_log where target_id = ${who.pageId} and action = 'store.page_text_edited'`;
    expect(entry).toMatchObject({ account_id: who.accountId });
  } finally {
    await sql.end();
  }
  await page.reload();
  await expect(page.getByRole("heading", { name: "Velkommen tilbake" })).toBeVisible();

  // Done editing ends the pass on the spot.
  await page.getByRole("button", { name: "Edit text" }).click();
  await page.getByRole("button", { name: "Done editing" }).click();
  await expect.poll(() => passCookie(page)).toBeUndefined();
  const after = await askText(page, who);
  expect(after.status).toBe(403);
});

test("the pass stops with the person's access, though its cookie is still good", async ({ page }) => {
  const who = await arrange();
  await page.goto(enterUrl(who.slug, linkFor(who, { account: who.memberId })));
  await expect(page.getByRole("button", { name: "Done editing" })).toBeVisible();
  expect((await askText(page, who)).status).toBe(200);

  const sql = testDb();
  try {
    await sql`update commerce.store_members set disabled_at = now() where store_id = ${who.storeId} and account_id = ${who.memberId}`;
  } finally {
    await sql.end();
  }
  const refused = await askText(page, who);
  expect(refused.status).toBe(403);
  const save = await askText(page, who, "POST", { store: who.slug, page: who.pageId, block: "h1", rev: "0123456789abcdef", edit: { kind: "heading", text: "Overtatt" } });
  expect(save.status).toBe(403);
});

test("nothing is given for a link that ran out, one for another store or one of the wrong kind; and a visitor is given nothing", async ({ page, browser }) => {
  const who = await arrange();
  const other = await arrange();

  // Over: made ten minutes ago. For another store's host. The pass's own kind used as the link.
  for (const [host, pass] of [
    [who.slug, linkFor(who, {}, Date.now() - 10 * 60_000)],
    [other.slug, linkFor(who)],
    [who.slug, linkFor(who, { kind: "edit" })],
    [who.slug, "garbage"],
  ] as const) {
    const response = await page.goto(enterUrl(host, pass));
    expect(response?.status(), `${host} ${pass.slice(0, 12)}`).toBe(400);
    expect(await passCookie(page)).toBeUndefined();
  }

  // A visitor asks the editing routes and is refused; the page they see has no button, no editor.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(onHost(who.slug, "/side"));
  expect((await askText(visitor, who)).status).toBe(403);
  expect((await askText(visitor, who, "POST", { store: who.slug, page: who.pageId, block: "h1", rev: "0123456789abcdef", edit: { kind: "heading", text: "Overtatt" } })).status).toBe(403);
  await expect(visitor.getByRole("button", { name: /Edit text|Done editing/ })).toHaveCount(0);
  await visitor.context().close();
});
