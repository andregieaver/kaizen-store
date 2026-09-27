import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * Appointments (D65): a shopper chooses a time on the product page, the
 * cart holds it as one place, and on a phone nothing is wider than the
 * screen.
 */
async function storeWithAppointment(payment: "now" | "deposit" | "venue" = "now"): Promise<string> {
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
      insert into commerce.appointment_settings (product_id, store_id, duration_minutes, step_minutes, min_notice_minutes, payment)
      values (${product.id}, ${storeId}, 60, 30, 60, ${payment})`;
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

test("a deposit is paid now and the rest at the appointment, and the page says until when it can be cancelled", async ({ page }) => {
  const slug = await storeWithAppointment("deposit");
  await page.goto(`/s/${slug}/no/p/massasje`);
  await expect(page.getByText("Depositum 30 % ved bestilling, resten på stedet. Gratis avbestilling eller endring til 24 timer før.")).toBeVisible();
  await page.getByRole("group", { name: "Velg tid" }).getByRole("button", { name: /^\d\d[:.]\d\d$/ }).first().click();
  await page.getByRole("button", { name: "Legg i handlekurven" }).click();
  await expect(page.getByText("Lagt i handlekurven.")).toBeVisible();

  await page.goto(`/s/${slug}/no/cart`);
  const summary = page.locator("aside dl");
  await expect(summary.locator("div").filter({ hasText: /^Betales nå/ })).toContainText("267,00");
  await expect(summary.locator("div").filter({ hasText: /^Betales på stedet/ })).toContainText("623,00");
});

/** A paid order for the massage, two days ahead at 10:00 in Oslo, paid at the venue: its page and key. */
async function bookedOrder(slug: string): Promise<string> {
  const sql = testDb();
  try {
    const [row] = await sql`
      select s.id as store_id, p.id as product_id, v.id as variant_id, r.id as resource_id
      from commerce.stores s
      join commerce.products p on p.store_id = s.id and p.handle = 'massasje'
      join commerce.product_variants v on v.product_id = p.id
      join commerce.product_resources pr on pr.product_id = p.id
      join commerce.booking_resources r on r.id = pr.resource_id
      where s.slug = ${slug}`;
    const [order] = await sql`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor,
        tax_minor, total_minor, balance_minor, billing_address, shipping_address)
      values (${row.store_id}, 'E2E-1', 'NO', 'NOK', 'nb-NO', 'kunde@example.com', 'paid', 89000, 0, 89000, 89000,
        '{"name": "Kunde"}', '{}')
      returning id`;
    const [line] = await sql`
      insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor,
        total_minor, tax_minor, venue_minor, tax_rate, tax_code, withdrawal_exclusion, delivery)
      values (${row.store_id}, ${order.id}, ${row.variant_id}, 'MASSASJE', 'Massasje', 1, 89000, 89000, 0, 89000, 0,
        'txcd_20030000', 'dated_service', 'service')
      returning id`;
    await sql`
      insert into commerce.bookings (store_id, product_id, variant_id, resource_id, starts_at, ends_at, blocked_from,
        blocked_to, status, order_id, order_line_id)
      select ${row.store_id}, ${row.product_id}, ${row.variant_id}, ${row.resource_id}, t, t + interval '1 hour', t,
        t + interval '1 hour', 'confirmed', ${order.id}, ${line.id}
      from (select (date_trunc('day', now() at time zone 'Europe/Oslo') + interval '2 days 10 hours') at time zone 'Europe/Oslo' as t) x`;
    await sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
      values (${row.store_id}, ${order.id}, 'venue', ${`venue_e2e_${order.id}`}, 89000, 'NOK', 'pending')`;
    await sql`
      insert into commerce.order_events (store_id, order_id, type, data, actor)
      values (${row.store_id}, ${order.id}, 'order.paid', '{}', 'system')`;
    return `/s/${slug}/no/order/${order.id}?session_id=venue_e2e_${order.id}`;
  } finally {
    await sql.end();
  }
}

test("a shopper moves their booking to another time, then cancels it, from the order page", async ({ page }) => {
  const slug = await storeWithAppointment("venue");
  await page.goto(await bookedOrder(slug));
  await expect(page.getByText("Betales på stedet").first()).toBeVisible();
  const bookings = page.getByRole("region", { name: "Tid" });
  await expect(bookings.getByText(/10[:.]00, hos Kari/)).toBeVisible();
  await expect(bookings.getByText(/^Kan endres eller avbestilles til /)).toBeVisible();

  await bookings.getByRole("button", { name: "Endre tid" }).click();
  const times = bookings.getByRole("group", { name: "Velg tid" });
  // Next week, so the new time is still more than a day away and can be cancelled after.
  await times.getByRole("button", { name: "Neste uke →" }).click();
  await times.getByRole("button", { name: /^\d\d[:.]\d\d$/ }).nth(3).click();
  await bookings.getByRole("button", { name: "Flytt hit" }).click();
  await expect(bookings.getByText("Timen er flyttet.")).toBeVisible();
  await page.reload();
  await expect(bookings.getByText(/10[:.]00, hos Kari/)).toHaveCount(0);

  await bookings.getByRole("button", { name: "Avbestill" }).click();
  await bookings.getByRole("button", { name: "Ja, avbestill timen" }).click();
  await expect(page.getByRole("heading", { name: "Bestillingen er kansellert." })).toBeVisible();
});
