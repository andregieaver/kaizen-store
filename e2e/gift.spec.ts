import { expect, test, type Page } from "@playwright/test";

import { testDb, testStore } from "./db";

/**
 * The gift box on the cart (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.1 and 6.4 G1): a store switches gift messages on, a shopper ticks the box, writes To, From and a
 * message of at most 300 characters and six lines, and the cart keeps it. The box says in the shopper's language how much is left, blocks the 301st character, refuses a seventh
 * line with a sentence (never cuts), keeps what was typed over a reload, clears it when unticked and sets no cookie and no storage of its own. Placing the order (the copy to the order,
 * the order page, the packing slip, the confirmation) needs Stripe and is held by the integration tests.
 */

/** A new store with the template's demo catalogue and gift messages switched on or off. */
async function giftStore(on: boolean): Promise<{ slug: string; id: string }> {
  // Sweden is a country of the store (D178: Several countries on), for the box in Swedish.
  const store = await testStore(on ? "gift" : "nogift", ["countries"]);
  const sql = testDb();
  try {
    await sql`
      insert into commerce.order_settings (store_id, gift_messages) values (${store.id}, ${on})
      on conflict (store_id) do update set gift_messages = ${on}`;
  } finally {
    await sql.end();
  }
  return store;
}

async function cartGift(storeId: string): Promise<{ is_gift: boolean; gift_to: string | null; gift_from: string | null; gift_message: string | null } | undefined> {
  const sql = testDb();
  try {
    const [row] = await sql`
      select is_gift, gift_to, gift_from, gift_message from commerce.carts where store_id = ${storeId} order by created_at desc limit 1`;
    return row as never;
  } finally {
    await sql.end();
  }
}

async function addNotebook(page: Page, slug: string, market: string, button: string, link: RegExp) {
  await page.goto(`/s/${slug}/${market}/p/demo-notatbok`);
  await page.getByRole("button", { name: button, disabled: false }).first().click();
  await expect(page.getByRole("link", { name: link })).toBeVisible();
  await page.goto(`/s/${slug}/${market}/cart`);
}

/** Waits for the server action the box sends when a field is left or the tick changes (a POST to the cart's own address). */
const saved = (page: Page, slug: string, market: string) =>
  page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/s/${slug}/${market}/cart`);

test("the box is a tick; ticking shows To, From and a message with a counter, which keep what was typed over a reload and clear when unticked", async ({ page, context }) => {
  const store = await giftStore(true);
  await addNotebook(page, store.slug, "no", "Legg i handlekurven", /Handlekurv \(1\)/);

  const tick = page.getByRole("checkbox", { name: "Dette er en gave" });
  await expect(tick).toBeVisible();
  await expect(tick).not.toBeChecked();
  await expect(page.getByLabel("Melding", { exact: true })).toHaveCount(0);

  // Nothing is stored in the browser by the box: the cookies and the storage are what they were.
  const cookiesBefore = (await context.cookies()).map((cookie) => cookie.name).sort();
  const storageBefore = await page.evaluate(() => [Object.keys(localStorage).sort(), Object.keys(sessionStorage).sort()]);

  const ticked = saved(page, store.slug, "no");
  await tick.check();
  await ticked;
  const to = page.getByLabel("Til", { exact: true });
  const from = page.getByLabel("Fra", { exact: true });
  const message = page.getByLabel("Melding", { exact: true });
  await expect(message).toBeVisible();
  await expect(page.locator("[data-gift-counter]")).toHaveText("300 tegn igjen");
  // What is done with the words is said where they are written.
  await expect(page.getByText("Meldingen skrives ut på pakkseddelen til bestillingen. Butikken sender den ikke til mottakeren.")).toBeVisible();

  // Six lines are the most: a seventh is refused with a sentence, never cut, and nothing is saved for it.
  await message.fill("a\nb\nc\nd\ne\nf\ng");
  await message.blur();
  await expect(page.getByRole("alert").filter({ hasText: "Meldingen kan ha høyst 6 linjer." })).toBeVisible();
  expect((await cartGift(store.id))?.gift_message ?? null).toBeNull();

  // A message that fits is kept when the field is left.
  await to.fill("Kari");
  await from.fill("Ola");
  await message.fill("Gratulerer med dagen!");
  await expect(page.locator("[data-gift-counter]")).toHaveText("279 tegn igjen");
  const kept = saved(page, store.slug, "no");
  await message.blur();
  await kept;
  await expect(page.getByRole("alert").filter({ hasText: "høyst 6 linjer" })).toHaveCount(0);
  await expect.poll(async () => (await cartGift(store.id))?.gift_message).toBe("Gratulerer med dagen!");
  expect(await cartGift(store.id)).toMatchObject({ is_gift: true, gift_to: "Kari", gift_from: "Ola" });

  // Reloaded, the cart holds it and the box shows it.
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Dette er en gave" })).toBeChecked();
  await expect(page.getByLabel("Til", { exact: true })).toHaveValue("Kari");
  await expect(page.getByLabel("Fra", { exact: true })).toHaveValue("Ola");
  await expect(page.getByLabel("Melding", { exact: true })).toHaveValue("Gratulerer med dagen!");

  // No cookie and no storage item came of it.
  expect((await context.cookies()).map((cookie) => cookie.name).sort()).toEqual(cookiesBefore);
  expect(await page.evaluate(() => [Object.keys(localStorage).sort(), Object.keys(sessionStorage).sort()])).toEqual(storageBefore);

  // Unticked, the three fields go with it, in the box and on the cart.
  const cleared = saved(page, store.slug, "no");
  await page.getByRole("checkbox", { name: "Dette er en gave" }).uncheck();
  await cleared;
  await expect(page.getByLabel("Melding", { exact: true })).toHaveCount(0);
  await expect.poll(async () => (await cartGift(store.id))?.is_gift).toBe(false);
  expect(await cartGift(store.id)).toMatchObject({ gift_to: null, gift_from: null, gift_message: null });
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Dette er en gave" })).not.toBeChecked();
});

test("the message field takes 300 characters and blocks the 301st, and the counter says none are left", async ({ page }) => {
  const store = await giftStore(true);
  await addNotebook(page, store.slug, "no", "Legg i handlekurven", /Handlekurv \(1\)/);
  await page.getByRole("checkbox", { name: "Dette er en gave" }).check();
  const message = page.getByLabel("Melding", { exact: true });
  await message.click();
  await message.pressSequentially("x".repeat(305));
  await expect(message).toHaveValue("x".repeat(300));
  await expect(page.locator("[data-gift-counter]")).toHaveText("0 tegn igjen");
  // A name is 60 characters at most.
  const to = page.getByLabel("Til", { exact: true });
  await to.click();
  await to.pressSequentially("n".repeat(65));
  await expect(to).toHaveValue("n".repeat(60));
});

test("the box is drawn in the shopper's language", async ({ page }) => {
  const store = await giftStore(true);
  await addNotebook(page, store.slug, "se", "Lägg i varukorgen", /Varukorg \(1\)/);
  const tick = page.getByRole("checkbox", { name: "Det här är en present" });
  await expect(tick).toBeVisible();
  await tick.check();
  await expect(page.getByLabel("Till", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Från", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Meddelande", { exact: true })).toBeVisible();
  await expect(page.locator("[data-gift-counter]")).toHaveText("300 tecken kvar");
});

test("a store with gift messages switched off shows no box and keeps no gift, whatever a cart is sent", async ({ page }) => {
  const store = await giftStore(false);
  await addNotebook(page, store.slug, "no", "Legg i handlekurven", /Handlekurv \(1\)/);
  await expect(page.getByRole("heading", { level: 1, name: "Handlekurv" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Dette er en gave" })).toHaveCount(0);
  await expect(page.locator("[data-gift-box]")).toHaveCount(0);
  expect((await cartGift(store.id))?.is_gift ?? false).toBe(false);
});
