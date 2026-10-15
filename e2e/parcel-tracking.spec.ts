import { expect, test } from "@playwright/test";

import { describeFindings, violationsOn } from "./a11y";
import { testDb } from "./db";
import { paidGoodsOrder, sendParcel, type ParcelFixture } from "./fulfilment-fixtures";

/**
 * Where a parcel is, as the shopper sees it on the order page (wave 3, D238, `docs/wave-3-notifications.md` 2.7 and 6.2): the phase and the carrier's events
 * the five-minute poll stored, *no news yet* for a followed parcel with none, and only the link for a parcel Kaizen does not follow. The events are written
 * with SQL the way `pollTracking()` stores them (the poll itself, with a faked carrier, is held by `shipment-tracking.int.test.ts`); the page never asks a
 * carrier while it renders, so nothing here reaches one. The order page is a pay route (D158): the piece is plain server-rendered text.
 */

const orderPage = (f: { slug: string; orderId: string; key: string }, market = "no") => `/s/${f.slug}/${market}/order/${f.orderId}?session_id=${f.key}`;

type Event = { at: string; code: string; phase: string; verified: boolean; description: string; location: string | null };

async function storeTracking(f: ParcelFixture, shipmentId: string, carrier: string, events: Event[], over: { failures?: number } = {}) {
  const db = testDb();
  try {
    const newest = events[0];
    await db`
      insert into commerce.shipment_tracking (store_id, shipment_id, order_id, carrier, phase, phase_verified, events, checked_at, failures)
      values (${f.storeId}, ${shipmentId}, ${f.orderId}, ${carrier}, ${newest?.phase ?? "unknown"}, ${newest?.verified ?? false},
        ${db.json(events as never)}, now(), ${over.failures ?? 0})`;
  } finally {
    await db.end();
  }
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

test("a followed parcel shows its phase and the carrier's events, newest first, under the parcel", async ({ page }) => {
  const f = await paidGoodsOrder();
  const shipment = await sendParcel(f, {
    carrier: "Posten / Bring",
    tracking: "70712345678901234",
    url: "https://sporing.posten.no/sporing/70712345678901234",
    lines: [{ lineId: f.lines.sweater, quantity: 2 }],
    daysAgo: 1,
  });
  await storeTracking(f, shipment, "bring", [
    { at: hoursAgo(1), code: "TRANSPORT_TO_RECIPIENT", phase: "out_for_delivery", verified: true, description: "Sendingen er på vei til mottaker", location: "Oslo" },
    { at: hoursAgo(20), code: "HANDED_IN", phase: "in_transit", verified: true, description: "Sendingen er levert inn", location: "Bergen" },
  ]);

  await page.goto(orderPage(f));
  const parcel = page.locator("[data-parcel]").first();
  const tracking = parcel.locator("[data-parcel-tracking]");
  await expect(tracking).toHaveAttribute("data-parcel-tracking", "out_for_delivery");
  await expect(tracking).toContainText("Ute for levering");
  const events = tracking.getByRole("list", { name: "Nytt fra transportøren" }).getByRole("listitem");
  await expect(events).toHaveCount(2);
  await expect(events.first()).toContainText("Sendingen er på vei til mottaker");
  await expect(events.first()).toContainText("Oslo");
  await expect(events.nth(1)).toContainText("Sendingen er levert inn");
  // The carrier's link stays.
  await expect(parcel.getByRole("link", { name: /Spor pakken/ })).toHaveAttribute("href", "https://sporing.posten.no/sporing/70712345678901234");
});

test("a followed parcel with no events yet says so plainly; a parcel Kaizen does not follow keeps only its link", async ({ page }) => {
  const f = await paidGoodsOrder();
  const followed = await sendParcel(f, { carrier: "Posten / Bring", tracking: "70799", url: "https://sporing.posten.no/sporing/70799", lines: [{ lineId: f.lines.sweater, quantity: 1 }], daysAgo: 2 });
  await storeTracking(f, followed, "bring", []);
  await sendParcel(f, { carrier: "DHL", tracking: "JD0001", url: "https://www.dhl.com/track?id=JD0001", lines: [{ lineId: f.lines.mug, quantity: 1 }], daysAgo: 1 });

  await page.goto(orderPage(f));
  const parcels = page.locator("[data-parcel]");
  await expect(parcels).toHaveCount(2);
  await expect(parcels.nth(0).locator('[data-parcel-tracking="no-news"]')).toBeVisible();
  await expect(parcels.nth(0).locator("[data-parcel-tracking]")).not.toContainText(/feil|error/i);
  await expect(parcels.nth(1).locator("[data-parcel-tracking]")).toHaveCount(0);
  await expect(parcels.nth(1).getByRole("link", { name: /Spor pakken/ })).toHaveAttribute("href", "https://www.dhl.com/track?id=JD0001");
});

test("after a check that failed the page shows what was last stored and no error, and an unverified carrier's code is never told as a phase", async ({ page }) => {
  const f = await paidGoodsOrder("SE");
  const shipment = await sendParcel(f, { carrier: "PostNord", tracking: "00370999", url: "https://tracking.postnord.com/se/?id=00370999", lines: [{ lineId: f.lines.mug, quantity: 1 }], daysAgo: 1 });
  await storeTracking(f, shipment, "postnord", [{ at: hoursAgo(3), code: "DELIVERED", phase: "delivered", verified: false, description: "Försändelsen har levererats", location: "Malmö" }], { failures: 4 });

  await page.goto(orderPage(f, "se"));
  const tracking = page.locator("[data-parcel] [data-parcel-tracking]");
  await expect(tracking).toHaveAttribute("data-parcel-tracking", "events");
  await expect(tracking).toContainText("Försändelsen har levererats");
  await expect(tracking.locator("p")).toHaveCount(0);
  await expect(tracking).not.toContainText(/fel|error/i);
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme });

    test("an order page with a parcel's tracking has no serious or critical accessibility violation", async ({ page }) => {
      const f = await paidGoodsOrder();
      const shipment = await sendParcel(f, { carrier: "Posten / Bring", tracking: "70711", url: "https://sporing.posten.no/sporing/70711", lines: [{ lineId: f.lines.sweater, quantity: 1 }], daysAgo: 1 });
      await storeTracking(f, shipment, "bring", [{ at: hoursAgo(2), code: "IN_TRANSIT", phase: "in_transit", verified: true, description: "Sendingen er på vei", location: "Oslo" }]);
      await page.goto(orderPage(f));
      await expect(page.locator("[data-parcel-tracking]")).toBeVisible();
      expect(describeFindings(await violationsOn(page))).toEqual([]);
    });
  });
}
