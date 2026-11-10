import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { storePageWith, testDb } from "./db";

/**
 * The Animation component (D538): a see-through animation plays once when it comes into view and rests on its last frame as a
 * picture; a visitor who prefers less motion gets the picture at once and no video is asked for; it is sized, placed and
 * linked as a picture is. A header's logo that is an animation plays once a visit. Its files (`e2e/fixtures/animation/`: the video with the picture above its mask, and the last
 * frame) are answered here, as the site's storage would.
 */

const base = `http://localhost:${process.env.PORT ?? 3000}`;
const fixture = (name: string) => readFileSync(path.join(process.cwd(), "e2e/fixtures/animation", name));
const file = {
  video: { url: `${base}/e2e-animation/clip.mp4` },
  still: { url: `${base}/e2e-animation/still.png`, width: 320, height: 180 },
  width: 320,
  height: 180,
};
const block = (over: Record<string, unknown> = {}) => ({ id: "anim", type: "animation", animation: file, alt: "A disc crossing the picture", htmlId: "anim", ...over });

/** Answers the animation's two files and counts how often the video is asked for. */
async function serve(page: Page): Promise<{ videoAsked: () => number }> {
  let asked = 0;
  const headers = { "access-control-allow-origin": "*", "accept-ranges": "bytes" };
  await page.route("**/e2e-animation/clip.mp4", (route) => {
    asked += 1;
    return route.fulfill({ status: 200, contentType: "video/mp4", headers, body: fixture("clip.mp4") });
  });
  await page.route("**/e2e-animation/still.png", (route) => route.fulfill({ status: 200, contentType: "image/png", headers, body: fixture("still.png") }));
  // Every stage the player goes through, as the page marks it.
  await page.addInitScript(() => {
    const stages: string[] = [];
    (window as unknown as { kzStages: string[] }).kzStages = stages;
    new MutationObserver(() => {
      const stage = document.querySelector("[data-kz-animation]")?.getAttribute("data-kz-animation");
      if (stage && stages.at(-1) !== stage) stages.push(stage);
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-kz-animation"] });
  });
  return { videoAsked: () => asked };
}
const stages = (page: Page) => page.evaluate(() => (window as unknown as { kzStages: string[] }).kzStages);
/** Whether this browser plays the video at all (Chromium as Playwright ships it has not always had H.264). */
const playsH264 = (page: Page) => page.evaluate(() => document.createElement("video").canPlayType('video/mp4; codecs="avc1.640028"') !== "");

test("plays once when it comes into view, then rests on its last frame as a picture and lets the video go", async ({ page }) => {
  const files = await serve(page);
  const url = await storePageWith("animasjon", [block()]);
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(url);
  const animation = page.locator("#anim [data-kz-animation]");
  await expect(animation).toBeAttached();
  // Its description is there from the start, for a screen reader, though the picture is not shown yet.
  await expect(animation.locator("img").first()).toHaveAttribute("alt", "A disc crossing the picture");
  await expect(animation).toHaveAttribute("data-kz-animation", "rest", { timeout: 15_000 });
  await expect(animation.getByRole("img", { name: "A disc crossing the picture" })).toBeVisible();
  await expect(animation.locator("canvas")).toHaveCount(0);
  await expect(animation.locator("video")).toHaveCount(0);
  if (await playsH264(page)) {
    expect(await stages(page)).toEqual(["wait", "play", "rest"]);
    expect(files.videoAsked()).toBeGreaterThan(0);
  }
  // As wide as its picture, in the picture's shape.
  const box = (await animation.boundingBox())!;
  expect(Math.round(box.width)).toBe(320);
  expect(Math.round(box.height)).toBe(180);
});

test.describe("for a visitor who prefers less motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("it is the picture at once, and the video is never asked for", async ({ page }) => {
    const files = await serve(page);
    const url = await storePageWith("animasjon-rolig", [block()]);
    await page.goto(url);
    const animation = page.locator("#anim [data-kz-animation]");
    await expect(animation).toHaveAttribute("data-kz-animation", "rest");
    await expect(animation.getByRole("img", { name: "A disc crossing the picture" })).toBeVisible();
    await page.waitForTimeout(500);
    expect(files.videoAsked()).toBe(0);
    expect(await stages(page)).not.toContain("play");
  });
});

test("set to go round it keeps playing, and it is drawn no wider than asked and leads where it is told", async ({ page }) => {
  await serve(page);
  const url = await storePageWith("animasjon-rundt", [block({ loop: true, maxWidth: 160, href: "/om-oss", newTab: true })]);
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(url);
  const animation = page.locator("#anim [data-kz-animation]");
  await expect(animation).toBeAttached();
  const link = page.locator("#anim a");
  // A page's own address, as the site writes every link inside a store.
  await expect(link).toHaveAttribute("href", /\/om-oss$/);
  await expect(link).toHaveAttribute("target", "_blank");
  expect(Math.round((await animation.boundingBox())!.width)).toBe(160);
  if (await playsH264(page)) {
    await expect(animation).toHaveAttribute("data-kz-animation", "play", { timeout: 15_000 });
    // The film is a second and a half: still playing well after, it went round.
    await page.waitForTimeout(3000);
    await expect(animation).toHaveAttribute("data-kz-animation", "play");
    await expect(animation.locator("canvas")).toHaveCount(1);
  }
});

test("on a phone it is no wider than its place and keeps its shape, also centred in its column", async ({ page }) => {
  await serve(page);
  const url = await storePageWith("animasjon-smal", [block({ align: "center" })]);
  await page.setViewportSize({ width: 280, height: 700 });
  await page.goto(url);
  const animation = page.locator("#anim [data-kz-animation]");
  await expect(animation).toHaveAttribute("data-kz-animation", "rest", { timeout: 15_000 });
  const box = (await animation.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(280);
  expect(box.width).toBeLessThan(320);
  expect(Math.abs(box.width / box.height - 320 / 180)).toBeLessThan(0.02);
  // And the page does not scroll sideways for it.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("without its files it draws nothing", async ({ page }) => {
  const url = await storePageWith("animasjon-tom", [block({ animation: null }), { id: "h", type: "heading", text: "Still here", level: 2 }]);
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Still here" })).toBeVisible();
  await expect(page.locator("[data-kz-animation]")).toHaveCount(0);
});

test("a header's logo that is an animation plays once a visit: on the next page it is the logo from the start", async ({ page }) => {
  const files = await serve(page);
  const slug = `animert-logo-${Date.now().toString(36)}`;
  const layout = (title: string, blocks: unknown[]) => ({
    title,
    slug: title.toLowerCase(),
    thumbnail: null,
    seo: { title: "", description: "" },
    searchEngines: true,
    aiAssistants: true,
    categories: [],
    tags: [],
    rows: [{ id: `${title}-r`, type: "row", layout: "1", columns: [{ id: `${title}-c`, inline: true, blocks }] }],
  });
  const sql = testDb();
  try {
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name)
      values (${`${slug}@example.com`}, 'Test', 'Animert Butikk') returning id`;
    const [{ id }] = await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Animert Butikk', null) as id`;
    const add = (type: string, value: ReturnType<typeof layout>) => sql`
      insert into commerce.pages (store_id, type, slug, draft, published, published_at)
      values (${id}, ${type}, ${value.slug}, ${sql.json(value as never)}, ${sql.json(value as never)}, now()) returning id`;
    const [[header]] = await Promise.all([
      add("header", layout("Topp", [{ id: "logo", type: "site", part: "logo", animation: file }])),
      add("page", layout("Hjem", [{ id: "h", type: "heading", text: "Hjem", level: 1 }])),
      add("page", layout("Om", [{ id: "o", type: "heading", text: "Om oss", level: 1 }])),
    ]);
    await sql`update commerce.stores set header_id = ${header.id} where id = ${id}`;
  } finally {
    await sql.end();
  }

  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(`/s/${slug}/hjem`);
  const logo = page.locator("header [data-kz-animation]");
  // In the logo's place: the site's name to a screen reader, the way home, as tall as a header's logo and as wide as its shape.
  await expect(logo.locator("img").first()).toHaveAttribute("alt", "Animert Butikk");
  await expect(page.locator("header a").filter({ has: page.locator("[data-kz-animation]") })).toHaveAttribute("href", new RegExp(`/s/${slug}$`));
  await expect(logo).toHaveAttribute("data-kz-animation", "rest", { timeout: 15_000 });
  const box = (await logo.boundingBox())!;
  expect(Math.round(box.height)).toBe(40);
  expect(Math.round(box.width)).toBe(71);
  if (!(await playsH264(page))) return;
  expect(await stages(page)).toEqual(["wait", "play", "rest"]);
  const asked = files.videoAsked();
  expect(asked).toBeGreaterThan(0);

  // The next page of the visit: marked as seen by the page itself, the logo is shown before any script of ours, and nothing plays.
  await page.goto(`/s/${slug}/om`);
  await expect(logo).toHaveAttribute("data-kz-seen", "");
  expect(await logo.locator("img").first().evaluate((picture) => getComputedStyle(picture).opacity)).toBe("1");
  await expect(logo).toHaveAttribute("data-kz-animation", "rest");
  await expect(logo.getByRole("img", { name: "Animert Butikk" })).toBeVisible();
  expect(await stages(page)).not.toContain("play");
  expect(files.videoAsked()).toBe(asked);
});
