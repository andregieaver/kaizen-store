import { expect, test } from "@playwright/test";

import { storePageWith, testDb } from "./db";

/** Hover timing and button hover effects (D206): the theme's for the site, a part's own over it; brand logos in one colour. */

async function themeHover(url: string, hover: { [key: string]: string | number }) {
  const slug = url.split("/")[2];
  const sql = testDb();
  try {
    await sql`
      update commerce.stores set theme = jsonb_set(coalesce(theme, '{}'::jsonb), '{settings}',
        coalesce(theme->'settings', '{}'::jsonb) || ${sql.json({ hover })}::jsonb, true)
      where slug = ${slug}`;
  } finally {
    await sql.end();
  }
}

test("buttons take the theme's hover time, easing and effect, and a button's own effect wins", async ({ page }) => {
  const url = await storePageWith("hovertime", [
    { id: "b1", type: "button", label: "Temaets", href: "/" },
    { id: "b2", type: "button", label: "Egen", href: "/", hover: "grow", motion: { hoverTime: { duration: 900, ease: "linear" } } },
  ]);
  await themeHover(url, { duration: 450, ease: "snappy", button: "lift" });
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(url);
  await expect(page.locator("html")).toHaveAttribute("data-button-hover", "lift");
  const theirs = page.getByRole("link", { name: "Temaets" });
  const own = page.getByRole("link", { name: "Egen" });
  await expect(theirs).toHaveCSS("transition-duration", /0\.45s/);
  await expect(theirs).toHaveCSS("transition-timing-function", /cubic-bezier\(0\.22, 1, 0\.36, 1\)/);
  await expect(own).toHaveCSS("transition-duration", /0\.9s/);
  await expect(own).toHaveCSS("transition-timing-function", /linear/);
  await theirs.hover();
  await expect.poll(() => theirs.evaluate((el) => getComputedStyle(el).transform)).not.toBe("none");
  await own.hover();
  await expect.poll(() => own.evaluate((el) => getComputedStyle(el).transform)).toMatch(/matrix\(1\.0[1-4]/);
});

test("brand logos fill their shape with the brand colour and show as uploaded on hover", async ({ page }) => {
  const base = `http://localhost:${process.env.PORT ?? 3000}`;
  const url = await storePageWith("merkefarge", [
    { id: "br", type: "brands", tint: "brand", colourOnHover: true, items: [{ id: "i1", name: "Acme", picture: { url: `${base}/demo/logo.svg`, width: 400, height: 200 } }] },
  ]);
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(url);
  const logo = page.locator(".kz-brand-logo").first();
  const mask = page.locator(".kz-brand-mask").first();
  await expect(logo).toHaveCSS("opacity", "0");
  // The logo keeps its size inside the colour's mask.
  expect((await mask.boundingBox())!.height).toBeGreaterThan(20);
  expect(await mask.evaluate((el) => getComputedStyle(el, "::after").maskImage)).toContain("logo.svg");
  await logo.hover({ force: true });
  await expect(logo).toHaveCSS("opacity", "1");
});
