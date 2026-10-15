import { expect, test } from "@playwright/test";

import { nbBrowser } from "../src/lib/messages/nb-browser";
import { nbExchange } from "../src/lib/messages/nb-exchange";
import { describeFindings, violationsOn } from "./a11y";
import { exchangeFixture, exchangeStatus, wishFixture, wishOf } from "./exchange-fixtures";

/**
 * The shopper's side of an exchange (wave 3, D239, `docs/wave-3-exchanges.md` 2.1, 5.3 and 6.1): the page a customer opens from the store's proposal, and the wish
 * on a return's status page. The rows are made with SQL (`exchange-fixtures.ts`): a paid order of one sweater (599,00), an approved return of it, and a proposal of
 * another sweater (649,00: 50,00 to pay). The page shows the seller, what is sent back, the credit, what comes instead and the outcome in the order's language;
 * *Confirm the exchange* is the customer's own press (recorded as theirs, nothing charged), *No thanks* ends it; every other state is one plain sentence. The pay
 * step's redirect to Stripe and processing are held by the integration tests with the fake Stripe (the end-to-end server has no Stripe keys).
 */

const x = nbExchange;
/** The words of a sentence before its amount or date, to find it whatever the amount's spaces. */
const before = (words: (value: string) => string) => words("§").split("§")[0];

test("a proposal shows the seller, what is sent back, the credit, what comes instead and the outcome, and the customer's press confirms it", async ({ page }) => {
  const f = await exchangeFixture();
  await page.goto(`/s/${f.slug}/no/account/exchange/${f.token}`);

  await expect(page.getByRole("heading", { level: 1, name: `${x.title} · ${x.returnNumber(f.returnNumber)}` })).toBeVisible();
  const seller = page.getByRole("region", { name: x.sellerHeading });
  await expect(seller).toContainText("Byttebutikken AS");
  await expect(seller).toContainText("923456789");
  await expect(page.getByRole("region", { name: x.sendBack })).toContainText("Ullgenser – S");
  const summary = page.getByRole("region", { name: x.title });
  await expect(summary).toContainText(/599,00\s*kr/);
  await expect(summary).toContainText("1 × Ullgenser – M");
  await expect(summary).toContainText(/649,00\s*kr/);
  await expect(page.locator("[data-exchange-outcome]")).toHaveText(/Du betaler 50,00\s*kr/);
  await expect(page.getByText(x.agreement)).toBeVisible();
  await expect(page.getByText(x.newPurchase)).toBeVisible();
  await expect(page.getByText(before(x.confirmBy))).toBeVisible();
  // Nothing is charged here: no card field and no Stripe.js.
  await expect(page.locator('script[src*="stripe"]')).toHaveCount(0);
  await expect(page.locator('input[autocomplete^="cc-"]')).toHaveCount(0);

  await page.getByRole("button", { name: x.confirm }).click();
  // The page is drawn afresh in its new state, and the focus goes to the sentence that says what happened.
  const done = page.getByRole("status").filter({ hasText: x.confirmed });
  await expect(done).toBeVisible();
  await expect(done).toBeFocused();
  await expect(done).toContainText(before(x.confirmedPay));
  await expect(done).toContainText(/50,00\s*kr/);
  await expect(page.getByRole("button", { name: x.confirm })).toHaveCount(0);
  expect(await exchangeStatus(f.exchangeId)).toEqual({ status: "confirmed", confirmedBy: "customer", channel: "web" });
});

test("No thanks ends the proposal and says the money comes back as usual", async ({ page }) => {
  const f = await exchangeFixture({ difference: "refund_due" });
  await page.goto(`/s/${f.slug}/no/account/exchange/${f.token}`);
  await expect(page.locator("[data-exchange-outcome]")).toContainText(before(x.outcomeRefund));
  await expect(page.locator("[data-exchange-outcome]")).toContainText(/100,00\s*kr/);
  await page.getByRole("button", { name: x.decline }).click();
  await expect(page.getByRole("status").filter({ hasText: x.declined })).toBeVisible();
  expect((await exchangeStatus(f.exchangeId)).status).toBe("declined_by_customer");
});

test("with the store's terms ticked at checkout, Confirm waits for the tick", async ({ page }) => {
  const f = await exchangeFixture({ termsCheckbox: true, difference: "even" });
  await page.goto(`/s/${f.slug}/no/account/exchange/${f.token}`);
  await expect(page.locator("[data-exchange-outcome]")).toHaveText(x.outcomeEven);
  const confirm = page.getByRole("button", { name: x.confirm });
  const box = page.getByRole("checkbox");
  // A store with no terms page published shows no sentence; when it has one, the box holds the button.
  if ((await box.count()) > 0) {
    await expect(confirm).toBeDisabled();
    await box.check();
  }
  await expect(confirm).toBeEnabled();
});

test("the exchange page is not indexed, passes no referrer, sets no cookie and loads nothing from another site", async ({ page, context }) => {
  const f = await exchangeFixture();
  const origin = new URL(test.info().project.use.baseURL ?? "http://localhost:3000").origin;
  const foreign: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["data:", "blob:", "about:"].includes(url.protocol) && url.origin !== origin) foreign.push(request.url());
  });
  await page.goto(`/s/${f.slug}/no/account/exchange/${f.token}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  expect(await context.cookies()).toEqual([]);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(foreign).toEqual([]);
  await expect(page.getByRole("region", { name: /informasjonskapsler/i })).toHaveCount(0);
});

test("an ended proposal is one plain sentence with no button and nothing of the goods", async ({ page }) => {
  for (const [state, words] of [
    ["expired", x.states.expired],
    ["cancelled", x.states.cancelled],
    ["superseded", x.states.refunded],
  ] as const) {
    const f = await exchangeFixture({ state });
    await page.goto(`/s/${f.slug}/no/account/exchange/${f.token}`);
    await expect(page.getByText(words), state).toBeVisible();
    await expect(page.locator("[data-exchange-page]").getByRole("button"), state).toHaveCount(0);
    await expect(page.getByText("Ullgenser – M"), state).toHaveCount(0);
  }
});

test("a token that is another store's, malformed or unknown, or opened under another country, is the same page as one that never existed", async ({ page }) => {
  const f = await exchangeFixture();
  const other = await exchangeFixture();
  for (const token of [other.token, "short", "x".repeat(43), "not a token at all"]) {
    await page.goto(`/s/${f.slug}/no/account/exchange/${encodeURIComponent(token)}`);
    await expect(page.locator("[data-exchange-page]"), token).toHaveCount(0);
    await expect(page.getByRole("button", { name: x.confirm }), token).toHaveCount(0);
  }
  await page.goto(`/s/${other.slug}/no/account/exchange/${f.token}`);
  await expect(page.locator("[data-exchange-page]")).toHaveCount(0);
  await page.goto(`/s/${f.slug}/se/account/exchange/${f.token}`);
  await expect(page.locator("[data-exchange-page]")).toHaveCount(0);
});

test("the return's status page takes an exchange wish once, says it is sent, and asks for words first", async ({ page }) => {
  const w = nbBrowser.exchangeWish;
  const f = await wishFixture();
  await page.goto(`/s/${f.slug}/no/returns/${f.returnToken}`);
  const field = page.getByRole("textbox", { name: w.label });
  await expect(page.getByRole("heading", { name: w.heading })).toBeVisible();
  await page.getByRole("button", { name: w.button }).click();
  await expect(page.getByRole("alert").filter({ hasText: w.empty })).toBeVisible();
  expect((await wishOf(f.returnId)).at).toBeNull();

  await field.fill("Størrelse M i stedet");
  await page.getByRole("button", { name: w.button }).click();
  await expect(page.getByRole("status").filter({ hasText: w.sent })).toBeVisible();
  await expect(page.getByRole("textbox", { name: w.label })).toHaveCount(0);
  expect((await wishOf(f.returnId)).note).toBe("Størrelse M i stedet");
  // The words are not shown back, and a reload does not offer the field again.
  await page.reload();
  await expect(page.getByText(w.sent)).toBeVisible();
  await expect(page.getByText("Størrelse M i stedet")).toHaveCount(0);
});

test("the status page shows where a proposed exchange stands, and never links its page", async ({ page }) => {
  const f = await exchangeFixture();
  await page.goto(`/s/${f.slug}/no/returns/${f.returnToken}`);
  const card = page.locator("[data-exchange-status]");
  await expect(card).toContainText(x.status.proposed);
  await expect(card).toContainText(x.status.inEmail);
  await expect(page.locator('a[href*="/account/exchange/"]')).toHaveCount(0);
  // With a proposal out, the wish is not asked for.
  await expect(page.getByRole("textbox", { name: nbBrowser.exchangeWish.label })).toHaveCount(0);
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme });

    test("the exchange page and the wish have no serious or critical accessibility violation", async ({ page }) => {
      const f = await exchangeFixture();
      await page.goto(`/s/${f.slug}/no/account/exchange/${f.token}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(describeFindings(await violationsOn(page))).toEqual([]);
      const w = await wishFixture();
      await page.goto(`/s/${w.slug}/no/returns/${w.returnToken}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(describeFindings(await violationsOn(page))).toEqual([]);
    });
  });
}
