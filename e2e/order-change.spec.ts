import { expect, test } from "@playwright/test";

import { describeFindings, violationsOn } from "./a11y";
import { changeLink, changeStatus, orderStatus } from "./fulfilment-fixtures";

/**
 * A change's pay link (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 2.4, 5.3 and 6.1 E2): the page a customer opens from the email a store sent after changing their paid order to a
 * higher total. The rows are made with SQL (`fulfilment-fixtures.ts`; staff's editor needs a signed-in admin, which the end-to-end tests do not have): a paid order of two sweaters, and a
 * change that takes one off and adds two scarves, waiting for 149,00 kr. The page shows the seller, what changes, what was paid and what is to pay now in the order's language, and one plain
 * sentence for each other state. The button's redirect cannot be followed without Stripe keys: the test presses it and asserts the problem the page then shows. Held elsewhere: the money,
 * the webhook, the documents and the order as changed (integration tests with the fake Stripe).
 */

test("a change's link shows the seller, what changes, what was paid and what is to pay now, in the order's language", async ({ page }) => {
  const f = await changeLink();
  await page.goto(`/s/${f.slug}/no/account/change/${f.token}`);

  await expect(page.getByRole("heading", { level: 1, name: `Endring av bestilling ${f.number}` })).toBeVisible();
  // The seller: the page has no site footer.
  const seller = page.getByRole("region", { name: "Selger" });
  await expect(seller).toContainText("Endringsbutikken AS");
  await expect(seller).toContainText("923456789");
  await expect(seller).toContainText("hei@endringsbutikken.test");
  // What changes, with quantities and line totals, and the money.
  const change = page.getByRole("region", { name: "Din bestilling" });
  await expect(change).toContainText("Tatt ut");
  await expect(change).toContainText("1 × Ullgenser");
  await expect(change).toContainText(/−\s?625,00\s*kr/);
  await expect(change).toContainText("Lagt til");
  await expect(change).toContainText("2 × Skjerf");
  await expect(change).toContainText(/774,00\s*kr/);
  await expect(change).toContainText(/Ny sum for bestillingen\s*1\s?498,00\s*kr/);
  await expect(change).toContainText(/Allerede betalt\s*1\s?349,00\s*kr/);
  await expect(change).toContainText(/Å betale nå: 149,00\s*kr/);
  // Until when, and that nothing changes unless the customer pays (CRD Art. 22).
  await expect(page.getByText(/For å bekrefte endringen betaler du 149,00\s*kr innen .*forblir bestillingen som den var\./)).toBeVisible();
  await expect(page.getByText(/Du kan angre innen 14 dager etter at du har mottatt den siste pakken i bestillingen/)).toBeVisible();
  await expect(page.getByText("Vilkårene du godtok da du bestilte, gjelder også for endringen.")).toBeVisible();
  // One button, with the amount; nothing to tick.
  const own = page.locator("[data-change-link]");
  await expect(own.getByRole("button", { name: /^Betal 149,00/ })).toBeEnabled();
  await expect(own.getByRole("button")).toHaveCount(1);
  await expect(own.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByText("Du sendes til Stripes sikre betalingsside.")).toBeVisible();
});

test("the change link is not indexed, passes no referrer, sets no cookie, and loads nothing from another site", async ({ page, context }) => {
  const f = await changeLink();
  const origin = new URL(test.info().project.use.baseURL ?? "http://localhost:3000").origin;
  const foreign: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["data:", "blob:", "about:"].includes(url.protocol) && url.origin !== origin) foreign.push(request.url());
  });
  await page.goto(`/s/${f.slug}/no/account/change/${f.token}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  expect(await context.cookies()).toEqual([]);
  // No Stripe.js and no card field: the button hands the customer to Stripe's own page.
  await expect(page.locator('script[src*="stripe"]')).toHaveCount(0);
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.locator('input[autocomplete^="cc-"]')).toHaveCount(0);
  expect(foreign).toEqual([]);
  // No chat, consent banner or owner code either: the layout draws none of its extras here.
  await expect(page.getByRole("region", { name: /informasjonskapsler/i })).toHaveCount(0);
});

test("pressing the button where Stripe cannot be reached says so on the same page and changes nothing", async ({ page }) => {
  const f = await changeLink();
  await page.goto(`/s/${f.slug}/no/account/change/${f.token}`);
  await page.getByRole("button", { name: /^Betal / }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Butikken kan ikke ta imot betaling akkurat nå." })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/account/change/${f.token}$`));
  // The order and the change are as they were: paid, and still waiting.
  expect(await orderStatus(f.orderId)).toBe("paid");
  expect(await changeStatus(f.editId)).toBe("awaiting_payment");
});

test("a paid change says the order is updated and offers no way to pay again", async ({ page }) => {
  const f = await changeLink({ state: "applied" });
  await page.goto(`/s/${f.slug}/no/account/change/${f.token}`);
  await expect(page.getByText("Denne endringen er betalt, og bestillingen din er oppdatert.")).toBeVisible();
  await expect(page.locator("[data-change-link]").getByRole("button")).toHaveCount(0);
});

test("an expired, cancelled or lapsed link says the order is unchanged, with the store's address, and shows nothing of the change", async ({ page }) => {
  for (const options of [{ state: "expired" }, { state: "cancelled" }, { lapsed: true }] as const) {
    const f = await changeLink(options);
    await page.goto(`/s/${f.slug}/no/account/change/${f.token}`);
    await expect(page.getByText("Denne lenken virker ikke lenger. Bestillingen din er uendret. Spør butikken hvis du fortsatt vil ha endringen.")).toBeVisible();
    await expect(page.getByText("Kontakt butikken: hei@endringsbutikken.test")).toBeVisible();
    await expect(page.getByText("Skjerf")).toHaveCount(0);
    await expect(page.locator("[data-change-link]").getByRole("button")).toHaveCount(0);
  }
});

test("a store that cannot take payments shows the change and says so, with no button", async ({ page }) => {
  const f = await changeLink({ paymentsOff: true });
  await page.goto(`/s/${f.slug}/no/account/change/${f.token}`);
  await expect(page.getByText("2 × Skjerf")).toBeVisible();
  await expect(page.getByText("Butikken kan ikke ta imot betaling akkurat nå.")).toBeVisible();
  await expect(page.locator("[data-change-link]").getByRole("button")).toHaveCount(0);
});

test("a token that is another store's, malformed or unknown, or opened under another country, is the same page as one that never existed", async ({ page }) => {
  const f = await changeLink();
  const other = await changeLink();
  for (const token of [other.token, "short", "x".repeat(43), "not a token at all"]) {
    await page.goto(`/s/${f.slug}/no/account/change/${encodeURIComponent(token)}`);
    await expect(page.getByText("Skjerf"), token).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Betal / }), token).toHaveCount(0);
    await expect(page.locator("[data-change-link]"), token).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]').first(), token).toHaveAttribute("content", /noindex/);
  }
  // A link of this store does not open under another's address, nor under another country of its own.
  await page.goto(`/s/${other.slug}/no/account/change/${f.token}`);
  await expect(page.getByText("Skjerf")).toHaveCount(0);
  await page.goto(`/s/${f.slug}/se/account/change/${f.token}`);
  await expect(page.getByText("Skjerf")).toHaveCount(0);
  await expect(page.locator("[data-change-link]")).toHaveCount(0);
});

test("a change's link is said in Swedish and Danish when the order was placed in those markets", async ({ page }) => {
  const sv = await changeLink({ state: "expired", market: "SE" });
  await page.goto(`/s/${sv.slug}/se/account/change/${sv.token}`);
  await expect(page.getByRole("heading", { level: 1, name: `Ändring av beställning ${sv.number}` })).toBeVisible();
  const da = await changeLink({ market: "DK" });
  await page.goto(`/s/${da.slug}/dk/account/change/${da.token}`);
  await expect(page.getByRole("heading", { level: 1, name: `Ændring af bestilling ${da.number}` })).toBeVisible();
  await expect(page.locator("[data-change-link]").getByRole("button", { name: /149,00/ })).toBeVisible();
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme });

    test("the change link has no serious or critical accessibility violation", async ({ page }) => {
      const f = await changeLink();
      await page.goto(`/s/${f.slug}/no/account/change/${f.token}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(describeFindings(await violationsOn(page))).toEqual([]);
    });
  });
}
