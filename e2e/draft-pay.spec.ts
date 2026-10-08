import { createHash, randomBytes } from "node:crypto";

import { expect, test } from "@playwright/test";

import { testDb, testStore } from "./db";

/**
 * A draft order's pay link (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.1 and 6.3 D2): the page a buyer opens from the email a store sent. The rows are made with SQL (staff's editor
 * needs a signed-in admin, which the end-to-end tests do not have): a store with payments switched on, an order waiting for payment and the draft it came from, `sent` with a hashed token.
 * The page shows the order, the seller and the way to pay in the order's language, and one plain sentence for each other state. The button's redirect cannot be followed without Stripe keys:
 * the test presses it and asserts the problem the page then shows. Held elsewhere: the money, the webhook and the order (integration tests with the fake Stripe).
 */

type Fixture = { slug: string; storeId: string; orderId: string; draftId: string; token: string; number: string };

type Options = {
  /** `sent` (the default), `paid`, `expired` or `cancelled`: where the draft and its order are. */
  state?: "sent" | "paid" | "expired" | "cancelled";
  /** The link ran out an hour ago, though the job has not marked the draft. */
  lapsed?: boolean;
  /** Payments are switched off for the store. */
  paymentsOff?: boolean;
  note?: string | null;
  discount?: boolean;
  /** The seller has no contact address. */
  noContact?: boolean;
  /** The market the order was made in (the link only opens under its own country's address); Norway when left out. */
  market?: "NO" | "SE" | "DK";
};

const MARKETS = {
  NO: { slug: "no", currency: "NOK", locale: "nb-NO" },
  SE: { slug: "se", currency: "SEK", locale: "sv-SE" },
  DK: { slug: "dk", currency: "DKK", locale: "da-DK" },
} as const;

async function payLink(options: Options = {}): Promise<Fixture> {
  const state = options.state ?? "sent";
  const market = options.market ?? "NO";
  const m = MARKETS[market];
  // Sweden and Denmark are countries of the store (D178: Several countries on).
  const store = await testStore("paylink", ["countries"]);
  const db = testDb();
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  const number = `PL-${Date.now().toString(36).toUpperCase()}`;
  try {
    await db`
      update commerce.stores set legal_name = 'Lenkebutikken AS', organisation_number = '923456789', postal_address = 'Storgata 1, 0182 Oslo',
        contact_email = ${options.noContact ? null : "hei@lenkebutikken.test"}
      where id = ${store.id}`;
    if (!options.paymentsOff) {
      // Live mode with an active account: payments are on without Kaizen's own Stripe keys, which the end-to-end server has none of.
      await db`
        insert into commerce.payment_providers (store_id, provider, enabled, active_mode) values (${store.id}, 'stripe', true, 'live')
        on conflict (store_id, provider) do update set enabled = true, active_mode = 'live'`;
      await db`
        insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due)
        values (${store.id}, 'live', ${`acct_E2E${Date.now()}`}, 'active', false)
        on conflict (store_id, mode) do update set card_payments = 'active', requirements_due = false`;
    } else {
      await db`delete from commerce.payment_providers where store_id = ${store.id}`;
    }

    const [draft] = await db`
      insert into commerce.draft_orders (store_id, number, market_code, market_slug, currency, locale, email, note_to_buyer)
      values (${store.id}, 'D-1', ${market}, ${m.slug}, ${m.currency}, ${m.locale}, 'kari@example.com', ${options.note ?? null})
      returning id`;

    const discount = options.discount ? 10000 : 0;
    const total = 125000 + 9900 - discount;
    const address = db.json({ name: "Kari Nordmann", line1: "Storgata 5", line2: null, postalCode: "0182", city: "Oslo", country: market });
    const [order] = await db`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, staff_discount_minor, staff_discount_label,
        tax_minor, total_minor, billing_address, shipping_address, shipping_tax_rate)
      values (${store.id}, ${number}, ${market}, ${m.currency}, ${m.locale}, 'kari@example.com', ${state === "sent" ? "pending_payment" : state === "paid" ? "paid" : "cancelled"}, 125000, 9900, ${discount},
        ${discount}, ${options.discount ? "Venneprisen" : null}, ${Math.round(total * 0.2)}, ${total}, ${address}, ${address}, 0.25)
      returning id`;
    await db`
      insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
      values (${store.id}, ${order.id}, ${`E2E-${number}`}, 'Ullgenser', 2, 62500, ${discount}, ${125000 - discount}, ${Math.round((125000 - discount) * 0.2)}, 0.25, 'txcd_99999999', 'physical')`;

    // The draft is made open, then sent: the database's own lifecycle takes it there.
    const sentAt = new Date(Date.now() - 2 * 86_400_000);
    const expiresAt = options.lapsed ? new Date(Date.now() - 3_600_000) : new Date(Date.now() + 5 * 86_400_000);
    await db`
      update commerce.draft_orders set status = 'sent', order_id = ${order.id}, sent_at = ${sentAt}, expires_at = ${expiresAt}, pay_token_hash = ${hash}, valid_days = 7
      where id = ${draft.id}`;
    if (state === "paid") await db`update commerce.draft_orders set status = 'paid', paid_at = now() where id = ${draft.id}`;
    if (state === "expired") await db`update commerce.draft_orders set status = 'expired' where id = ${draft.id}`;
    if (state === "cancelled") await db`update commerce.draft_orders set status = 'cancelled' where id = ${draft.id}`;
    return { slug: store.slug, storeId: store.id, orderId: order.id, draftId: draft.id, token, number };
  } finally {
    await db.end();
  }
}

test("a pay link shows the order, the seller and the way to pay, in the order's language", async ({ page }) => {
  const f = await payLink({ note: "Hentes fredag", discount: true });
  await page.goto(`/s/${f.slug}/no/account/pay/${f.token}`);

  await expect(page.getByRole("heading", { level: 1, name: `Bestilling ${f.number}` })).toBeVisible();
  // The seller: the page has no site footer.
  const seller = page.getByRole("region", { name: "Selger" });
  await expect(seller).toContainText("Lenkebutikken AS");
  await expect(seller).toContainText("923456789");
  await expect(seller).toContainText("Storgata 1, 0182 Oslo");
  await expect(seller).toContainText("hei@lenkebutikken.test");
  // The order: the lines at what was agreed, the staff's discount under its own name, the total with VAT.
  const order = page.getByRole("region", { name: "Din bestilling" });
  await expect(order).toContainText("2 × Ullgenser");
  await expect(order).toContainText(/1\s?250,00\s*kr/);
  await expect(order).toContainText("Venneprisen");
  await expect(order).toContainText(/−\s?100,00\s*kr/);
  await expect(order).toContainText(/1\s?249,00\s*kr/);
  await expect(order).toContainText("Frakt");
  await expect(page.getByRole("region", { name: "Melding fra butikken" })).toContainText("Hentes fredag");
  await expect(page.getByText(/Lenken gjelder til/)).toBeVisible();
  await expect(page.getByText("Du kan angre kjøpet innen 14 dager etter at du har mottatt varen")).toBeVisible();
  // One button, with the amount, and where it leads.
  // The store's own header has buttons too: only the page's own are counted.
  const own = page.locator("[data-pay-link]");
  await expect(own.getByRole("button", { name: /^Betal / })).toBeEnabled();
  await expect(own.getByRole("button")).toHaveCount(1);
  await expect(page.getByText("Du sendes til Stripes sikre betalingsside.")).toBeVisible();
});

test("the pay link is not indexed, passes no referrer, sets no cookie, and loads nothing from another site", async ({ page, context }) => {
  const f = await payLink();
  const origin = new URL(test.info().project.use.baseURL ?? "http://localhost:3000").origin;
  const foreign: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["data:", "blob:", "about:"].includes(url.protocol) && url.origin !== origin) foreign.push(request.url());
  });
  await page.goto(`/s/${f.slug}/no/account/pay/${f.token}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  expect(await context.cookies()).toEqual([]);
  // No Stripe.js and no card field: the button hands the buyer to Stripe's own page.
  await expect(page.locator('script[src*="stripe"]')).toHaveCount(0);
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.locator('input[autocomplete^="cc-"]')).toHaveCount(0);
  expect(foreign).toEqual([]);
  // No chat, consent banner or owner code either: the layout draws none of its extras here.
  await expect(page.getByRole("region", { name: /informasjonskapsler/i })).toHaveCount(0);
});

test("pressing the button where Stripe cannot be reached says so on the same page and changes nothing", async ({ page }) => {
  const f = await payLink();
  await page.goto(`/s/${f.slug}/no/account/pay/${f.token}`);
  await page.getByRole("button", { name: /^Betal / }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Butikken kan ikke ta imot betaling akkurat nå." })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/account/pay/${f.token}$`));
  // The order is as it was: still waiting for payment, still the draft's.
  const db = testDb();
  try {
    const [row] = await db`select status from commerce.orders where id = ${f.orderId}`;
    expect(row.status).toBe("pending_payment");
  } finally {
    await db.end();
  }
});

test("a paid order says it is paid and offers no way to pay again", async ({ page }) => {
  const f = await payLink({ state: "paid" });
  await page.goto(`/s/${f.slug}/no/account/pay/${f.token}`);
  await expect(page.getByText("Denne bestillingen er betalt. Takk!")).toBeVisible();
  await expect(page.locator("[data-pay-link]").getByRole("button")).toHaveCount(0);
});

test("an expired, cancelled or lapsed link says it no longer works, with the store's address, and shows nothing of the order", async ({ page }) => {
  for (const options of [{ state: "expired" }, { state: "cancelled" }, { lapsed: true }] as Options[]) {
    const f = await payLink(options);
    await page.goto(`/s/${f.slug}/no/account/pay/${f.token}`);
    await expect(page.getByText("Denne lenken virker ikke lenger. Be butikken om en ny.")).toBeVisible();
    await expect(page.getByText("Kontakt butikken: hei@lenkebutikken.test")).toBeVisible();
    await expect(page.getByText("Ullgenser")).toHaveCount(0);
    await expect(page.locator("[data-pay-link]").getByRole("button")).toHaveCount(0);
  }
});

test("a store that cannot take payments says so and shows no button", async ({ page }) => {
  const f = await payLink({ paymentsOff: true });
  await page.goto(`/s/${f.slug}/no/account/pay/${f.token}`);
  await expect(page.getByText("Butikken kan ikke ta imot betaling akkurat nå.")).toBeVisible();
  await expect(page.locator("[data-pay-link]").getByRole("button")).toHaveCount(0);
});

test("a token that is another store's, malformed or unknown is the same page as one that never existed", async ({ page }) => {
  const f = await payLink();
  const other = await payLink();
  for (const token of [other.token, "short", "x".repeat(43), "not a token at all"]) {
    await page.goto(`/s/${f.slug}/no/account/pay/${encodeURIComponent(token)}`);
    await expect(page.getByText("Ullgenser"), token).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Betal / }), token).toHaveCount(0);
    await expect(page.locator("[data-pay-link]"), token).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]').first(), token).toHaveAttribute("content", /noindex/);
  }
  // And a link of this store does not open under another's address.
  await page.goto(`/s/${other.slug}/no/account/pay/${f.token}`);
  await expect(page.getByText("Ullgenser")).toHaveCount(0);
});

test("a link is said in Swedish and Danish when it was made for those markets", async ({ page }) => {
  const sv = await payLink({ state: "expired", market: "SE" });
  await page.goto(`/s/${sv.slug}/se/account/pay/${sv.token}`);
  await expect(page.getByText("Den här länken fungerar inte längre. Be butiken om en ny.")).toBeVisible();
  const da = await payLink({ state: "expired", market: "DK" });
  await page.goto(`/s/${da.slug}/dk/account/pay/${da.token}`);
  await expect(page.getByText("Dette link virker ikke længere. Bed butikken om et nyt.")).toBeVisible();
  // A link made for Norway is not found under Sweden's address (the VAT, the terms and Stripe's countries were decided for its own market).
  const no = await payLink({ state: "sent" });
  await page.goto(`/s/${no.slug}/se/account/pay/${no.token}`);
  await expect(page.getByText("Ullgenser")).toHaveCount(0);
});
