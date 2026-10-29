import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { OWNER } from "./accounts";

/**
 * What a payment was, Stripe's risk and disputes on the owner's screens (wave 4 unit A, D288; rows checkout.fraud-analysis-and-risk-flags,
 * checkout.chargeback-and-dispute-handling, analytics.payments-reports-by-method): the order page's Payment card, the list's badges and filters, and the
 * Finance page's payments by method and lost disputes. The reading from Stripe and the webhook are held by payment-disputes.int.test.ts; this holds
 * the screens that show what they stored.
 */

test.use({ storageState: OWNER.state });
// One worker for the file: its setup makes the store's orders once, so the Finance page's counts are this run's.
test.describe.configure({ mode: "serial" });

/** A store of the owner's own, so the orders here are no other spec's. */
const STORE = "e2e-pay";
const RUN = Date.now().toString(36).toUpperCase();
const ids = { risky: "", disputed: "", lost: "" };

test.beforeAll(async () => {
  const sql = testDb();
  try {
    // The owner's store, made once: other specs make theirs for the same owner at the same time, and a pending request is one per email.
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('e2e-owner-request'))`;
      if ((await tx`select 1 from commerce.stores where slug = ${STORE}`).length > 0) return;
      const [request] = await tx`insert into commerce.access_requests (email, name, store_name) values (${OWNER.email}, ${OWNER.name}, 'E2E Pay') returning id`;
      await tx`select commerce.approve_access_request(${request.id}, ${STORE}, 'E2E Pay', null)`;
    });
    await sql`update commerce.stores set setup_completed_at = coalesce(setup_completed_at, now()) where slug = ${STORE}`;
    const [store] = await sql`select id from commerce.stores where slug = ${STORE}`;
    const address = sql.json({ name: "Kari Nordmann", line1: "Storgata 5", line2: null, postalCode: "0182", city: "Oslo", country: "NO" });
    const order = async (key: keyof typeof ids, facts: { wallet: string | null; risk: string; score: number }) => {
      const number = `PAY-${RUN}-${key.toUpperCase()}`;
      const [o] = await sql`
        insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
          billing_address, shipping_address, shipping_tax_rate)
        values (${store.id}, ${number}, 'NO', 'NOK', 'nb-NO', 'kari@example.com', 'paid', 50000, 0, 0, 10000, 50000, ${address}, ${address}, 0.25)
        returning id`;
      await sql`
        insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
        values (${store.id}, ${o.id}, ${`${number}-L`}, 'Ullgenser', 1, 50000, 0, 50000, 10000, 0.25, 'txcd_99999999', 'physical')`;
      const [p] = await sql`
        insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status, method_type, wallet, card_brand, risk_level, risk_score, charge_reference, facts_read_at)
        values (${store.id}, ${o.id}, 'stripe', ${`cs_e2e_${number.toLowerCase()}`}, 50000, 'NOK', 'captured', 'card', ${facts.wallet}, 'visa', ${facts.risk}, ${facts.score}, ${`ch_e2e_${number.toLowerCase()}`}, now())
        returning id`;
      ids[key] = String(o.id);
      return { order: String(o.id), payment: String(p.id), number };
    };
    await order("risky", { wallet: null, risk: "elevated", score: 71 });
    const open = await order("disputed", { wallet: "apple_pay", risk: "normal", score: 10 });
    const lost = await order("lost", { wallet: null, risk: "normal", score: 5 });
    await sql`
      insert into commerce.payment_disputes (store_id, order_id, payment_id, provider, provider_reference, amount_minor, currency, reason, status, evidence_due_by, opened_at)
      values (${store.id}, ${open.order}, ${open.payment}, 'stripe', ${`dp_e2e_${RUN}_open`}, 50000, 'NOK', 'product_not_received', 'needs_response', now() + interval '6 days', now())`;
    await sql`
      insert into commerce.payment_disputes (store_id, order_id, payment_id, provider, provider_reference, amount_minor, currency, reason, status, outcome, fee_minor, opened_at, closed_at)
      values (${store.id}, ${lost.order}, ${lost.payment}, 'stripe', ${`dp_e2e_${RUN}_lost`}, 50000, 'NOK', 'fraudulent', 'lost', 'lost', 15000, now(), now())`;
  } finally {
    await sql.end();
  }
});

test("the order page shows how it was paid, Stripe's elevated risk and an open dispute with its deadline and the way to Stripe", async ({ page }) => {
  await page.goto(`/admin/${STORE}/orders/${ids.risky}`);
  const card = page.getByRole("region", { name: "Payment" });
  await expect(card.getByText("Card (Visa)")).toBeVisible();
  await expect(card.getByText("Stripe: elevated risk (71 of 100)")).toBeVisible();

  await page.goto(`/admin/${STORE}/orders/${ids.disputed}`);
  const disputed = page.getByRole("region", { name: "Payment" });
  await expect(disputed.getByText("Apple Pay (Visa)")).toBeVisible();
  await expect(disputed.getByText("risk")).toHaveCount(0);
  await expect(disputed.getByText("Disputed", { exact: true })).toBeVisible();
  await expect(disputed.getByText("The customer says the goods did not arrive")).toBeVisible();
  await expect(disputed.getByText("Evidence due")).toBeVisible();
  await expect(disputed.getByRole("link", { name: "Open in Stripe" })).toHaveAttribute("href", `https://dashboard.stripe.com/payments/disputes/dp_e2e_${RUN}_open`);
});

test("the list marks risky and disputed orders and filters by them", async ({ page }) => {
  await page.goto(`/admin/${STORE}/orders?q=${encodeURIComponent(`PAY-${RUN}`)}`);
  const row = (key: string) => page.getByRole("row").filter({ hasText: `PAY-${RUN}-${key}` });
  await expect(row("RISKY").getByText("Elevated risk")).toBeVisible();
  await expect(row("DISPUTED").getByText("Disputed", { exact: true })).toBeVisible();
  // A lost dispute still marks the order; a won one would not.
  await expect(row("LOST").getByText("Disputed", { exact: true })).toBeVisible();

  await page.goto(`/admin/${STORE}/orders?q=${encodeURIComponent(`PAY-${RUN}`)}&pay=elevated_risk`);
  await expect(page.getByRole("row").filter({ hasText: `PAY-${RUN}-` })).toHaveCount(1);
  await expect(row("RISKY")).toHaveCount(1);
  await page.goto(`/admin/${STORE}/orders?q=${encodeURIComponent(`PAY-${RUN}`)}&pay=disputed`);
  await expect(page.getByRole("row").filter({ hasText: `PAY-${RUN}-` })).toHaveCount(2);
});

test("the Finance page lists payments by method and takes the lost dispute off profit, not as a refund", async ({ page }) => {
  // Card payments without a wallet of the store's paid orders today: this run's two, and any an earlier run on the same database left.
  const sql = testDb();
  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int as n from commerce.payments p join commerce.stores s on s.id = p.store_id
     where s.slug = ${STORE} and p.status = 'captured' and p.method_type = 'card' and p.wallet is null and p.created_at > now() - interval '12 hours'`;
  await sql.end();
  await page.goto(`/admin/${STORE}/analytics/finance?period=today`);
  const methods = page.getByRole("region", { name: "Payments by method" });
  const card = methods.getByRole("row").filter({ has: page.getByRole("cell", { name: "Card", exact: true }) });
  await expect(card.getByRole("cell").nth(1)).toHaveText(String(n));
  await expect(methods.getByRole("row").filter({ has: page.getByRole("cell", { name: "Apple Pay", exact: true }) })).toBeVisible();
  const bridge = page.locator('table[data-export-id="finance.bridge"]');
  await expect(bridge.getByRole("row").filter({ hasText: "Lost disputes" })).toBeVisible();
});
