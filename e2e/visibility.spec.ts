import { createHash, randomBytes } from "node:crypto";

import { expect, test, type APIRequestContext } from "@playwright/test";

import { testDb, testStore } from "./db";

/**
 * Who sees a part (D179 phase 4, `docs/responsive-editing.md` 6): the server leaves out a part a visitor is not to see,
 * so its words are not in the page's HTML at all. A store's page holds parts for signed-out and signed-in visitors, a Never
 * part, parts by date and by country, and one by an address parameter; a shopper is signed in with a customer session and
 * its cookie, as the store's own sign-in leaves them.
 */

type Json = Record<string, unknown>;
const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const text = (id: string, words: string, show?: unknown): Json => ({ id, type: "richText", doc: doc(words), ...(show ? { visibility: { show } } : {}) });
const rules = (...conditions: Json[]) => ({ rules: [conditions] });

const ALWAYS = "Everyone reads this line";
const SIGNED_OUT = "Sign in for member prices";
const SIGNED_IN = "Welcome back, member";
const NEVER = "This draft paragraph is never shown";
const NOW = "A campaign that runs now";
const PAST = "A campaign that ended long ago";
const SWEDEN = "Only shoppers in Sweden read this";
const PROMO = "You came with the promo link";
const COLUMN = "A column for signed-in shoppers";

let slug = "";
let storeId = "";

test.beforeAll(async () => {
  // Several countries (D178), so the same page is drawn in Norway and Sweden.
  ({ slug, id: storeId } = await testStore("visibility", ["countries"]));
  const rows = [
    { id: "r-always", type: "row", layout: "1", columns: [{ id: "c-always", blocks: [text("b-always", ALWAYS)] }] },
    {
      id: "r-sign",
      type: "row",
      layout: "2",
      columns: [
        { id: "c-out", blocks: [text("b-out", SIGNED_OUT, "signedOut")] },
        { id: "c-in", blocks: [text("b-col", COLUMN)], visibility: { show: "signedIn" } },
      ],
    },
    { id: "r-in", type: "row", layout: "1", visibility: { show: "signedIn" }, columns: [{ id: "c-in-row", blocks: [text("b-in", SIGNED_IN)] }] },
    { id: "r-never", type: "row", layout: "1", columns: [{ id: "c-never", blocks: [text("b-never", NEVER, "never")] }] },
    {
      id: "r-time",
      type: "row",
      layout: "1",
      columns: [
        {
          id: "c-time",
          blocks: [
            text("b-now", NOW, rules({ fact: "date", op: "between", value: { from: "2020-01-01T00:00", to: "2099-01-01T00:00" } })),
            text("b-past", PAST, rules({ fact: "date", op: "between", value: { from: "2020-01-01T00:00", to: "2021-01-01T00:00" } })),
          ],
        },
      ],
    },
    {
      id: "r-place",
      type: "row",
      layout: "1",
      columns: [
        {
          id: "c-place",
          blocks: [
            text("b-se", SWEDEN, rules({ fact: "country", op: "in", value: ["SE"] })),
            text("b-promo", PROMO, rules({ fact: "query", op: "is", value: { name: "promo", text: "spring" } })),
          ],
        },
      ],
    },
  ];
  const content = {
    title: "Synlighet",
    slug: "synlighet",
    thumbnail: null,
    seo: { title: "", description: "" },
    searchEngines: true,
    aiAssistants: true,
    categories: [],
    tags: [],
    rows,
  };
  const sql = testDb();
  try {
    await sql`
      insert into commerce.pages (store_id, slug, draft, published, published_at)
      values (${storeId}, 'synlighet', ${sql.json(content as never)}, ${sql.json(content as never)}, now())`;
  } finally {
    await sql.end();
  }
});

/** The page's HTML as the server sends it, whole (the stream read to its end). */
async function html(request: APIRequestContext, path: string): Promise<string> {
  const response = await request.get(path);
  expect(response.status()).toBe(200);
  return response.text();
}

test("a signed-out visitor gets only what is for them: the rest is not in the HTML", async ({ request }) => {
  const page = await html(request, `/s/${slug}/no/synlighet`);
  expect(page).toContain(ALWAYS);
  expect(page).toContain(SIGNED_OUT);
  expect(page).not.toContain(SIGNED_IN);
  expect(page).not.toContain(COLUMN);
  expect(page).not.toContain(NEVER);
  // By date, in the store's time zone.
  expect(page).toContain(NOW);
  expect(page).not.toContain(PAST);
  // By country: Norway here.
  expect(page).not.toContain(SWEDEN);
  // No address parameter.
  expect(page).not.toContain(PROMO);
});

test("the same page in Sweden, and with the address parameter", async ({ request }) => {
  const sweden = await html(request, `/s/${slug}/se/synlighet`);
  expect(sweden).toContain(SWEDEN);
  expect(sweden).toContain(ALWAYS);
  const promo = await html(request, `/s/${slug}/no/synlighet?promo=spring`);
  expect(promo).toContain(PROMO);
  expect(await html(request, `/s/${slug}/no/synlighet?promo=autumn`)).not.toContain(PROMO);
});

test("a signed-in shopper gets the signed-in parts and not the signed-out ones", async ({ page, context }) => {
  // A customer and a session, as the store's sign-in leaves them: a row of `customer_sessions` and its cookie.
  const token = randomBytes(32).toString("base64url");
  const sql = testDb();
  try {
    const [customer] = await sql`
      insert into commerce.customers (store_id, email, name) values (${storeId}, ${`${slug}-kunde@example.com`}, 'Kari') returning id`;
    await sql`
      insert into commerce.customer_sessions (store_id, customer_id, token_hash, expires_at, verified_at)
      values (${storeId}, ${customer.id}, ${createHash("sha256").update(token).digest("hex")}, now() + interval '1 day', now())`;
  } finally {
    await sql.end();
  }
  await context.addCookies([{ name: `account_${storeId}`, value: token, url: `http://localhost:${process.env.PORT ?? 3000}`, httpOnly: true, sameSite: "Lax" }]);
  const source = await html(context.request, `/s/${slug}/no/synlighet`);
  expect(source).toContain(SIGNED_IN);
  expect(source).toContain(COLUMN);
  expect(source).not.toContain(SIGNED_OUT);
  expect(source).not.toContain(NEVER);
  // And in the browser, as drawn.
  await page.goto(`/s/${slug}/no/synlighet`);
  await expect(page.getByText(SIGNED_IN)).toBeVisible();
  await expect(page.getByText(SIGNED_OUT)).toHaveCount(0);
  await expect(page.getByText(ALWAYS)).toBeVisible();
});
