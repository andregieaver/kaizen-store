import { expect, test } from "@playwright/test";
import type postgres from "postgres";

import { newPageContent, pageInput, type ContentGridBlock, type CustomGridItem } from "../src/lib/page-content";
import { newBlock } from "../src/lib/page-rows";

import { testDb } from "./db";

/**
 * A grid of custom items (D155) as the owner leaves it and the site shows it: three items written by hand (the block the
 * builder saves, checked by the page's own schema), shown as a grid, as a carousel, and in another market's language; and
 * never in what search engines and AI assistants are told.
 */

const slug = `grid-${Date.now().toString(36)}`;
// A picture of a custom item is the library's or the site's own: here a file of the site.
const PICTURE = "/demo/notebook.svg";

const items: CustomGridItem[] = [
  {
    id: "i1",
    title: "Fjordtur",
    text: "En dag på vannet med lunsj.",
    picture: { url: PICTURE, width: 640, height: 480, alt: "En båt på fjorden" },
    link: { kind: "page", slug: "om-oss" },
    buttonLabel: "",
    date: "2026-05-17",
    badge: "Ny",
    priceText: "Fra 199 kr",
    details: [{ id: "d1", label: "Varighet", text: "6 timer" }],
  },
  { id: "i2", title: "Fjelltur", text: "Til toppen og tilbake.", picture: null, link: { kind: "url", url: "https://example.com/fjell" }, buttonLabel: "Book nå", date: null, badge: "", priceText: "Fra 299 kr", details: [] },
  { id: "i3", title: "Sykkeltur", text: "", picture: { url: PICTURE, width: 640, height: 480, alt: "En sykkel på stien" }, link: null, buttonLabel: "", date: null, badge: "-20 %", priceText: "", details: [] },
  // Nothing to show: left out, not drawn as a gap.
  { id: "i4", title: "", text: "", picture: null, link: { kind: "home" }, buttonLabel: "Aldri", date: null, badge: "Aldri synlig", priceText: "Aldri pris", details: [] },
];

// A logo strip: only pictures, each a link, with no heading or button to carry it (the picture is the link for everyone).
const logos: CustomGridItem[] = ["ACME", "Globex", "Initech"].map((name, index) => ({
  id: `l${index + 1}`,
  title: "",
  text: "",
  picture: { url: PICTURE, width: 320, height: 160, alt: name },
  link: { kind: "url", url: `https://example.com/${name.toLowerCase()}` },
  buttonLabel: "",
  date: null,
  badge: "",
  priceText: "",
  details: [],
}));

const grid = (id: string, over: Partial<ContentGridBlock> = {}): ContentGridBlock => ({
  ...(newBlock("contentGrid", () => id) as ContentGridBlock),
  source: { type: "custom" },
  limit: 60,
  columns: { mobile: 1, tablet: 2, desktop: 3 },
  items,
  ...over,
});

const content = (blocks: ContentGridBlock[], extra: Record<string, unknown> = {}): postgres.JSONValue => {
  const page = {
    ...newPageContent(),
    title: "Turer",
    slug: "turer",
    rows: blocks.map((block, index) => ({ id: `row-${index}`, type: "row" as const, layout: "1" as const, columns: [{ id: `column-${index}`, blocks: [block] }] })),
    ...extra,
  };
  // What the builder saves is what the page's own schema accepts.
  const parsed = pageInput.safeParse(page);
  expect(parsed.error?.issues).toBeUndefined();
  return page as unknown as postgres.JSONValue;
};

test.beforeAll(async () => {
  const sql = testDb();
  try {
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Testbutikk') returning id`;
    const [{ id }] = await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Testbutikk', null) as id`;
    // A new store sells in its own country alone (D178): the Swedish storefront needs Several countries.
    await sql`update commerce.stores set features = features || array['countries'] where id = ${id}`;
    const swedish = {
      "sv-SE": {
        "block.grid.i1.title": "Fjordtur på svenska",
        "block.grid.i1.text": "En dag på vattnet med lunch.",
        "block.grid.i1.badge": "Ny!",
        "block.grid.i1.priceText": "Från 199 kr",
        "block.grid.i3.alt": "En cykel på stigen",
        "block.grid.i1.detail-d1.label": "Längd",
        "block.grid.i1.detail-d1.text": "6 timmar",
        "block.grid.i2.buttonLabel": "Boka nu",
      },
    };
    const pages: [string, postgres.JSONValue][] = [
      ["turer", content([grid("grid")], { translations: swedish })],
      ["karusell", content([grid("grid", { display: "carousel", columns: { mobile: 1, tablet: 2, desktop: 2 } })])],
      ["logoer", content([grid("logos", { items: logos, columns: { mobile: 2, tablet: 3, desktop: 3 }, show: { image: true, heading: false, excerpt: false, price: false, button: false } })])],
    ];
    for (const [page, body] of pages) {
      await sql`
        insert into commerce.pages (store_id, slug, draft, published, published_at)
        values (${id}, ${page}, ${sql.json(body)}, ${sql.json(body)}, now())`;
    }
  } finally {
    await sql.end();
  }
});

test("shows the items as a grid, in order, with the empty one left out", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/s/${slug}/no/turer`);
  const tiles = page.locator("main li[data-item-id]");
  await expect(tiles).toHaveCount(3);
  await expect(tiles.locator("h3")).toHaveText(["Fjordtur", "Fjelltur", "Sykkeltur"]);
  await expect(page.locator("main [data-carousel-track]")).toHaveCount(0);
  // Three to a row on a computer.
  const boxes = await Promise.all([0, 1, 2].map((i) => tiles.nth(i).boundingBox()));
  expect(new Set(boxes.map((box) => Math.round(box!.y))).size).toBe(1);

  const first = tiles.nth(0);
  await expect(first.getByText("En dag på vannet med lunsj.")).toBeVisible();
  await expect(first.getByText("Ny", { exact: true })).toBeVisible();
  await expect(first.getByText("Varighet:")).toBeVisible();
  await expect(first.getByText("6 timer")).toBeVisible();
  await expect(first.locator("time")).toHaveAttribute("datetime", "2026-05-17");
  // A linked item's picture is for pointing (its heading and button are the links): decoration for a screen reader.
  await expect(first.locator("img")).toHaveAttribute("alt", "");
  await expect(first.locator("a[aria-hidden='true'] img")).toHaveCount(1);
  // The price is the owner's words: no VAT label, no cart.
  await expect(first.getByText("Fra 199 kr", { exact: true })).toBeVisible();
  await expect(tiles.getByText(/moms/i)).toHaveCount(0);
  await expect(tiles.getByRole("button")).toHaveCount(0);
  // The link is by slug in the market; the button says what the market's language says, or the item's own.
  await expect(first.getByRole("link", { name: "Les mer: Fjordtur" })).toHaveAttribute("href", `/s/${slug}/no/om-oss`);
  const mountain = tiles.nth(1).getByRole("link", { name: "Book nå: Fjelltur" });
  await expect(mountain).toHaveAttribute("href", "https://example.com/fjell");
  await expect(mountain).toHaveAttribute("rel", "noopener noreferrer");
  // An item without a link has no button and a plain heading.
  await expect(tiles.nth(2).getByRole("link")).toHaveCount(0);
  await expect(tiles.nth(2).getByText("-20 %")).toBeVisible();
  // Its picture has no link round it, so its own description says what it shows.
  await expect(tiles.nth(2).getByRole("img", { name: "En sykkel på stien" })).toBeVisible();
  await expect(page.getByText("Aldri")).toHaveCount(0);
});

test("shows the same items as a carousel with arrows when set to scroll sideways", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/s/${slug}/no/karusell`);
  const track = page.locator("main [data-carousel-track]");
  await expect(track).toBeVisible();
  await expect(track.locator("li[data-item-id]")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Forrige" })).toBeAttached();
  await expect(page.getByRole("button", { name: "Neste" })).toBeAttached();
  // Two columns to a screen, so the third item lies beyond the row's width until the row is moved.
  const place = await track.evaluate((el) => ({ width: el.clientWidth, third: (el.children[2] as HTMLElement).offsetLeft, first: (el.children[0] as HTMLElement).offsetWidth }));
  expect(place.third).toBeGreaterThanOrEqual(place.width);
  expect(place.first).toBeLessThan(place.width / 2);
  await page.getByRole("button", { name: "Neste" }).click();
  await expect.poll(() => track.evaluate((el) => el.scrollLeft)).toBeGreaterThan(50);
});

test("reads in the market's language where the items are translated, else as written", async ({ page }) => {
  await page.goto(`/s/${slug}/se/turer`);
  await expect(page.locator("html")).toHaveAttribute("lang", "sv");
  const tiles = page.locator("main li[data-item-id]");
  await expect(tiles.locator("h3")).toHaveText(["Fjordtur på svenska", "Fjelltur", "Sykkeltur"]);
  const first = tiles.nth(0);
  await expect(first.getByText("En dag på vattnet med lunch.")).toBeVisible();
  await expect(first.getByText("Ny!", { exact: true })).toBeVisible();
  await expect(first.getByText("Från 199 kr", { exact: true })).toBeVisible();
  await expect(first.getByText("Längd:")).toBeVisible();
  await expect(first.getByText("6 timmar")).toBeVisible();
  await expect(tiles.nth(2).getByRole("img", { name: "En cykel på stigen" })).toBeVisible();
  // The link still goes to the page in this market; the button reads in Swedish unless the item has words of its own.
  await expect(first.getByRole("link", { name: "Läs mer: Fjordtur på svenska" })).toHaveAttribute("href", `/s/${slug}/se/om-oss`);
  await expect(tiles.nth(1).getByRole("link", { name: "Boka nu: Fjelltur" })).toBeVisible();
  // An item with no translation reads as written.
  await expect(tiles.nth(1).getByText("Til toppen og tilbake.")).toBeVisible();
});

test("is never in what search engines and AI assistants are told", async ({ page, request }) => {
  const response = await page.goto(`/s/${slug}/no/turer`);
  expect(response?.status()).toBe(200);
  const jsonLd = await page.locator('script[type="application/ld+json"]').allTextContents();
  const told = jsonLd.join("\n");
  for (const word of ["Fjordtur", "Fra 199 kr", "Sykkeltur", "Ny"]) expect(told, word).not.toContain(word);
  // The page's description is its own words, and the items are not them.
  const description = (await page.locator('meta[name="description"]').getAttribute("content")) ?? "";
  expect(description).not.toContain("Fjordtur");
  expect(description).not.toContain("Fra 199 kr");
  for (const path of [`/s/${slug}/llms.txt`, "/sitemap.xml", `/s/${slug}/sitemap.xml`]) {
    const text = await (await request.get(path)).text();
    for (const word of ["Fjordtur", "Fra 199 kr", "Sykkeltur"]) expect(text, `${path}: ${word}`).not.toContain(word);
  }
});

test("a logo strip's pictures are the links: reachable by keyboard and named by their descriptions", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/s/${slug}/no/logoer`);
  const links = page.locator("main li[data-item-id] a");
  await expect(links).toHaveCount(3);
  // Named by what the owner wrote about each picture, not hidden from screen readers or the Tab key.
  for (const [index, name] of ["ACME", "Globex", "Initech"].entries()) {
    const link = page.getByRole("link", { name });
    await expect(link).toHaveAttribute("href", `https://example.com/${name.toLowerCase()}`);
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(link).not.toHaveAttribute("tabindex", "-1");
    await expect(link).not.toHaveAttribute("aria-hidden", "true");
    await expect(link.locator("img")).toHaveAttribute("alt", name);
    expect(index).toBeLessThan(3);
  }
  // Tab reaches the first, then the next, each with a visible outline.
  const first = page.getByRole("link", { name: "ACME" });
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press("Tab");
    if (await first.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(first).toBeFocused();
  await expect(first).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Globex" })).toBeFocused();
});
