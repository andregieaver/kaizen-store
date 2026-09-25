import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/** Kaizen's own pages (D42), as visitors see them. Pages are made in the database, as the admin saves them. */

const run = Date.now().toString(36);

const content = (title: string, slug: string, text: string, extra: Record<string, unknown> = {}) => ({
  title,
  slug,
  thumbnail: null,
  seo: { title: "", description: "" },
  searchEngines: true,
  aiAssistants: true,
  blocks: [
    {
      id: "b1",
      type: "richText",
      doc: {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Who we are" }] },
          {
            type: "paragraph",
            content: [
              { type: "text", text },
              { type: "text", text: "Start here", marks: [{ type: "link", attrs: { href: "/sign-up" } }] },
            ],
          },
          { type: "paragraph" },
        ],
      },
    },
  ],
  ...extra,
});

test("a published page shows in Kaizen's header and footer; a draft does not show at all", async ({ page }) => {
  const live = `about-${run}`;
  const draft = `draft-${run}`;
  const sql = testDb();
  try {
    const published = content("About Kaizen", live, "We make online stores. ");
    await sql`
      insert into commerce.pages (slug, draft, published, published_at)
      values (${live}, ${sql.json(published)}, ${sql.json(published)}, now()),
             (${draft}, ${sql.json(content("Secret", draft, "Not yet. "))}, null, null)
    `;
  } finally {
    await sql.end();
  }

  await page.goto(`/${live}`);
  await expect(page).toHaveTitle("About Kaizen · Kaizen");
  await expect(page.getByRole("heading", { level: 1, name: "About Kaizen" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Who we are" })).toBeVisible();
  await expect(page.getByRole("banner").getByRole("link", { name: "Kaizen", exact: true })).toBeVisible();
  await expect(page.getByRole("contentinfo")).toBeVisible();
  // Visitors without a session never see the editor's button.
  await expect(page.getByRole("link", { name: "Edit page" })).toHaveCount(0);
  await page.getByRole("main").getByRole("link", { name: "Start here" }).click();
  await expect(page).toHaveURL("/sign-up");

  const response = await page.goto(`/${draft}`);
  expect(response?.status()).toBe(404);
});

test("a page that moved sends its old address to the new one for good", async ({ request }) => {
  const before = `old-${run}`;
  const after = `new-${run}`;
  const sql = testDb();
  try {
    const published = content("Moving", before, "Here. ");
    const [{ id }] = await sql`
      insert into commerce.pages (slug, draft, published, published_at)
      values (${before}, ${sql.json(published)}, ${sql.json(published)}, now())
      returning id
    `;
    const moved = content("Moving", after, "Here. ");
    await sql`update commerce.pages set slug = ${after}, draft = ${sql.json(moved)}, published = ${sql.json(moved)} where id = ${id}`;
  } finally {
    await sql.end();
  }
  const response = await request.get(`/${before}`, { maxRedirects: 0 });
  expect(response.status()).toBe(308);
  // The first, uncached response from `next start` repeats the header; each copy is the new address.
  expect(response.headers().location.split(",").map((value) => value.trim())).toContain(`/${after}`);
});

test("a page kept from search engines asks not to be indexed", async ({ page }) => {
  const slug = `hidden-${run}`;
  const sql = testDb();
  try {
    const published = content("Hidden", slug, "Quiet. ", { searchEngines: false });
    await sql`
      insert into commerce.pages (slug, draft, published, published_at)
      values (${slug}, ${sql.json(published)}, ${sql.json(published)}, now())
    `;
  } finally {
    await sql.end();
  }
  await page.goto(`/${slug}`);
  await expect(page.locator('head meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});
