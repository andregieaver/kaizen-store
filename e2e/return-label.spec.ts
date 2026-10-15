import { expect, test } from "@playwright/test";

import { nbExchange, nbReturnLabel } from "../src/lib/messages/nb-exchange";
import { describeFindings, violationsOn } from "./a11y";
import { bookedLabelFixture } from "./exchange-fixtures";

/**
 * The return label for the shopper (wave 3, D239, `docs/wave-3-exchanges.md` 2.4, 5.3 and 6.2): a label booked with the store's carrier is printed from the
 * return's status page through Kaizen's own route (`/returns/{token}/label`), never the carrier's address, with the carrier, the tracking number and who pays. The
 * rows are made with SQL (`exchange-fixtures.ts`). The route's fetch from Bring needs the store's agreement and Bring itself, which the end-to-end server has
 * neither of: its PDF answer is held by `return-labels.int.test.ts` (a faked carrier) and the route's unit test; here, that it refuses what it must.
 */

const l = nbReturnLabel;

test("a booked label is printed through Kaizena Flow's route, with the carrier, the tracking number and what is taken off the refund", async ({ page }) => {
  const f = await bookedLabelFixture();
  await page.goto(`/s/${f.slug}/no/returns/${f.returnToken}`);
  const card = page.locator("[data-return-label]");
  await expect(card.getByRole("heading", { name: l.heading })).toBeVisible();
  const print = card.getByRole("link", { name: l.print });
  await expect(print).toHaveAttribute("href", `/s/${f.slug}/no/returns/${f.returnToken}/label`);
  await expect(card).toContainText(l.carrier("Posten / Bring"));
  await expect(card).toContainText("370438101");
  await expect(card.getByRole("link", { name: l.track })).toHaveAttribute("href", "https://tracking.bring.com/tracking/370438101");
  await expect(card).toContainText(/89,00\s*kr/);
  await expect(card).not.toContainText(l.test);
  // The carrier's own label address (it needs the store's keys) is never on the page.
  expect(await page.content()).not.toContain("api.bring.com");
  // No exchange was proposed, so the status page says nothing about one beyond the wish.
  await expect(page.getByText(nbExchange.status.proposed)).toHaveCount(0);
});

test("a test label says it cannot be used, and a label the store pays for says shipping is free", async ({ page }) => {
  const testLabel = await bookedLabelFixture({ test: true });
  await page.goto(`/s/${testLabel.slug}/no/returns/${testLabel.returnToken}`);
  await expect(page.locator("[data-return-label]")).toContainText(l.test);
  const free = await bookedLabelFixture({ storePays: true });
  await page.goto(`/s/${free.slug}/no/returns/${free.returnToken}`);
  await expect(page.locator("[data-return-label]")).toContainText(l.freeForYou);
  await expect(page.locator("[data-return-label]")).not.toContainText(/89,00/);
});

test("the label route is a plain 404 for another store's or an unknown token, and stores and sets nothing", async ({ request }) => {
  const f = await bookedLabelFixture();
  const other = await bookedLabelFixture();
  for (const path of [`/s/${other.slug}/no/returns/${f.returnToken}/label`, `/s/${f.slug}/no/returns/${"f".repeat(64)}/label`, `/s/${f.slug}/no/returns/nope/label`]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(404);
    expect(res.headers()["cache-control"], path).toContain("no-store");
    expect(res.headers()["set-cookie"], path).toBeUndefined();
  }
  // The store's own token reaches the carrier, which is not there in the end-to-end server: a page saying to try again, never the carrier's answer.
  const own = await request.get(`/s/${f.slug}/no/returns/${f.returnToken}/label`, { maxRedirects: 0 });
  expect([404, 503]).toContain(own.status());
  expect(own.headers()["cache-control"]).toContain("no-store");
  expect(own.headers()["x-robots-tag"]).toBe("noindex");
  expect(await own.text()).not.toContain("api.bring.com");
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme });

    test("the status page with a booked label has no serious or critical accessibility violation", async ({ page }) => {
      const f = await bookedLabelFixture();
      await page.goto(`/s/${f.slug}/no/returns/${f.returnToken}`);
      await expect(page.locator("[data-return-label]")).toBeVisible();
      expect(describeFindings(await violationsOn(page))).toEqual([]);
    });
  });
}
