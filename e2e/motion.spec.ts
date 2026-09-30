import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * Motion on pages (D128): entrances, scroll and background effects owners pick from lists. Arranged in the database, as the
 * page builder saves it. What matters: content is always there (no scripts, "reduce motion"), a waypoint entrance waits
 * below the fold and plays when it is reached, and the page's first row never waits for scripts or starts transparent.
 */

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const heading = (id: string, text: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "heading",
  text,
  level: 2,
  ...extra,
});
const words = (id: string, text: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "richText",
  doc: doc(text),
  ...extra,
});
/** A row as tall as the screen, so the next one is below the fold. */
const row = (id: string, blocks: unknown[], extra: Record<string, unknown> = {}) => ({
  id,
  type: "row",
  layout: "1",
  columns: [{ id: `${id}-c`, blocks }],
  fullHeight: true,
  ...extra,
});

async function arrange(rows: unknown[]): Promise<string> {
  const slug = `motion-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const sql = testDb();
  try {
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name)
      values (${`${slug}@example.com`}, 'Siri', 'Bevegelsesbutikk') returning id`;
    const [{ id: storeId }] =
      await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Bevegelsesbutikk', null) as id`;
    const content = {
      title: "Bevegelse",
      slug: "bevegelse",
      thumbnail: null,
      seo: { title: "", description: "" },
      searchEngines: true,
      aiAssistants: true,
      categories: [],
      tags: [],
      rows,
    };
    await sql`
      insert into commerce.pages (store_id, type, slug, draft, published, published_at)
      values (${storeId}, 'page', 'bevegelse', ${sql.json(content as never)}, ${sql.json(content as never)}, now())`;
  } finally {
    await sql.end();
  }
  return `/s/${slug}/no/bevegelse`;
}

const HERO = "Velkommen til verkstedet";
const STORY = "Historien om keramikken";
const BELOW = "Nederst på siden";
const LATER = "Her kommer teksten inn";

const rows = (picture: string) => [
  row("hero", [heading("h1", HERO, { level: 1, motion: { enter: { effect: "fade-up", delay: 200 } } })]),
  row("pic", [
    {
      id: "img",
      type: "image",
      image: { url: picture, width: 800, height: 600, alt: "Et krus" },
      caption: "",
      motion: { enter: { effect: "fade", delay: 1500 } },
    },
  ]),
  row("story", [
    heading("h2", STORY, { motion: { enter: { effect: "words" } } }),
    words("t1", LATER, { motion: { enter: { effect: "fade-up" } } }),
  ]),
  row("bottom", [heading("h3", BELOW, { motion: { enter: { effect: "zoom-in", once: false } } })], {
    background: {
      type: "gradient",
      style: "aurora",
      colors: ["#123456", "#345678", "#567890"],
      flow: "slow",
      grain: true,
    },
    backgroundMotion: { effect: "drift" },
  }),
];

test("all the content is on the page without scripts, and nothing waits for a waypoint", async ({
  browser,
  baseURL,
}) => {
  const address = await arrange(rows(`${baseURL}/demo/mug.svg`));
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(address);
  for (const text of [HERO, STORY, BELOW, LATER]) await expect(page.getByText(text).first()).toBeAttached();
  // What would wait for a waypoint is shown: with no scripting the stylesheet leaves nothing hidden.
  for (const text of [STORY, LATER, BELOW]) await expect(page.getByText(text).first()).toBeVisible();
  const waiting = page.locator('[data-fx-trigger="view"]');
  await expect(waiting).toHaveCount(4);
  for (const element of await waiting.all()) await expect(element).toHaveCSS("opacity", "1");
  await context.close();
});

test("an entrance below the fold waits, then plays when it is reached; the first row plays at once, by CSS", async ({
  page,
  baseURL,
}) => {
  const address = await arrange(rows(`${baseURL}/demo/mug.svg`));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(address);
  await expect(page.locator("html")).toHaveAttribute("data-fx-ready", "");

  // The hero's own entrance is CSS: `load`, with no waypoint, and it is a heading like any other in the HTML.
  const hero = page.locator('[data-fx-enter="fade-up"][data-fx-trigger="load"]');
  await expect(hero).toHaveCount(1);
  await expect(hero).toContainText(HERO);
  await expect(hero).toHaveCSS("opacity", "1", { timeout: 5000 });

  // Below the fold it waits: shown from its start state (transparent), not yet marked in.
  const later = page.locator('[data-fx-enter="fade-up"][data-fx-trigger="view"]');
  await expect(later).toHaveCount(1);
  await expect(later).not.toHaveAttribute("data-fx-in", "");
  await expect(later).toHaveCSS("opacity", "0");
  // Its words are in the page whole, for search engines and screen readers.
  await expect(later).toContainText(LATER);

  await later.scrollIntoViewIfNeeded();
  await expect(later).toHaveAttribute("data-fx-in", "");
  await expect(later).toHaveCSS("opacity", "1", { timeout: 5000 });

  // Split text: the heading keeps its name, its pieces are hidden from screen readers, and they come in.
  const story = page.locator('[data-fx-text][data-fx-enter="words"]');
  await story.scrollIntoViewIfNeeded();
  await expect(story).toHaveAttribute("data-fx-in", "");
  await expect(story.getByRole("heading", { name: STORY })).toHaveAttribute("aria-label", STORY);
  await expect(story.locator("[data-fx-w]")).toHaveCount(STORY.split(" ").length);
  await expect(story.locator('[aria-hidden="true"] [data-fx-w]').first()).toHaveCSS("opacity", "1", { timeout: 5000 });
  await expect(story).toContainText(STORY);
});

test("an entrance set to play again plays each time it comes into view", async ({ page, baseURL }) => {
  const address = await arrange(rows(`${baseURL}/demo/mug.svg`));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(address);
  const again = page.locator("[data-fx-repeat]");
  await expect(again).toHaveCount(1);
  await again.scrollIntoViewIfNeeded();
  await expect(again).toHaveAttribute("data-fx-in", "");
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(again).not.toHaveAttribute("data-fx-in", "");
  await again.scrollIntoViewIfNeeded();
  await expect(again).toHaveAttribute("data-fx-in", "");
});

test("with reduced motion everything is shown and nothing moves or waits", async ({ page, baseURL }) => {
  const address = await arrange(rows(`${baseURL}/demo/mug.svg`));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(address);
  for (const element of await page.locator("[data-fx-enter]").all()) {
    await expect(element).toHaveCSS("opacity", "1");
    await expect(element).toHaveCSS("animation-name", "none");
    await expect(element).toHaveCSS("transform", "none");
  }
  // No runtime: nothing was split or marked, and no gradient moves.
  await expect(page.locator("[data-fx-w]")).toHaveCount(0);
  await expect(page.locator("[data-fx-in]")).toHaveCount(0);
  await expect(page.locator("[data-fx-grad]")).toHaveCSS("animation-name", "none");
  for (const text of [HERO, STORY, LATER, BELOW]) await expect(page.getByText(text).first()).toBeVisible();
});

test("the page's first picture never starts transparent, so the largest thing painted is not waiting for a fade", async ({
  page,
  baseURL,
}) => {
  // The picture is the first row's, with a fade set to start after 1.5 s: until then it is shown from its start state.
  const picture = `${baseURL}/demo/mug.svg`;
  const address = await arrange([
    row(
      "pic",
      [
        {
          id: "img",
          type: "image",
          image: { url: picture, width: 800, height: 600, alt: "Et krus" },
          caption: "",
          motion: { enter: { effect: "fade", delay: 1500 } },
        },
      ],
      { style: { padding: { top: 0, right: 0, bottom: 0, left: 0 } } },
    ),
    row("after", [heading("h", STORY)]),
  ]);
  await page.goto(address);
  const block = page.locator('[data-fx-enter="fade"]');
  await expect(block).toHaveAttribute("data-fx-nofade", "");
  await expect(block).toHaveAttribute("data-fx-trigger", "load");
  // Sampled while its delay runs: not transparent.
  await expect(block).not.toHaveCSS("opacity", "0");
  const lcp = await page.evaluate(
    () =>
      new Promise<{ tag: string | undefined; opacity: string | undefined }>((resolve) => {
        new PerformanceObserver((list) => {
          const last = list.getEntries().at(-1) as (PerformanceEntry & { element?: Element }) | undefined;
          resolve({
            tag: last?.element?.tagName,
            opacity: last?.element ? getComputedStyle(last.element).opacity : undefined,
          });
        }).observe({ type: "largest-contentful-paint", buffered: true });
      }),
  );
  expect(lcp.opacity).not.toBe("0");
});

test("a gradient background is drawn with CSS alone, behind its row's content, and moves by itself", async ({
  page,
  baseURL,
}) => {
  const address = await arrange(rows(`${baseURL}/demo/mug.svg`));
  await page.goto(address);
  const gradient = page.locator('[data-fx-grad="aurora"]');
  await expect(gradient).toHaveCount(1);
  await expect(page.locator('[data-fx-flow="slow"] [data-fx-blob]')).toHaveCount(3);
  await expect(page.locator("[data-fx-blob]").first()).toHaveCSS("animation-name", /fx-blob-a/);
  // Behind the text, which stays readable and reachable.
  const behind = await page.locator("[data-fx-gradient]").evaluate((element) => getComputedStyle(element).zIndex);
  expect(behind).toBe("-10");
  await expect(page.getByText(BELOW)).toBeAttached();
  // The slow drift is on the background's layer, running on its own.
  await expect(page.locator('[data-fx-layer][data-fx-bgm="drift"]')).toHaveCSS("animation-name", /fx-drift/);
});
