import { expect, test } from "@playwright/test";

import { storePageWith, testDb } from "./db";

/**
 * What the page builder's Theme tab says (D182) reaches the live site, not only the builder's canvas (D195): the size of paragraphs,
 * headings, lists and buttons, a row's spacing, the content width and the body background, each as the site draws it.
 */
const doc = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Noen ord å lese" }] },
    { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Et punkt" }] }] }] },
  ],
};
const size = (value: number) => ({ typography: { text: { size: { value, unit: "px" } } } });

test("the Theme tab's settings are what the site draws", async ({ page }) => {
  const url = await storePageWith("themelive", [
    { id: "h1", type: "heading", text: "Overskrift", level: 2 },
    { id: "t1", type: "richText", doc },
    { id: "b1", type: "button", label: "Gå videre", href: "/" },
  ]);
  const slug = url.split("/")[2];
  const sql = testDb();
  try {
    const elements = { p: size(31), h2: size(47), list: size(23), button: size(21), row: { style: { padding: { top: 40, right: 0, bottom: 40, left: 0 } } } };
    const settings = { elements, layout: { width: "normal", maxWidth: 1111 }, light: { background: "#fdf6e3" } };
    await sql`
      update commerce.stores set theme = jsonb_set(coalesce(theme, '{}'::jsonb), '{settings}',
        (coalesce(theme->'settings', '{}'::jsonb) || ${sql.json({ elements })}::jsonb)
        || jsonb_build_object(
          'layout', coalesce(theme->'settings'->'layout', '{}'::jsonb) || ${sql.json({ maxWidth: 1111 })}::jsonb,
          'light', coalesce(theme->'settings'->'light', '{}'::jsonb) || ${sql.json(settings.light)}::jsonb), true)
      where slug = ${slug}`;
  } finally {
    await sql.end();
  }
  await page.goto(url);
  await expect(page.getByText("Noen ord å lese")).toHaveCSS("font-size", "31px");
  await expect(page.getByText("Et punkt")).toHaveCSS("font-size", "23px");
  await expect(page.getByRole("heading", { name: "Overskrift" })).toHaveCSS("font-size", "47px");
  await expect(page.getByRole("link", { name: "Gå videre" })).toHaveCSS("font-size", "21px");
  await expect(page.locator(".kz-row-0")).toHaveCSS("padding-top", "40px");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(253, 246, 227)");
  const width = await page.evaluate(() => getComputedStyle(document.querySelector("main > * , main")!).getPropertyValue("--content-width"));
  expect(width.trim()).toBe("1111px");
});
