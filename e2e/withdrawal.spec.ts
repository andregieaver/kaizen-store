import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * The EU withdrawal function (D153, docs/returns.md): reachable from every footer, two steps (the statement, then
 * *Confirm withdrawal*), an acknowledgement with its reference, and a status page. It sets no cookie and keeps nothing in the
 * browser, and it is for no search engine.
 */

let seq = 0;
type Placed = { orderId: string; number: string; email: string; key: string };

/** A paid order of goods in the demo store, as the checkout leaves it: not delivered yet, so the right is open. */
async function paidOrder(
  items: { title: string; quantity: number; exclusion?: string }[],
  options: { deliveredDaysAgo?: number; store?: string } = {},
): Promise<Placed> {
  const n = `${Date.now().toString(36)}${++seq}`.toUpperCase();
  const number = `WD-${n}`;
  const email = `angre-${n.toLowerCase()}@example.com`;
  const key = `cs_${number}`;
  const db = testDb();
  try {
    const [store] = await db`select id from commerce.stores where slug = ${options.store ?? "demo"}`;
    // A physical line has a variant, as every line the checkout writes does (D174, docs/wave-3-fulfilment.md 3.11 item 6): only such a line is sent in a parcel.
    const [variant] = await db`
      select v.id from commerce.product_variants v
      where v.store_id = ${store.id} and v.delivery = 'physical' order by v.sku limit 1`;
    const [order] = await db`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, status,
        subtotal_minor, shipping_minor, tax_minor, total_minor, billing_address, shipping_address, delivered_at)
      values (${store.id}, ${number}, 'NO', 'NOK', 'nb-NO', ${email}, 'paid',
        ${items.length * 20000}, 0, ${items.length * 4000}, ${items.length * 20000}, '{}', '{"line1":"Gata 1"}',
        ${options.deliveredDaysAgo === undefined ? null : db`now() - ${`${options.deliveredDaysAgo} days`}::interval`})
      returning id`;
    const lines: { id: string; quantity: number }[] = [];
    for (const [i, item] of items.entries()) {
      const [line] = await db`
        insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, total_minor, tax_minor, tax_rate, tax_code, withdrawal_exclusion)
        values (${store.id}, ${order.id}, ${variant.id}, ${`WD-${n}-${i}`}, ${item.title}, ${item.quantity}, 20000, ${item.quantity * 20000},
          ${item.quantity * 4000}, 0.25, 'txcd_99999999', ${item.exclusion ?? "none"}::commerce.withdrawal_exclusion)
        returning id`;
      lines.push({ id: line.id, quantity: item.quantity });
    }
    await db`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
      values (${store.id}, ${order.id}, 'stripe', ${key}, ${items.length * 20000}, 'NOK', 'captured')`;
    // Sent a day ago, every unit in the one parcel (D174: a parcel names its units), so a withdrawal has goods to send back
    // (a withdrawal before sending is its own case).
    const [shipment] = await db`
      insert into commerce.shipments (store_id, order_id, carrier, tracking_number, created_at)
      values (${store.id}, ${order.id}, 'Bring', ${`T-${n}`}, now() - interval '1 day')
      returning id`;
    for (const line of lines) {
      await db`
        insert into commerce.shipment_lines (store_id, shipment_id, order_line_id, quantity)
        values (${store.id}, ${shipment.id}, ${line.id}, ${line.quantity})`;
    }
    return { orderId: order.id, number, email, key };
  } finally {
    await db.end();
  }
}

async function returnsOf(orderId: string) {
  const db = testDb();
  try {
    return await db`
      select r.number, r.kind, r.status, rl.quantity, rl.decision, ol.title
      from commerce.returns r
      join commerce.return_lines rl on rl.return_id = r.id
      join commerce.order_lines ol on ol.id = rl.order_line_id
      where r.order_id = ${orderId} order by ol.title`;
  } finally {
    await db.end();
  }
}

test("a shopper finds the function in the footer, withdraws in two steps and gets the acknowledgement", async ({ page, context }) => {
  const order = await paidOrder([{ title: "Lampe", quantity: 2 }, { title: "Kopp med navn", quantity: 1, exclusion: "custom_made" }]);

  await page.goto("/s/demo/no");
  await page.getByRole("link", { name: "Angre avtalen", exact: true }).first().click();
  await expect(page).toHaveURL("/s/demo/no/withdraw");
  await expect(page.getByRole("heading", { level: 1, name: "Angre avtalen" })).toBeVisible();
  const cookiesBefore = (await context.cookies()).map((c) => c.name).sort();
  const storageBefore = await page.evaluate(() => localStorage.length + sessionStorage.length);

  // Step 1: the statement. No reason is asked, and what can be withdrawn is included.
  await expect(page.getByText("Trinn 1 av 2")).toBeVisible();
  await expect(page.getByText("Alt på ordren som kan angres, er med.")).toBeVisible();
  await expect(page.getByLabel(/grunn/i)).toHaveCount(0);
  await page.getByLabel("Navn").fill("Kari Nordmann");
  await page.getByLabel("E-postadresse").fill(order.email);
  await page.getByLabel("Ordrenummer").fill(order.number);
  await page.getByRole("button", { name: "Angre avtalen her" }).click();

  // Step 2: exactly what was declared; nothing is a withdrawal yet.
  const check = page.getByRole("heading", { name: "Se over og bekreft" });
  await expect(check).toBeVisible();
  await expect(check).toBeFocused();
  await expect(page.getByText(`Du angrer ordre ${order.number}. Ingenting er angret før du trykker Bekreft angrer.`)).toBeVisible();
  const main = page.getByRole("main");
  await expect(main.getByText("Lampe", { exact: true })).toBeVisible();
  await expect(main.getByText("× 2")).toBeVisible();
  await expect(main.getByText("Kopp med navn")).toHaveCount(0);
  expect(await returnsOf(order.orderId)).toHaveLength(0);

  // The act is the button.
  await page.getByRole("button", { name: "Bekreft angrer" }).click();
  const done = page.getByRole("heading", { name: "Angrer din er bekreftet" });
  await expect(done).toBeVisible();
  await expect(done).toBeFocused();
  await expect(page.getByText(`${order.number}-R1`).first()).toBeVisible();
  // Handed to the email provider, or (none is set up where this runs) said plainly not to have been sent: never claimed as sent.
  await expect(page.getByText(new RegExp(`Vi har sendt en bekreftelse til ${order.email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.|Vi klarte ikke å sende bekreftelsen på e-post`))).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bekreftelse" })).toBeVisible();
  await expect(page.getByText(/Send varene tilbake senest/).first()).toBeVisible();
  expect(await returnsOf(order.orderId)).toEqual([expect.objectContaining({ number: `${order.number}-R1`, kind: "withdrawal", status: "approved", quantity: 2, decision: "accept", title: "Lampe" })]);

  // Nothing was set or kept in the browser.
  expect((await context.cookies()).map((c) => c.name).sort()).toEqual(cookiesBefore);
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(storageBefore);

  // The status page: read only, noindex, the order number and nothing about the shopper.
  await page.getByRole("link", { name: new RegExp(`Følg returen: ${order.number}-R1`) }).click();
  await expect(page).toHaveURL(/\/s\/demo\/no\/returns\/[0-9a-f]{32,}$/);
  await expect(page.getByRole("heading", { level: 1, name: `Retur ${order.number}-R1` })).toBeVisible();
  await expect(page.getByText("Send varene tilbake", { exact: true })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  const text = await page.locator("main").innerText();
  expect(text).not.toContain(order.email);
  expect(text).not.toContain("Kari");
});

test("a mismatch gets the same answer as any other, said where to look, with the focus on it", async ({ page }) => {
  const order = await paidOrder([{ title: "Lampe", quantity: 1 }]);
  await page.goto("/s/demo/no/withdraw");
  await page.getByLabel("Navn").fill("Kari Nordmann");
  await page.getByLabel("E-postadresse").fill("noen-andre@example.com");
  await page.getByLabel("Ordrenummer").fill(order.number);
  await page.getByRole("button", { name: "Angre avtalen her" }).click();
  const notice = page.getByRole("status").filter({ hasText: "Hvis opplysningene stemmer med en ordre, ser du neste trinn her." });
  await expect(notice).toBeVisible();
  await expect(notice).toBeFocused();
  await expect(notice).toContainText("Sjekk ordrenummeret og e-postadressen du handlet med.");
  // What was typed is kept, and the form is still step 1.
  await expect(page.getByLabel("Ordrenummer")).toHaveValue(order.number);
  await expect(page.getByLabel("E-postadresse")).toHaveValue("noen-andre@example.com");
  await expect(page.getByText("Trinn 1 av 2")).toBeVisible();
  expect(await returnsOf(order.orderId)).toHaveLength(0);
});

test("a field that is wrong is said so, and announced", async ({ page }) => {
  await page.goto("/s/demo/no/withdraw");
  // The browser's own checks are set aside to reach the server's.
  await page.getByLabel("Navn").fill("Kari");
  await page.getByLabel("E-postadresse").fill("ikke-en-adresse");
  await page.getByLabel("Ordrenummer").fill("1");
  await page.evaluate(() => document.querySelector("form")?.setAttribute("novalidate", ""));
  await page.getByRole("button", { name: "Angre avtalen her" }).click();
  const alert = page.getByRole("alert").filter({ hasText: "Sjekk disse feltene" });
  await expect(alert).toBeVisible();
  await expect(alert).toBeFocused();
  await expect(alert).toContainText("E-postadresse: Skriv en gyldig e-postadresse.");
  await expect(page.getByLabel("E-postadresse")).toHaveAttribute("aria-invalid", "true");
});

test("from the order page the order is filled in and the lines can be chosen and changed before confirming", async ({ page }) => {
  const order = await paidOrder([{ title: "Lampe", quantity: 3 }, { title: "Vase", quantity: 1 }]);
  await page.goto(`/s/demo/no/order/${order.orderId}?session_id=${order.key}`);
  const button = page.getByRole("link", { name: "Angre kjøpet eller returner varer" });
  await expect(button).toBeVisible();
  await button.click();
  await expect(page).toHaveURL(new RegExp(`/withdraw\\?order=${order.number}&key=${order.key}`));

  // The order is proven by its key: its email and lines are there, everything ticked.
  await expect(page.getByLabel("E-postadresse")).toHaveValue(order.email);
  await expect(page.getByLabel("Ordrenummer")).toHaveValue(order.number);
  await expect(page.getByRole("checkbox", { name: "Angre Lampe" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Angre Vase" })).toBeChecked();
  await expect(page.getByLabel("Antall Lampe")).toHaveValue("3");

  await page.getByLabel("Navn").fill("Kari Nordmann");
  await page.getByRole("checkbox", { name: "Angre Vase" }).uncheck();
  await page.getByLabel("Antall Lampe").fill("2");
  await page.getByRole("button", { name: "Angre avtalen her" }).click();
  await expect(page.getByRole("heading", { name: "Se over og bekreft" })).toBeFocused();
  await expect(page.getByRole("main").getByText("× 2")).toBeVisible();
  await expect(page.getByRole("main").getByText("Vase", { exact: true })).toHaveCount(0);

  // Changing goes back to the lines, with the choice kept.
  await page.getByRole("button", { name: "Endre hva jeg angrer på" }).click();
  await expect(page.getByRole("heading", { name: "Din erklæring" })).toBeFocused();
  await expect(page.getByRole("checkbox", { name: "Angre Vase" })).not.toBeChecked();
  await expect(page.getByLabel("Antall Lampe")).toHaveValue("2");
  await page.getByRole("button", { name: "Angre avtalen her" }).click();
  await page.getByRole("button", { name: "Bekreft angrer" }).click();
  await expect(page.getByRole("heading", { name: "Angrer din er bekreftet" })).toBeVisible();
  expect(await returnsOf(order.orderId)).toEqual([expect.objectContaining({ title: "Lampe", quantity: 2, decision: "accept" })]);

  // The order page now lists the return, and it can be followed from there.
  await page.goto(`/s/demo/no/order/${order.orderId}?session_id=${order.key}`);
  await expect(page.getByRole("link", { name: `${order.number}-R1` })).toBeVisible();
});

test("past the period the function still opens, says so plainly, and lists what cannot be withdrawn with the reason", async ({ page }) => {
  const order = await paidOrder([{ title: "Lampe", quantity: 1 }, { title: "Kopp med navn", quantity: 1, exclusion: "custom_made" }], { deliveredDaysAgo: 40 });
  await page.goto(`/s/demo/no/withdraw?order=${order.number}&key=${order.key}`);
  await expect(page.getByText(/Etter våre opplysninger er de 14 dagene for å angre gått ut/).first()).toBeVisible();
  // No line to withdraw: the page says nothing can be, and why, line by line.
  await expect(page.getByText("Det er ingenting på denne ordren du kan angre nå.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Kan ikke angres" })).toBeVisible();
  await expect(page.getByText("Loven unntar denne typen varer fra angreretten. (Laget etter dine ønsker eller personlig tilpasset)")).toBeVisible();
  await expect(page.getByText(/Etter våre opplysninger er de 14 dagene for å angre gått ut/).last()).toBeVisible();
  await expect(page.getByRole("button", { name: "Angre avtalen her" })).toHaveCount(0);
});

test("the link is in every footer: the standard one, one built in the builder, and one saved without it", async ({ page }) => {
  const content = (title: string, rows: unknown[]) => ({
    title,
    slug: title.toLowerCase(),
    thumbnail: null,
    seo: { title: "", description: "" },
    searchEngines: true,
    aiAssistants: true,
    categories: [],
    tags: [],
    rows,
  });
  const row = (id: string, blocks: unknown[]) => ({ id, type: "row", layout: "1", columns: [{ id: `${id}-c`, blocks }] });
  // A store's layout is cached, so each footer is a store of its own.
  const storeWith = async (name: string, footer: ReturnType<typeof content> | null): Promise<string> => {
    const slug = `angre-${name}-${Date.now().toString(36)}`;
    const db = testDb();
    try {
      const [request] = await db`
        insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Siri', 'Siris Butikk') returning id`;
      const [{ id: storeId }] = await db`select commerce.approve_access_request(${request.id}, ${slug}, 'Siris Butikk', null) as id`;
      if (footer) {
        const [made] = await db`
          insert into commerce.pages (store_id, type, slug, draft, published, published_at)
          values (${storeId}, 'footer', ${footer.slug}, ${db.json(footer as never)}, ${db.json(footer as never)}, now()) returning id`;
        await db`update commerce.stores set footer_id = ${made.id} where id = ${storeId}`;
      }
    } finally {
      await db.end();
    }
    return slug;
  };
  const link = () => page.getByRole("link", { name: "Angre avtalen", exact: true });
  const business = { id: "b", type: "site", part: "business" };
  const cookies = { id: "k", type: "site", part: "cookies" };

  // The standard footer.
  const standard = await storeWith("std", null);
  await page.goto(`/s/${standard}/no`);
  await expect(page.locator("footer").getByRole("link", { name: "Angre avtalen", exact: true })).toBeVisible();
  await expect(link()).toHaveCount(1);

  // A footer built in the builder, with the component: it is the one link.
  const built = await storeWith("bygd", content("Bunn", [row("f", [business, cookies, { id: "w", type: "site", part: "withdrawal" }])]));
  await page.goto(`/s/${built}/no`);
  await expect(page.locator(".site-footer").getByRole("link", { name: "Angre avtalen", exact: true })).toBeVisible();
  await expect(link()).toHaveCount(1);

  // One saved before the function existed: the standard link is under it.
  const old = await storeWith("gammel", content("Gammel", [row("f", [business, cookies])]));
  await page.goto(`/s/${old}/no`);
  await expect(page.locator(".site-footer")).toBeVisible();
  await expect(page.locator(".site-footer").getByRole("link", { name: "Angre avtalen", exact: true })).toHaveCount(0);
  await expect(link()).toHaveCount(1);
  await expect(link()).toBeVisible();

  // One with the component hidden on phones: a phone still has the link.
  const hidden = await storeWith("skjult", content("Skjult", [row("f", [business, { id: "w", type: "site", part: "withdrawal", hideOnPhones: true }])]));
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`/s/${hidden}/no`);
  await expect(link()).toBeVisible();
  await link().click();
  await expect(page).toHaveURL(`/s/${hidden}/no/withdraw`);
  await expect(page.getByRole("heading", { level: 1, name: "Angre avtalen" })).toBeVisible();
});

test("the function and a return's status are for no search engine, and are not in the sitemap or llms.txt", async ({ page, request }) => {
  await page.goto("/s/demo/no/withdraw");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  for (const path of ["/s/demo/store-sitemap.xml", "/s/demo/llms.txt", "/sitemap.xml", "/llms.txt"]) {
    const response = await request.get(path);
    if (!response.ok()) continue;
    const body = await response.text();
    expect(body, path).not.toMatch(/\/withdraw|\/returns\//);
  }
  // An address nobody was given is the store's "does not exist", whatever the token.
  await page.goto(`/s/demo/no/returns/${"0".repeat(64)}`);
  await expect(page.getByRole("heading", { level: 1, name: "Siden finnes ikke." })).toBeVisible();
});
