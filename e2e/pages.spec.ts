import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * Kaizen's own pages (D42, D43), as visitors see them. Pages are made in the
 * database, as the admin saves them; `content()` writes the shape saved
 * before rows (a list of blocks), which pages must still read.
 */

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
    // Rows of columns, as the builder saves them.
    const { blocks, ...rest } = content("About Kaizen", live, "We make online stores. ");
    const published = {
      ...rest,
      rows: [
        {
          id: "r1",
          type: "row",
          layout: "right-sidebar",
          columns: [
            { id: "c1", blocks },
            {
              id: "c2",
              blocks: [
                {
                  id: "b2",
                  type: "richText",
                  doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "In the sidebar." }] }] },
                },
              ],
            },
          ],
        },
      ],
    };
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
  // The title is the page's heading for screen readers and search engines, not shown (D45).
  await expect(page.getByRole("heading", { level: 1, name: "About Kaizen" })).toBeAttached();
  await expect(page.getByRole("heading", { level: 2, name: "Who we are" })).toBeVisible();
  // The row's two columns sit side by side on a computer, the second one narrower.
  const main = await page.getByText("We make online stores.").boundingBox();
  const side = await page.getByText("In the sidebar.").boundingBox();
  expect(side!.x).toBeGreaterThan(main!.x + main!.width - 1);
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

test("a picture block shows with its caption, and rows, columns and blocks keep their spacing (D47)", async ({ page }) => {
  const slug = `picture-${run}`;
  const sides = (top: number) => ({ top, right: 0, bottom: 0, left: 0 });
  const published = {
    ...content("Pictures", slug, "Text beside. "),
    blocks: undefined,
    rows: [
      {
        id: "r1",
        type: "row",
        layout: "2",
        style: { margin: sides(40) },
        columns: [
          {
            id: "c1",
            style: { padding: sides(24) },
            blocks: [
              {
                id: "i1",
                type: "image",
                image: { url: "https://example.com/lamp.webp", width: 1600, height: 900, alt: "A desk lamp" },
                caption: "Our lamp",
                style: { margin: sides(16) },
              },
            ],
          },
          {
            id: "c2",
            blocks: [
              {
                id: "t1",
                type: "richText",
                doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Text beside." }] }] },
              },
            ],
          },
        ],
      },
    ],
  };
  const sql = testDb();
  try {
    await sql`
      insert into commerce.pages (slug, draft, published, published_at)
      values (${slug}, ${sql.json(published)}, ${sql.json(published)}, now())
    `;
  } finally {
    await sql.end();
  }
  await page.goto(`/${slug}`);
  const figure = page.getByRole("figure");
  await expect(figure.getByRole("img", { name: "A desk lamp" })).toBeAttached();
  await expect(figure.locator("figcaption")).toHaveText("Our lamp");
  const px = (locator: import("@playwright/test").Locator, property: string) =>
    locator.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), property);
  expect(await px(figure.locator(".."), "margin-top")).toBe("16px");
  expect(await px(figure.locator("../.."), "padding-top")).toBe("24px");
  // Block, column, columns, the row's inside, the row.
  expect(await px(figure.locator("../../../../.."), "margin-top")).toBe("40px");
});

test("rows, columns and components take their settings: width, background, link, order, alignment and shape (D48)", async ({ page }) => {
  const slug = `settings-${run}`;
  const text = (id: string, words: string, extra: Record<string, unknown> = {}) => ({
    id,
    type: "richText",
    doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: words }] }] },
    ...extra,
  });
  const published = {
    ...content("Settings", slug, "Unused. "),
    blocks: undefined,
    rows: [
      {
        id: "r1",
        type: "row",
        layout: "2",
        width: "full",
        reverseOnMobile: true,
        equalHeight: true,
        align: "middle",
        background: { type: "color", color: "#112233" },
        htmlId: "hero",
        className: "hero-row",
        columns: [
          {
            id: "c1",
            link: { href: "/sign-up", label: "Get started" },
            background: { type: "color", color: "#ffffff" },
            blocks: [text("t1", "A short column.", { htmlId: "intro" })],
          },
          {
            id: "c2",
            blocks: [
              text("t2", "Aligned text.", { htmlId: "aligned", align: { mobile: "center", desktop: "right" } }),
              {
                id: "i1",
                type: "image",
                image: { url: "https://example.com/face.webp", width: 1600, height: 900, alt: "A face" },
                caption: "",
                shape: "circle",
              },
            ],
          },
        ],
      },
    ],
  };
  const sql = testDb();
  try {
    await sql`
      insert into commerce.pages (slug, draft, published, published_at)
      values (${slug}, ${sql.json(published)}, ${sql.json(published)}, now())
    `;
  } finally {
    await sql.end();
  }
  const css = (locator: import("@playwright/test").Locator, property: string) =>
    locator.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), property);

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(`/${slug}`);
  const row = page.locator("#hero");
  await expect(row).toHaveClass(/hero-row/);
  expect(await css(row, "background-color")).toBe("rgb(17, 34, 51)");
  // The row spans the window; what it holds keeps to the content's width.
  expect((await row.boundingBox())?.width).toBe(1400);
  const intro = page.locator("#intro");
  const aligned = page.locator("#aligned");
  expect((await intro.boundingBox())!.x).toBeGreaterThan(150);
  expect(await css(aligned, "text-align")).toBe("right");
  // The whole first column is a link, named by its description; the columns are equally tall.
  await expect(page.getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/sign-up");
  const first = intro.locator("..");
  const second = aligned.locator("..");
  expect((await first.boundingBox())!.height).toBe((await second.boundingBox())!.height);
  const picture = page.getByRole("img", { name: "A face" });
  const box = (await picture.boundingBox())!;
  expect(Math.abs(box.width - box.height)).toBeLessThan(1);
  expect(await css(picture, "border-top-left-radius")).not.toBe("0px");

  // On a phone the columns stack, the last first, and the text is centred.
  await page.setViewportSize({ width: 390, height: 800 });
  expect(await css(aligned, "text-align")).toBe("center");
  expect((await second.boundingBox())!.y).toBeLessThan((await first.boundingBox())!.y);
});

test("a heading can be the page's main heading, a button links, and parts take borders, corners and shadows (D49)", async ({ page }) => {
  const slug = `parts-${run}`;
  const published = {
    ...content("Parts", slug, "Unused. "),
    blocks: undefined,
    rows: [
      {
        id: "r1",
        type: "row",
        layout: "1",
        columns: [
          {
            id: "c1",
            htmlId: "card",
            border: { width: { top: 2, right: 2, bottom: 2, left: 2 }, color: "#ff0000", style: "dashed" },
            radius: 16,
            shadow: "lg",
            blocks: [
              { id: "h1", type: "heading", text: "Sell across Europe", level: 1, size: "2xl", textColor: "#112233" },
              {
                id: "b1",
                type: "button",
                label: "Start your store",
                href: "https://example.com/start",
                newTab: true,
                variant: "outline",
                shape: "pill",
                align: { mobile: "center" },
              },
              { id: "b2", type: "button", label: "Not ready", href: "" },
            ],
          },
        ],
      },
    ],
  };
  const sql = testDb();
  try {
    await sql`
      insert into commerce.pages (slug, draft, published, published_at)
      values (${slug}, ${sql.json(published)}, ${sql.json(published)}, now())
    `;
  } finally {
    await sql.end();
  }
  const css = (locator: import("@playwright/test").Locator, property: string) =>
    locator.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), property);

  await page.goto(`/${slug}`);
  // The heading is the page's one main heading: the title is no longer read out in its place.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sell across Europe");
  await expect(page.locator("main h1")).toHaveCount(1);
  expect(await css(page.locator("main h1"), "color")).toBe("rgb(17, 34, 51)");

  const button = page.getByRole("link", { name: "Start your store (opens in a new tab)" });
  await expect(button).toHaveAttribute("href", "https://example.com/start");
  await expect(button).toHaveAttribute("target", "_blank");
  await expect(button).toHaveAttribute("rel", "noopener noreferrer");
  expect(await css(button.locator(".."), "text-align")).toBe("center");
  // A button without an address is not shown.
  await expect(page.getByText("Not ready")).toHaveCount(0);

  const card = page.locator("#card");
  expect(await css(card, "border-top-width")).toBe("2px");
  expect(await css(card, "border-top-style")).toBe("dashed");
  expect(await css(card, "border-top-color")).toBe("rgb(255, 0, 0)");
  expect(await css(card, "border-top-left-radius")).toBe("16px");
  expect(await css(card, "box-shadow")).not.toBe("none");
});

test("a content grid shows pages of a category and a store's products with prices (D51)", async ({ page }) => {
  const sql = testDb();
  const slug = `grid-${run}`;
  let demoId = "";
  let market = "";
  try {
    const [guides] = await sql`
      insert into commerce.terms (store_id, content_type, kind, name, slug)
      values (null, 'page', 'category', ${`Guides ${run}`}, ${`guides-${run}`}) returning id
    `;
    const listed = (title: string, pageSlug: string, categories: string[]) => ({
      ...content(title, pageSlug, "Text. "),
      seo: { title: "", description: `About ${title}` },
      categories,
      tags: [],
    });
    for (const [title, categories] of [
      ["Grid guide one", [guides.id]],
      ["Grid guide two", [guides.id]],
      ["Grid elsewhere", []],
    ] as const) {
      const pageSlug = `${title.toLowerCase().replaceAll(" ", "-")}-${run}`;
      const body = listed(title, pageSlug, [...categories]);
      await sql`
        insert into commerce.pages (slug, draft, published, published_at)
        values (${pageSlug}, ${sql.json(body)}, ${sql.json(body)}, now())
      `;
    }
    const [demo] = await sql`
      select s.id, min(m.code) as market from commerce.stores s join commerce.markets m on m.store_id = s.id and m.active
      where s.slug = 'demo' group by s.id
    `;
    demoId = demo.id;
    market = demo.market;
    const gridBlock = (id: string, extra: Record<string, unknown>) => ({
      id,
      type: "contentGrid",
      categories: [],
      tags: [],
      sort: "newest",
      limit: 6,
      columns: { mobile: 1, tablet: 2, desktop: 3 },
      show: { image: true, heading: true, excerpt: true, price: true, button: true },
      buttonLabel: "",
      emptyText: "",
      headingLevel: 3,
      excerptLines: 3,
      gap: 24,
      ...extra,
    });
    const body = {
      ...content("Grids", slug, "Unused. "),
      blocks: undefined,
      rows: [
        {
          id: "r1",
          type: "row",
          layout: "1",
          columns: [
            {
              id: "c1",
              blocks: [
                gridBlock("pages-grid", { htmlId: "pages-grid", source: { type: "pages" }, categories: [guides.id], sort: "title" }),
                gridBlock("products-grid", {
                  htmlId: "products-grid",
                  source: { type: "products", storeId: demoId, market },
                  limit: 2,
                  sort: "priceLow",
                  buttonLabel: "Buy",
                }),
              ],
            },
          ],
        },
      ],
    };
    await sql`
      insert into commerce.pages (slug, draft, published, published_at)
      values (${slug}, ${sql.json(body)}, ${sql.json(body)}, now())
    `;
  } finally {
    await sql.end();
  }

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${slug}`);
  const pagesGrid = page.locator("#pages-grid");
  await expect(pagesGrid.getByRole("heading", { level: 3 })).toHaveText(["Grid guide one", "Grid guide two"]);
  await expect(pagesGrid.getByRole("link", { name: "Grid guide one", exact: true })).toHaveAttribute(
    "href",
    `/grid-guide-one-${run}`,
  );
  await expect(pagesGrid.getByRole("link", { name: "Read more: Grid guide two" })).toBeVisible();
  await expect(pagesGrid.getByText("About Grid guide one")).toBeVisible();
  // Three columns on a computer.
  const columns = await pagesGrid.locator("ul").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
  expect(columns).toBe(3);

  const productsGrid = page.locator("#products-grid");
  await expect(productsGrid.locator("li")).toHaveCount(2);
  await expect(productsGrid.getByRole("link", { name: /^Buy: / }).first()).toHaveAttribute("href", new RegExp(`^/s/demo/[a-z]+/p/`));
  // Prices come with their VAT label, in the market's language.
  await expect(productsGrid.locator("li").first()).toContainText(/\d/);
});
