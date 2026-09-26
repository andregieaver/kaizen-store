import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * Appointments (D65): a shopper chooses a time on the product page, the
 * cart holds it as one place, and on a phone nothing is wider than the
 * screen.
 */
async function storeWithAppointment(): Promise<string> {
  const slug = `bookings-${Date.now()}`;
  const hours = { open: "08:00", close: "20:00" };
  const week = { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: hours, sun: hours };
  const sql = testDb();
  try {
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name)
      values (${`${slug}@example.com`}, 'Kari', 'Karis Massasje') returning id`;
    const [{ id: storeId }] = await sql`
      select commerce.approve_access_request(${request.id}, ${slug}, 'Karis Massasje', null) as id`;
    await sql`update commerce.stores set modules = '{bookings}', time_zone = 'Europe/Oslo' where id = ${storeId}`;
    const [staff] = await sql`
      insert into commerce.booking_resources (store_id, name, hours)
      values (${storeId}, 'Kari', ${sql.json({ week, exceptions: [] })}) returning id`;
    const [product] = await sql`
      insert into commerce.products (store_id, handle, tax_code, kind, status, vat_category)
      values (${storeId}, 'massasje', 'txcd_20030000', 'appointment', 'draft', 'exempt') returning id`;
    await sql`
      insert into commerce.product_translations (store_id, product_id, locale, title, description)
      values (${storeId}, ${product.id}, 'nb-NO', 'Massasje', 'En time med massasje.')`;
    await sql`
      insert into commerce.product_media (store_id, product_id, url)
      values (${storeId}, ${product.id}, '/kaizen/favicon.ico')`;
    const [variant] = await sql`
      insert into commerce.product_variants (store_id, product_id, sku, options, delivery)
      values (${storeId}, ${product.id}, ${`MASSASJE-${slug}`}, '{}'::jsonb, 'service') returning id`;
    await sql`select commerce.set_price(${variant.id}, 'NO', 89000)`;
    await sql`
      insert into commerce.appointment_settings (product_id, store_id, duration_minutes, step_minutes, min_notice_minutes)
      values (${product.id}, ${storeId}, 60, 30, 60)`;
    await sql`insert into commerce.product_resources (store_id, product_id, resource_id) values (${storeId}, ${product.id}, ${staff.id})`;
    await sql`update commerce.products set status = 'active' where id = ${product.id}`;
  } finally {
    await sql.end();
  }
  return slug;
}

test("a shopper books a time and finds it in the cart", async ({ page }) => {
  const slug = await storeWithAppointment();
  await page.goto(`/s/${slug}/no/p/massasje`);

  await expect(page.getByText("60 min · hos Kari")).toBeVisible();
  await expect(page.getByText("Timer til en fast dato har ikke angrerett.")).toBeVisible();
  const add = page.getByRole("button", { name: "Legg i handlekurven" });
  await expect(add).toBeDisabled();

  // The first day with free times is chosen; choosing a time lets it into the cart.
  const times = page.getByRole("group", { name: "Velg tid" });
  const first = times.getByRole("button", { name: /^\d\d[:.]\d\d$/ }).first();
  const time = (await first.textContent())!.trim();
  await first.click();
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await add.click();
  await expect(page.getByText("Lagt i handlekurven.")).toBeVisible();

  await page.goto(`/s/${slug}/no/cart`);
  const line = page.getByRole("listitem").filter({ hasText: "Massasje" });
  await expect(line).toContainText(time);
  // One place at one time: nothing to count, and no shipping.
  await expect(line.getByLabel("Antall")).toHaveCount(0);
  await expect(page.locator("dt", { hasText: /^Frakt/ })).toHaveCount(0);
  await line.getByRole("button", { name: /Fjern/ }).click();
  await expect(page.getByText("Handlekurven er tom.")).toBeVisible();
});

test("the time picker fits a phone", async ({ page }) => {
  const slug = await storeWithAppointment();
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(`/s/${slug}/no/p/massasje`);
  await expect(page.getByRole("group", { name: "Velg tid" }).getByRole("button", { name: /^\d\d[:.]\d\d$/ }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
