import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/** ISO weekday (1 Monday … 7 Sunday) of a date in Oslo. */
function osloWeekday(ms: number): number {
  const name = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "Europe/Oslo" }).format(new Date(ms));
  return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].indexOf(name) + 1;
}

/**
 * Subscription boxes (D102) as a shopper uses them: the page asks for the
 * agreement and a card, products go on the list from their pages, the list
 * is changed, a delivery skipped, and a change after the cutoff leaves the
 * delivery being packed as it was.
 */
test("a shopper keeps a subscription box list", async ({ page }) => {
  const slug = `ukeskasse-${Date.now().toString(36)}`;
  const email = `${slug}@example.com`;
  const sql = testDb();
  let storeId = "";
  try {
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name) values (${`owner-${email}`}, 'Test', 'Ukeskassen') returning id`;
    const [store] = await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Ukeskassen', null) as id`;
    storeId = String(store.id);
    await sql`update commerce.stores set modules = array['deliveries'] where id = ${storeId}`;
    // Deliveries tomorrow, the cutoff today at midnight: today's round is being packed.
    await sql`
      insert into commerce.delivery_schedules (store_id, market_code, currency, name, delivery_weekday, cutoff_days, cutoff_time)
      values (${storeId}, 'NO', 'NOK', 'Fredagslevering', ${osloWeekday(Date.now() + 86_400_000)}, 1, '00:00')`;
  } finally {
    await sql.end();
  }

  // Signed out, the page asks the shopper to sign in.
  await page.goto(`/s/${slug}/no/deliveries`);
  await expect(page.getByRole("heading", { level: 1, name: "Abonnementsboks" })).toBeVisible();
  await expect(page.getByText("Logg inn eller opprett en konto for å starte en abonnementsboks.")).toBeVisible();

  await page.goto(`/s/${slug}/no/account?tab=register`);
  await page.getByLabel("Navn").fill("Kari Nordmann");
  await page.getByLabel("E-post").fill(email);
  await page.getByLabel("Passord").fill("blå fjord seiler stille");
  await page.getByRole("button", { name: "Opprett konto" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Hei, Kari!" })).toBeVisible();
  await page.getByRole("link", { name: /Abonnementsboks/ }).click();

  // Starting: a delivery day, the address and the agreement; this store takes no payments yet.
  // (Pages visited before stay in the document, hidden: look only in the form.)
  const start = page.getByRole("region", { name: "Start abonnementsboks" });
  await expect(start).toBeVisible();
  await expect(start.getByRole("radio", { name: /, endre til/ })).toBeChecked();
  await expect(start.getByLabel("Navn")).toHaveValue("Kari Nordmann");
  await start.getByLabel("Adresse", { exact: true }).fill("Storgata 1");
  await start.getByLabel("Postnummer").fill("0155");
  await start.getByLabel("Sted").fill("Oslo");
  await start.getByLabel(/Jeg godtar at kortet mitt trekkes/).check();
  await start.getByRole("button", { name: "Lagre kort og start" }).click();
  await expect(start.getByText("Butikken kan ikke ta imot betaling akkurat nå.")).toBeVisible();

  // As if Stripe had saved the card: the list is on.
  const db = testDb();
  try {
    await db`
      insert into commerce.standing_orders (store_id, customer_id, schedule_id, status, shipping_address, stripe_account, mode,
        stripe_customer, payment_method, card_label, consent_at)
      select c.store_id, c.id, d.id, 'active', ${db.json({ name: "Kari Nordmann", line1: "Storgata 1", postalCode: "0155", city: "Oslo", country: "NO" })},
        'acct_test', 'test', 'cus_test', 'pm_test', 'Visa •••• 4242', now()
      from commerce.customers c join commerce.delivery_schedules d on d.store_id = c.store_id
      where c.store_id = ${storeId} and c.email = ${email}`;
  } finally {
    await db.end();
  }

  // From the product page onto the list.
  await page.goto(`/s/${slug}/no/p/demo-keramikkopp`);
  await page.getByRole("button", { name: "Legg til i abonnementsboks" }).click();
  await expect(page.getByText("Lagt til i abonnementsboksen.")).toBeVisible();
  await page.getByRole("link", { name: "Se listen" }).click();

  await expect(page.getByRole("heading", { name: "Listen din" })).toBeVisible();
  const list = page.getByRole("region", { name: "Listen din" });
  await expect(list.getByRole("link", { name: /Demo: Keramikkopp/ })).toBeVisible();
  await expect(list.getByText("Neste levering til dagens priser")).toBeVisible();
  await list.getByRole("button", { name: "+" }).click();
  await expect(list.getByText("2", { exact: true })).toBeVisible();
  await expect(page.getByText("Visa •••• 4242 · Fredagslevering")).toBeVisible();

  // The next delivery skipped, and taken back.
  const coming = page.getByRole("region", { name: "Kommende leveringer" });
  await coming.getByRole("button", { name: "Hopp over" }).first().click();
  await expect(coming.getByText("Hoppet over")).toBeVisible();
  await coming.getByRole("button", { name: "Lever" }).click();
  await expect(coming.getByText("Hoppet over")).toHaveCount(0);

  // Paused and resumed.
  await page.getByRole("button", { name: "Sett på pause" }).click();
  await expect(page.getByText("På pause: ingen leveringer før du fortsetter.")).toBeVisible();
  await page.getByRole("button", { name: "Fortsett leveringene" }).click();
  await expect(page.getByText("På pause: ingen leveringer før du fortsetter.")).toHaveCount(0);

  // Agreed to before today's cutoff: the next change makes today's delivery first, as the list was.
  const again = testDb();
  try {
    await again`update commerce.standing_orders set consent_at = now() - interval '3 days' where store_id = ${storeId}`;
  } finally {
    await again.end();
  }
  await page.reload();
  await list.getByRole("button", { name: "+" }).click();
  await expect(list.getByText("3", { exact: true })).toBeVisible();
  const packing = page.getByRole("region", { name: /^Pakkes til / });
  await expect(packing.getByText(/2 × Demo: Keramikkopp/)).toBeVisible();
  await expect(packing.getByText(/Vi trekker .* fra kortet ditt når den er på vei/)).toBeVisible();
});
