import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * Design themes (D60): a store without one looks as the demo always has
 * (Minimal); a store's own settings reach its colours, header, buttons and
 * product cards.
 */

test("the demo store shows Minimal, following the visitor's light or dark mode", async ({ browser }) => {
  for (const [scheme, background] of [
    ["light", "#ffffff"],
    ["dark", "#0a0a0a"],
  ] as const) {
    const context = await browser.newContext({ colorScheme: scheme });
    const page = await context.newPage();
    await page.goto("/s/demo/no");
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-store-theme", "");
    await expect(html).toHaveAttribute("data-card-style", "plain");
    expect(await html.evaluate((el) => getComputedStyle(el).getPropertyValue("--background").trim())).toBe(background);
    await context.close();
  }
});

test("a store's theme settings reach its colours, header, buttons and product cards", async ({ page }) => {
  const slug = `theme-${Date.now()}`;
  const sql = testDb();
  try {
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name)
      values (${`${slug}@example.com`}, 'Kari', 'Karis Kopper') returning id`;
    await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Karis Kopper', null)`;
    // Settings left out come from the template: here only what differs from Minimal.
    const theme = {
      base: "minimal",
      settings: {
        mode: "light",
        light: { accent: "#1d4ed8", accentText: "#ffffff", background: "#fdfcf8" },
        buttons: { style: "outline", corners: "square" },
        layout: { headerAlign: "center", headerBackground: "accent" },
        productCards: { image: "portrait", style: "bordered", align: "center" },
      },
    };
    await sql`update commerce.stores set theme = ${sql.json(theme)} where slug = ${slug}`;
  } finally {
    await sql.end();
  }

  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`/s/${slug}/no/p/demo-keramikkopp`);
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-button-style", "outline");
  const vars = await html.evaluate((el) => {
    const style = getComputedStyle(el);
    return ["--background", "--accent", "--button-radius"].map((name) => style.getPropertyValue(name).trim());
  });
  // Always light, even for a visitor in dark mode.
  expect(vars).toEqual(["#fdfcf8", "#1d4ed8", "0"]);

  // The header in the accent colour; the add-to-cart button outlined in it, square.
  expect(await page.locator("header").first().evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(29, 78, 216)");
  const add = page.getByRole("button", { name: /Legg i handlekurven/ }).first();
  expect(
    await add.evaluate((el) => {
      const style = getComputedStyle(el);
      return [style.backgroundColor, style.color, style.borderTopLeftRadius];
    }),
  ).toEqual(["rgba(0, 0, 0, 0)", "rgb(29, 78, 216)", "0px"]);

  // Product cards on the front page: bordered, centred, portrait pictures.
  await page.goto(`/s/${slug}/no`);
  const card = page.locator(".product-card").first();
  expect(
    await card.evaluate((el) => {
      const style = getComputedStyle(el);
      const image = el.querySelector("img");
      return [style.borderTopWidth, style.textAlign, image && getComputedStyle(image).aspectRatio];
    }),
  ).toEqual(["1px", "center", "3 / 4"]);
});

test("Bold modern draws a black header, spaced capitals and square buttons", async ({ page }) => {
  const slug = `bold-${Date.now()}`;
  const sql = testDb();
  try {
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name)
      values (${`${slug}@example.com`}, 'Kari', 'Karis Klær') returning id`;
    await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Karis Klær', null)`;
    // Only the template: every setting comes from Bold modern.
    await sql`update commerce.stores set theme = ${sql.json({ base: "bold" })} where slug = ${slug}`;
  } finally {
    await sql.end();
  }

  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(`/s/${slug}/no/p/demo-keramikkopp`);
  await expect(page.locator("html")).toHaveAttribute("data-heading-case", "upper");
  expect(await page.locator("header").first().evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(10, 10, 10)");
  const title = page.getByRole("heading", { level: 1 });
  expect(await title.evaluate((el) => [getComputedStyle(el).textTransform, getComputedStyle(el).fontWeight])).toEqual([
    "uppercase",
    "700",
  ]);
  const add = page.getByRole("button", { name: /Legg i handlekurven/ }).first();
  expect(await add.evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).borderTopLeftRadius])).toEqual([
    "rgb(255, 79, 0)",
    "0px",
  ]);
});

test("the logo for dark backgrounds is shown where the background is dark", async ({ browser }) => {
  const slug = `logo-${Date.now()}`;
  const sql = testDb();
  try {
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name)
      values (${`${slug}@example.com`}, 'Kari', 'Karis Lamper') returning id`;
    await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Karis Lamper', null)`;
    // Two files that exist, one standing in for the light version of the logo.
    const navigation = {
      logo: { url: "/demo/logo.svg", width: 120, height: 32 },
      logoDark: { url: "/demo/lamp.svg", width: 120, height: 32 },
      header: [],
      footer: [],
    };
    await sql`update commerce.stores set theme = ${sql.json({ base: "bold" })}, navigation = ${sql.json(navigation)} where slug = ${slug}`;
  } finally {
    await sql.end();
  }

  // Bold modern: a black header in light mode, a black page in dark mode.
  for (const [scheme, header, footer] of [
    ["light", "lamp.svg", "logo.svg"],
    ["dark", "logo.svg", "lamp.svg"],
  ] as const) {
    const context = await browser.newContext({ colorScheme: scheme });
    const page = await context.newPage();
    await page.goto(`/s/${slug}/no`);
    const shown = (area: string) =>
      page.locator(area).first().locator("img").first().evaluate((img: HTMLImageElement) => new URL(img.currentSrc).pathname);
    await expect.poll(() => shown("header")).toBe(`/demo/${header}`);
    await expect.poll(() => shown("footer")).toBe(`/demo/${footer}`);
    await context.close();
  }
});
