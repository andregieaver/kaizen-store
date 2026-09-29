import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * Custom fields, phase 3 (D120): a number and a measurement field as a range
 * in a product list's filters (`f.weight.max=300`), offered in the filter
 * dialog as a from and to pair with the unit it compares in.
 */

const ids = { weight: "f_weight000001", height: "f_height000001" };

async function arrange() {
  const slug = `ranges-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const sql = testDb();
  try {
    const [request] =
      await sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Ola', 'Målbutikk') returning id`;
    const [{ id }] = await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Målbutikk', null) as id`;
    const field = (
      fieldId: string,
      name: string,
      label: string,
      type: string,
      extra: Record<string, unknown> = {},
    ) => ({
      id: fieldId,
      name,
      label,
      type,
      access: "public",
      filter: true,
      ...extra,
    });
    const fields = [
      field(ids.weight, "weight", "Vekt", "measurement", { units: ["g", "kg"] }),
      field(ids.height, "height", "Høyde", "number", { unit: "cm" }),
    ];
    await sql`insert into commerce.field_groups (store_id, name, slug, entities, location, fields, sort)
      values (${id}, 'Mål', 'maal', ${sql.json(["product"] as never)}, '[]'::jsonb, ${sql.json(fields as never)}, 0)`;
    const put = async (handle: string, values: Record<string, unknown>) => {
      const [product] = await sql`select id from commerce.products where store_id = ${id} and handle = ${handle}`;
      await sql`insert into commerce.field_values (store_id, entity, entity_id, locale, values)
        values (${id}, 'product', ${product.id}, '', ${sql.json(values as never)})`;
    };
    await put("demo-handlenett", { [ids.weight]: { value: 200, unit: "g" }, [ids.height]: 30 });
    await put("demo-notatbok", { [ids.weight]: { value: 800, unit: "g" }, [ids.height]: 20 });
    return { slug };
  } finally {
    await sql.end();
  }
}

test("a measurement field narrows a product list by the most, the least or both", async ({ page }) => {
  const { slug } = await arrange();
  const main = page.getByRole("main");

  await page.goto(`/s/${slug}/no/products?f.weight.max=300`);
  await expect(main.getByRole("link", { name: /Handlenett/ }).first()).toBeVisible();
  // (The store's menu links to it too: look in the list only.)
  await expect(main.getByRole("link", { name: /Notatbok/ })).toHaveCount(0);
  // The chosen range is shown above the list, with its unit, and takes itself away.
  const chip = main.getByRole("link", { name: /Fjern Vekt/ });
  await expect(chip).toContainText("Vekt: ≤ 300 g");

  await page.goto(`/s/${slug}/no/products?f.weight.min=500`);
  await expect(main.getByRole("link", { name: /Notatbok/ }).first()).toBeVisible();
  await expect(main.getByRole("link", { name: /Handlenett/ })).toHaveCount(0);

  await page.goto(`/s/${slug}/no/products?f.weight.min=100&f.weight.max=900`);
  await expect(main.getByRole("link", { name: /Handlenett/ }).first()).toBeVisible();
  await expect(main.getByRole("link", { name: /Notatbok/ }).first()).toBeVisible();
  await expect(main.getByRole("link", { name: /Fjern Vekt/ })).toContainText("Vekt: 100–900 g");

  // A number field, and a name that is not a filter or a value that is not a number, are read the same way.
  await page.goto(`/s/${slug}/no/products?f.height.min=25`);
  await expect(main.getByRole("link", { name: /Handlenett/ }).first()).toBeVisible();
  await expect(main.getByRole("link", { name: /Notatbok/ })).toHaveCount(0);
  await page.goto(`/s/${slug}/no/products?f.weight.max=lots&f.nothing.min=1`);
  await expect(main.getByRole("link", { name: /Notatbok/ }).first()).toBeVisible();
  await expect(main.getByRole("link", { name: /Handlenett/ }).first()).toBeVisible();
});

test("the filter dialog offers the range with its unit, and follows what is typed", async ({ page }) => {
  const { slug } = await arrange();
  const main = page.getByRole("main");
  await page.goto(`/s/${slug}/no/products`);
  await main
    .getByRole("button", { name: /Filtrer og sorter/ })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  const weight = dialog.getByRole("group", { name: "Vekt" });
  await expect(weight).toBeVisible();
  await expect(weight).toContainText("200–800 g");
  await weight.getByRole("textbox", { name: /^Til/ }).fill("300");
  await expect(page).toHaveURL(/f\.weight\.max=300/);
  await expect(main.getByRole("link", { name: /Notatbok/ })).toHaveCount(0);
  await expect(main.getByRole("link", { name: /Handlenett/ }).first()).toBeVisible();
});
