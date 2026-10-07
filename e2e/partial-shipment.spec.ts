import { expect, test } from "@playwright/test";

import { describeFindings, violationsOn } from "./a11y";
import { orderStatus, paidGoodsOrder, sendParcel } from "./fulfilment-fixtures";

/**
 * An order sent in parts, as the shopper sees it (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 2.4, 5.3 and 6.2 F2): the order page lists each parcel with its day, carrier, tracking
 * and lines, and what is still to come, in the shop's language; once the last parcel is sent it says Sent. The parcels are recorded with SQL the way `markSent()` records them (the staff
 * screen needs a signed-in admin, which the end-to-end tests do not have); the send rules, the emails and the bulk send are held by `fulfilment.int.test.ts`.
 */

const orderPage = (f: { slug: string; orderId: string; key: string }, market = "no") => `/s/${f.slug}/${market}/order/${f.orderId}?session_id=${f.key}`;

test("an order sent in two parcels lists both with their lines, and what is still to come until the last one", async ({ page }) => {
  const f = await paidGoodsOrder();
  await sendParcel(f, {
    carrier: "Posten",
    tracking: "70712345678901234",
    url: "https://sporing.posten.no/sporing/70712345678901234",
    lines: [{ lineId: f.lines.sweater, quantity: 2 }],
    daysAgo: 2,
  });
  expect(await orderStatus(f.orderId)).toBe("paid");

  await page.goto(orderPage(f));
  const parcels = page.getByRole("region", { name: "Delvis sendt" });
  await expect(parcels).toBeVisible();
  await expect(parcels.getByRole("heading", { level: 3, name: /^Pakke 1 · Sendt / })).toBeVisible();
  await expect(parcels).toContainText("Posten 70712345678901234");
  await expect(parcels.getByRole("link", { name: /Spor pakken/ })).toHaveAttribute("href", "https://sporing.posten.no/sporing/70712345678901234");
  await expect(parcels.getByRole("list", { name: "Pakke 1: Innhold" })).toHaveText("2 × Ullgenser");
  // Still to come: the sweater left and both mugs.
  const toCome = parcels.locator("[data-still-to-come]");
  await expect(toCome.getByRole("heading", { name: "Kommer senere" })).toBeVisible();
  await expect(toCome).toContainText("1 × Ullgenser");
  await expect(toCome).toContainText("2 × Krus");
  await expect(parcels).toContainText("Angrefristen på 14 dager regnes fra den dagen du mottar den siste pakken.");

  // The second parcel takes the rest: the order is sent, and both parcels are listed with their own lines.
  await sendParcel(f, { carrier: "PostNord", tracking: "00370712345", lines: [{ lineId: f.lines.sweater, quantity: 1 }, { lineId: f.lines.mug, quantity: 2 }], daysAgo: 1 });
  expect(await orderStatus(f.orderId)).toBe("fulfilled");
  await page.goto(orderPage(f));
  const sent = page.getByRole("region", { name: "Sendt" });
  await expect(sent).toBeVisible();
  await expect(sent.locator("[data-parcel]")).toHaveCount(2);
  await expect(sent.getByRole("list", { name: "Pakke 1: Innhold" })).toHaveText("2 × Ullgenser");
  await expect(sent.getByRole("list", { name: "Pakke 2: Innhold" })).toContainText("1 × Ullgenser");
  await expect(sent.getByRole("list", { name: "Pakke 2: Innhold" })).toContainText("2 × Krus");
  await expect(sent).toContainText("PostNord 00370712345");
  await expect(sent.locator("[data-still-to-come]")).toHaveCount(0);
  // A parcel without a tracking address is not linked.
  await expect(sent.getByRole("link")).toHaveCount(1);
});

test("before the first parcel the order page shows no parcels", async ({ page }) => {
  const f = await paidGoodsOrder();
  await page.goto(orderPage(f));
  await expect(page.getByText(f.number, { exact: true }).first()).toBeVisible();
  await expect(page.locator("[data-order-shipments]")).toHaveCount(0);
});

test("the parcels are said in the shop's language", async ({ page }) => {
  const f = await paidGoodsOrder("SE");
  await sendParcel(f, { carrier: "PostNord", tracking: "00370999", lines: [{ lineId: f.lines.mug, quantity: 1 }], daysAgo: 1 });
  await page.goto(orderPage(f, "se"));
  const parcels = page.getByRole("region", { name: "Delvis skickad" });
  await expect(parcels).toBeVisible();
  await expect(parcels.getByRole("heading", { level: 3, name: /^Paket 1 · Skickat / })).toBeVisible();
  await expect(parcels.getByRole("heading", { name: "Kommer senare" })).toBeVisible();
  await expect(parcels).toContainText("1 × Krus");
  await expect(parcels).toContainText("3 × Ullgenser");
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme });

    test("an order page with parcels has no serious or critical accessibility violation", async ({ page }) => {
      const f = await paidGoodsOrder();
      await sendParcel(f, { carrier: "Posten", tracking: "70799", url: "https://sporing.posten.no/sporing/70799", lines: [{ lineId: f.lines.sweater, quantity: 1 }], daysAgo: 1 });
      await page.goto(orderPage(f));
      await expect(page.locator("[data-order-shipments]")).toBeVisible();
      expect(describeFindings(await violationsOn(page))).toEqual([]);
    });
  });
}
