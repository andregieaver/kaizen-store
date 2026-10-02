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

test("a picture keeps its own size, shrinks to its column and can be made smaller (D151)", async ({ page, baseURL }) => {
  const slug = `picsize-${run}`;
  const sides = (all: number) => ({ top: all, right: all, bottom: all, left: all });
  // A picture is stored at the size it was uploaded (the builder shrinks to 1600 px). The files are drawn for the test, one of each
  // shape stored, so the browser's own idea of a picture's shape (its natural size) is the one the block says: not square.
  await page.route(/\/e2e-fixture\/(\d+)x(\d+)\.svg$/, (route) => {
    const [, w, h] = new URL(route.request().url()).pathname.match(/(\d+)x(\d+)\.svg$/)!;
    return route.fulfill({
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#3f6b55"/><circle cx="${Number(w) / 2}" cy="${Number(h) / 2}" r="${Math.min(Number(w), Number(h)) / 4}" fill="#e6ece8"/></svg>`,
    });
  });
  const picture = (id: string, width: number, height: number, extra: Record<string, unknown> = {}) => ({
    id,
    type: "image",
    image: { url: `${baseURL}/e2e-fixture/${width}x${height}.svg`, width, height, alt: id },
    caption: "",
    ...extra,
  });
  const longCaption =
    "A caption with a good many words in it, written to be much wider than the narrow picture above it, so that it has to break onto several lines inside the picture's width.";
  const blocks = [
    picture("own", 400, 300),
    picture("wide", 1600, 900),
    picture("smaller", 400, 300, { maxWidth: 200 }),
    picture("centred", 400, 300, { align: { mobile: "center" } }),
    picture("right", 400, 300, { align: { desktop: "right" } }),
    // Centred on phones, at the left of a wide column.
    picture("turns", 200, 150, { align: { mobile: "center", desktop: "left" } }),
    picture("framed", 400, 300, {
      border: { width: sides(2), color: "#ff0000", style: "solid" },
      radius: 12,
      style: { padding: sides(8) },
    }),
    picture("captioned", 400, 300, { caption: longCaption }),
    picture("round", 1600, 900, { shape: "circle" }),
  ];
  const published = {
    ...content("Picture sizes", slug, "Unused. "),
    blocks: undefined,
    // One column of its own for each, so each is measured against the whole content width.
    rows: blocks.map((block) => ({
      id: `r-${block.id}`,
      type: "row",
      layout: "1",
      columns: [{ id: `c-${block.id}`, blocks: [block] }],
    })),
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

  // The picture, the box the block draws around it (its frame) and the column the block sits in. They are measured once the file
  // has loaded, since a lazy picture below the fold only comes in when it is near.
  const measure = async (alt: string) => {
    const img = page.getByRole("img", { name: alt, exact: true });
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), { message: `${alt} loads` }).toBe(true);
    const caption = img.locator("xpath=following-sibling::figcaption");
    return {
      picture: (await img.boundingBox())!,
      wrapper: (await img.locator("xpath=../..").boundingBox())!,
      column: (await img.locator("xpath=../../..").boundingBox())!,
      caption: (await caption.count()) ? (await caption.boundingBox())! : null,
    };
  };
  const near = (actual: number, expected: number, what: string, tolerance = 1) =>
    expect(Math.abs(actual - expected), `${what}: ${actual} against ${expected}`).toBeLessThanOrEqual(tolerance);

  // A computer: one column as wide as the content (about 984 px).
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(`/${slug}`);
  const own = await measure("own");
  const column = own.column.width;
  expect(column, "the column is wide enough for the sizes below").toBeGreaterThan(900);

  // Its own size, not the column's, at the column's left.
  near(own.picture.width, 400, "a 400 px picture is drawn at 400 px");
  near(own.picture.x, own.column.x, "and sits at the column's left");
  // The block's box is as wide as the picture, so nothing around it is drawn over empty space.
  near(own.wrapper.width, 400, "the block's box is the picture's width");
  near(own.picture.height, 300, "and its height is its own, not stretched or squeezed");

  // A picture bigger than its column fills the column and goes no further.
  const wide = await measure("wide");
  near(wide.picture.width, wide.column.width, "a 1600 px picture fills the column");
  near(wide.wrapper.width, wide.column.width, "its box is the column");
  near(wide.picture.x, wide.column.x, "from the column's left");
  near(wide.picture.height, (wide.column.width * 900) / 1600, "keeping its shape");

  // A width setting makes it narrower.
  const smaller = await measure("smaller");
  near(smaller.picture.width, 200, "a width of 200 px on a 400 px picture");
  near(smaller.wrapper.width, 200, "the box follows");
  near(smaller.picture.height, 150, "and the height with it, in the picture's own proportions");

  // Alignment places a picture narrower than its column: the middle, or the right.
  const centred = await measure("centred");
  near(centred.picture.width, 400, "a centred picture keeps its size");
  near(centred.picture.x + centred.picture.width / 2, centred.column.x + centred.column.width / 2, "and is in the column's middle");
  const right = await measure("right");
  near(right.picture.width, 400, "a picture to the right keeps its size");
  near(right.picture.x + right.picture.width, right.column.x + right.column.width, "and ends at the column's right");
  const turns = await measure("turns");
  near(turns.picture.width, 200, "a 200 px picture");
  near(turns.picture.x, turns.column.x, "is at the left of a computer's column when only phones are centred");

  // The frame hugs the picture: its border and padding are around it, not around the column.
  const framed = await measure("framed");
  near(framed.picture.width, 400, "a framed picture keeps its own width inside its padding and border");
  near(framed.wrapper.width, 400 + 2 * 8 + 2 * 2, "its box is the picture, the padding and the border");
  near(framed.wrapper.height, framed.picture.height + 2 * 8 + 2 * 2, "on every side");
  near(framed.picture.x - framed.wrapper.x, 8 + 2, "the picture sits inside the left edge");
  near(framed.picture.y - framed.wrapper.y, 8 + 2, "and the top edge");
  near(framed.wrapper.x, framed.column.x, "and the box is at the column's left");

  // A caption is under the picture and no wider than it; it breaks into lines instead of widening the box.
  const captioned = await measure("captioned");
  near(captioned.picture.width, 400, "a captioned picture keeps its size");
  expect(captioned.caption, "the caption is drawn").not.toBeNull();
  expect(captioned.caption!.width, "a long caption stays within the picture").toBeLessThanOrEqual(captioned.picture.width + 1);
  expect(captioned.caption!.height, "and breaks into lines").toBeGreaterThanOrEqual(40);
  near(captioned.caption!.x, captioned.picture.x, "under the picture's left edge");
  expect(captioned.caption!.y, "below it").toBeGreaterThanOrEqual(captioned.picture.y + captioned.picture.height - 1);

  // A crop is the largest crop that fits inside the picture's own pixels (900 x 900 from 1600 x 900), square for a circle.
  const round = await measure("round");
  near(round.picture.width, 900, "a circle cut from 1600 x 900 is 900 px across");
  near(round.picture.height, round.picture.width, "and square");

  // A phone: a picture wider than the column shrinks to it, keeping its shape, and the page does not scroll sideways.
  await page.setViewportSize({ width: 390, height: 800 });
  const phoneOwn = await measure("own");
  expect(phoneOwn.column.width, "a phone's column is narrower than the picture").toBeLessThan(400);
  near(phoneOwn.picture.width, phoneOwn.column.width, "a 400 px picture shrinks to the column");
  near(phoneOwn.picture.x, phoneOwn.column.x, "from the column's left");
  const phoneWide = await measure("wide");
  near(phoneWide.picture.width, phoneWide.column.width, "a 1600 px picture is the column's width on a phone");
  const phoneRound = await measure("round");
  near(phoneRound.picture.width, phoneRound.column.width, "a circle shrinks to the column");
  near(phoneRound.picture.height, phoneRound.picture.width, "and stays square");
  const phoneCaptioned = await measure("captioned");
  expect(phoneCaptioned.caption!.width, "a caption stays within the picture on a phone").toBeLessThanOrEqual(phoneCaptioned.picture.width + 1);
  // Alignment by screen: centred on a phone, the computer's own at the left or the right.
  const phoneTurns = await measure("turns");
  near(phoneTurns.picture.width, 200, "a picture narrower than the column keeps its size on a phone");
  near(phoneTurns.picture.x + phoneTurns.picture.width / 2, phoneTurns.column.x + phoneTurns.column.width / 2, "and is centred when phones are");
  const phoneRight = await measure("right");
  near(phoneRight.picture.x, phoneRight.column.x, "a picture placed right on computers only is at the left on a phone");
  const phoneSmaller = await measure("smaller");
  near(phoneSmaller.picture.x, phoneSmaller.column.x, "and so is one with no alignment");
  const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, window: window.innerWidth }));
  expect(overflow.scroll, "no sideways scrolling on a phone").toBeLessThanOrEqual(overflow.window);
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
