import { expect, test, type Page } from "@playwright/test";

import { testDb } from "../db";
import { E2E_STORE, OWNER } from "./accounts";

/**
 * Questions at checkout in their order (D357, docs/checkout-fields-tasks.md task 1): in Settings → Checkout rules the owner moves a question
 * with its up button and drags another with the keyboard on its handle; each lands in its new place at once and is still there after a
 * reload, as the cart reads them in that order (`moveCheckoutField()`, held by checkout-rules.int.test.ts).
 */

test.use({ storageState: OWNER.state });
test.describe.configure({ mode: "serial" });

const page = `/admin/${E2E_STORE}/settings/checkout`;
const LABELS = ["E2E door code", "E2E leave at the door", "E2E gift note"];

let storeId = "";

test.beforeAll(async () => {
  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${E2E_STORE}`;
    storeId = String(store.id);
    await sql`delete from commerce.checkout_fields where store_id = ${storeId} and label->>'text' like 'E2E %'`;
    for (const [i, text] of LABELS.entries()) {
      await sql`
        insert into commerce.checkout_fields (store_id, kind, required, label, position)
        values (${storeId}, ${i === 1 ? "checkbox" : "text"}, ${i === 0}, ${sql.json({ text, byLocale: {} })}, ${100 + i})`;
    }
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = testDb();
  try {
    await sql`delete from commerce.checkout_fields where store_id = ${storeId} and label->>'text' like 'E2E %'`;
  } finally {
    await sql.end();
  }
});

/** Waits until the list has saved what was moved: it is busy while a move is on its way. */
const saved = (p: Page) => expect(p.getByRole("list", { name: "Questions at checkout" })).toHaveAttribute("aria-busy", "false");

/** The test's questions as the list shows them, top to bottom. */
const order = async (p: Page) =>
  (await p.locator("[data-checkout-field]").allInnerTexts()).map((t) => LABELS.find((l) => t.includes(l))).filter((l) => l !== undefined);

test("moves a question up with its button, and the order is kept", async ({ page: p }) => {
  await p.goto(page);
  await expect.poll(() => order(p)).toEqual(LABELS);
  await p.getByRole("button", { name: `Move ${LABELS[2]} up` }).click();
  await expect.poll(() => order(p)).toEqual([LABELS[0], LABELS[2], LABELS[1]]);
  await saved(p);
  await p.reload();
  await expect.poll(() => order(p)).toEqual([LABELS[0], LABELS[2], LABELS[1]]);
});

test("drags a question by its handle with the keyboard, and the order is kept", async ({ page: p }) => {
  await p.goto(page);
  await expect.poll(() => order(p)).toEqual([LABELS[0], LABELS[2], LABELS[1]]);
  const handle = p.getByRole("button", { name: `Drag ${LABELS[0]} to its place` });
  await handle.focus();
  await p.keyboard.press("Space");
  // Picked up once dnd-kit says so in words (it measures the list after the lift, and an arrow pressed before that moves nothing, so the arrow
  // is pressed until it says the question is over the last place, as collections.spec.ts does), then dropped: its words and place, never its id.
  const said = p.locator("[id^=DndLiveRegion]");
  await expect(said).toHaveText(new RegExp(`^(Picked up ${LABELS[0]}, in place 1 of 3|${LABELS[0]} is over place 1 of 3)\\.$`));
  await expect(async () => {
    await p.keyboard.press("ArrowDown");
    await expect(said).toHaveText(/ is over place 3 of 3\.$/, { timeout: 500 });
  }).toPass({ timeout: 5000 });
  await p.keyboard.press("Space");
  await expect(said).toHaveText(new RegExp(`^${LABELS[0]} dropped in place 3 of 3\\.$`));
  await expect.poll(() => order(p)).toEqual([LABELS[2], LABELS[1], LABELS[0]]);
  await saved(p);
  await p.reload();
  await expect.poll(() => order(p)).toEqual([LABELS[2], LABELS[1], LABELS[0]]);
});
