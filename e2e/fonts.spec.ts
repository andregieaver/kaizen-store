import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * Google Fonts, self-hosted (D59): a store's own fonts and a component's
 * font come from Kaizen's copies, and the shopper's browser never contacts
 * Google. Fonts are installed here as `installFont` leaves them, so the
 * test needs no network.
 */

const FILE = "0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f.woff2";

const fontCss = (family: string, slug: string, stack: string) =>
  `/* latin */\n@font-face { font-family: '${family}'; font-style: normal; font-weight: 400; font-display: swap; src: url(/api/fonts/files/${FILE}) format('woff2'); }\n` +
  `.kf-${slug}, .kf-${slug} :where(h1, h2, h3, h4, h5, h6) { font-family: "${family}", ${stack}; font-synthesis-weight: none; }\n`;

test("a store's fonts and a component's own font load from Kaizen, never from Google", async ({ page, request }) => {
  const slug = `fonts-${Date.now()}`;
  const sql = testDb();
  try {
    await sql`insert into commerce.font_files (name, data) values (${FILE}, ${Buffer.from("woff2 test")}) on conflict do nothing`;
    await sql`
      insert into commerce.fonts (family, slug, category, css, bytes) values
        ('Lato', 'lato', 'sans-serif', ${fontCss("Lato", "lato", "sans-serif")}, 10),
        ('Pacifico', 'pacifico', 'handwriting', ${fontCss("Pacifico", "pacifico", "cursive")}, 10)
      on conflict (family) do update set css = excluded.css`;
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name)
      values (${`${slug}@example.com`}, 'Kari', 'Karis Kopper') returning id`;
    await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Karis Kopper', null)`;
    const [store] = await sql`update commerce.stores set fonts = '{"heading": "Lato"}'::jsonb where slug = ${slug} returning id`;
    // The page copied from the template gets a heading in a font of its own.
    const rows = [
      {
        id: "r1",
        type: "row",
        layout: "1",
        columns: [
          {
            id: "c1",
            blocks: [
              { id: "b1", type: "heading", text: "Om oss", level: 1 },
              { id: "b2", type: "heading", text: "Laget for hånd", level: 2, font: "Pacifico" },
            ],
          },
        ],
      },
    ];
    await sql`
      update commerce.pages set published = jsonb_set(published, '{rows}', ${sql.json(rows)})
      where store_id = ${store.id} and slug = 'om-oss'`;
  } finally {
    await sql.end();
  }

  const google: string[] = [];
  page.on("request", (r) => {
    if (/googleapis\.com|gstatic\.com/.test(r.url())) google.push(r.url());
  });
  await page.goto(`/s/${slug}/no/om-oss`);

  const family = (text: string) =>
    page.getByRole("heading", { name: text, exact: true }).evaluate((element) => getComputedStyle(element).fontFamily);
  // The store's heading font on its own heading; the component's font on its.
  expect(await family("Om oss")).toMatch(/^"?Lato"?, /);
  expect(await family("Laget for hånd")).toMatch(/^"?Pacifico"?, /);
  // Body text keeps the system's font: the store chose none.
  expect(await page.locator("body").evaluate((b) => getComputedStyle(b).fontFamily)).not.toContain("Lato");

  const hrefs = await page.locator('link[rel="stylesheet"][href^="/api/fonts/"]').evaluateAll((links) =>
    links.map((l) => l.getAttribute("href")),
  );
  expect(hrefs.sort()).toEqual(["/api/fonts/css/lato", "/api/fonts/css/pacifico"]);

  const css = await request.get("/api/fonts/css/lato");
  expect(css.headers()["content-type"]).toContain("text/css");
  expect(await css.text()).toContain(`/api/fonts/files/${FILE}`);
  const file = await request.get(`/api/fonts/files/${FILE}`);
  expect(file.headers()["content-type"]).toBe("font/woff2");
  expect(file.headers()["cache-control"]).toContain("immutable");
  expect((await request.get("/api/fonts/css/not-installed")).status()).toBe(404);
  expect((await request.get("/api/fonts/files/..%2Fsecret.woff2")).status()).toBe(404);

  expect(google).toEqual([]);
});
