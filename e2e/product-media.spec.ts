import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * Videos and 3D models in a product's gallery (wave 6 unit G, D325): a product page shows its items in the owner's order, an uploaded video
 * in the browser's own player (never playing by itself), a YouTube video only once pressed, and a 3D model only once *View in 3D* is
 * pressed, which loads `<model-viewer>` then and not before. The files are served by the test: nothing is fetched from another site.
 */

const VIDEO = "https://media.example/clip.mp4";
const MODEL = "https://media.example/triangle.glb";

async function storeWithGallery(): Promise<string> {
  const slug = `media-${Date.now().toString(36)}`;
  const sql = testDb();
  try {
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Testbutikk') returning id`;
    const [{ id }] = await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Testbutikk', null) as id`;
    const [product] = await sql`select id from commerce.products where store_id = ${id} and handle = 'demo-keramikkopp'`;
    await sql`delete from commerce.product_media where product_id = ${product.id}`;
    const alt = (text: string) => sql.json({ "nb-NO": text });
    await sql`
      insert into commerce.product_media (store_id, product_id, position, kind, source, media_url, url, alt) values
        (${id}, ${product.id}, 0, 'video', 'upload', ${VIDEO}, '/demo/mug.svg', ${alt("Slik brukes koppen")}),
        (${id}, ${product.id}, 1, 'image', null, null, '/demo/mug-black.svg', ${alt("Svart kopp")}),
        (${id}, ${product.id}, 2, 'video', 'youtube', 'https://youtu.be/dQw4w9WgXcQ', '/demo/mug.svg', ${alt("Koppen i bruk")}),
        (${id}, ${product.id}, 3, 'model', null, ${MODEL}, '/demo/mug.svg', ${alt("Koppen i 3D")})`;
    return slug;
  } finally {
    await sql.end();
  }
}

test("a product's gallery shows its videos and 3D model in order, each loaded only when the shopper asks", async ({ page }) => {
  test.setTimeout(90_000);
  const slug = await storeWithGallery();
  const asked: string[] = [];
  await page.route("https://media.example/**", (route) => {
    asked.push(route.request().url());
    return route.request().url().endsWith(".glb")
      ? route.fulfill({ path: join(__dirname, "fixtures", "triangle.glb"), contentType: "model/gltf-binary" })
      : route.fulfill({ status: 200, contentType: "video/mp4", body: "" });
  });
  await page.route(/youtube(-nocookie)?\.com/, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<p>player</p>" }));

  await page.goto(`/s/${slug}/p/demo-keramikkopp`);
  const gallery = page.locator("section[aria-roledescription='carousel']").first();
  // The thumbnails name each item by its kind, in the owner's order.
  const thumbs = page.locator("button[aria-label^='Vis ']");
  await expect(thumbs).toHaveCount(4);
  expect(await thumbs.evaluateAll((buttons) => buttons.map((b) => b.getAttribute("aria-label")))).toEqual([
    "Vis video 1",
    "Vis bilde 2",
    "Vis video 3",
    "Vis 3D-modell 4",
  ]);

  // The uploaded video is the browser's own player, with its picture, waiting for the shopper.
  const video = gallery.locator("video");
  await expect(video).toHaveAttribute("poster", "/demo/mug.svg");
  await expect(video).toHaveAttribute("preload", "none");
  expect(await video.evaluate((v: HTMLVideoElement) => v.autoplay || !v.paused)).toBe(false);

  // Nothing from YouTube and no 3D viewer before they are asked for.
  await expect(gallery.locator("iframe")).toHaveCount(0);
  expect(await page.evaluate(() => Boolean(customElements.get("model-viewer")))).toBe(false);
  expect(asked.filter((url) => url.endsWith(".glb"))).toEqual([]);

  await thumbs.nth(2).click();
  await page.getByRole("button", { name: /Spill av video: Koppen i bruk \(Spilles av fra YouTube\)/ }).click();
  await expect(gallery.locator("iframe")).toHaveAttribute("src", /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);

  await thumbs.nth(3).click();
  // Swiping on takes the YouTube player away.
  await expect(gallery.locator("iframe")).toHaveCount(0);
  await page.getByRole("button", { name: "Vis i 3D" }).click();
  // The model is fetched now that the shopper asked for it.
  await expect.poll(() => asked.filter((url) => url.endsWith(".glb")).length, { timeout: 30_000 }).toBeGreaterThan(0);
  // React gives a custom element its values as properties. Without a graphics card the browser draws the model in software, which can
  // hold the page for seconds on a busy machine, so these reads are given time.
  const viewer = gallery.locator("model-viewer");
  await expect.poll(() => viewer.evaluate((el) => (el as HTMLElement & { src: string }).src), { timeout: 30_000 }).toBe(MODEL);
  expect(await page.evaluate(() => Boolean(customElements.get("model-viewer")))).toBe(true);
});
