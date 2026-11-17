import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { E2E_STORE, OWNER } from "./accounts";

/**
 * The sending guard (D730, step M1.6 of the email plan) as the owner meets it: the paused notice on Marketing with what was counted, and
 * one press to resume. The pause is written as the guard leaves it; the guard's own counting is held by `sending-guard.int.test.ts`.
 */

test.use({ storageState: OWNER.state });

async function setPause(on: boolean) {
  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${E2E_STORE}`;
    await sql`delete from commerce.sending_pauses where store_id = ${store.id}`;
    if (on) await sql`insert into commerce.sending_pauses (store_id, reason, counts) values (${store.id}, 'bounces', ${sql.json({ sent: 1240, bounced: 81, complained: 1 })})`;
  } finally {
    await sql.end();
  }
}

test.afterAll(async () => {
  await setPause(false);
});

test("an owner sees why marketing email is paused and resumes it with one press", async ({ page }) => {
  await setPause(true);
  await page.goto(`/admin/${E2E_STORE}/marketing`);
  const notice = page.getByRole("region", { name: "Your marketing email is paused" });
  await expect(notice).toContainText("81 of 1,240 recent marketing emails bounced back (6.5 %)");
  await notice.getByRole("button", { name: "Resume sending" }).click();
  // The page draws again without the pause, so the notice itself goes: that is the answer.
  await expect(page.getByRole("region", { name: "Your marketing email is paused" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("region", { name: "Your marketing email is paused" })).toHaveCount(0);
});
