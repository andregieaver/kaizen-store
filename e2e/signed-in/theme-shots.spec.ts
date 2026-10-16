import { expect, test } from "@playwright/test";

import { LAUNCH_THEMES } from "../../src/lib/launch-themes";
import { testDb } from "../db";
import { ADMIN } from "./accounts";

/**
 * A theme's photographs on its page in the platform's admin (`docs/theme-showcase-phase-2.md` step 1), as its platform admin sees them:
 * the pictures made at a computer's width with their version, the phone's that could not be made with the reason, and *Try again*, after
 * which it waits for the job again. The job itself is held by theme-shots.int.test.ts and e2e/theme-shots.spec.ts.
 */

test.use({ storageState: ADMIN.state });

let presetId = "";

test.beforeAll(async ({ baseURL }) => {
  const sql = testDb();
  try {
    const snapshot = LAUNCH_THEMES[0].snapshot;
    const [theme] = await sql`
      insert into commerce.design_presets (title, summary, snapshot, published, published_at)
      values ('E2E Pictured', 'Photographed.', ${sql.json(snapshot as never)}, true, now()) returning id`;
    presetId = String(theme.id);
    await sql`insert into commerce.design_preset_versions (preset_id, number, snapshot) values (${presetId}, 1, ${sql.json(snapshot as never)})`;
    const [standard] = await sql`select id from commerce.stores where is_template limit 1`;
    const file = (name: string, width: number, height: number) => ({
      path: `platform/theme-shots/${presetId}/u/${name}`,
      url: `${baseURL}/demo/themes/calm-v2.webp`,
      width,
      height,
      bytes: 1000,
    });
    const pictures = { card: file("computer-card.webp", 800, 600), screen: file("computer-screen.webp", 1440, 900) };
    await sql`
      insert into commerce.theme_shots (preset_id, version, showcase_store_id, kind, status, pictures, finished_at)
      values (${presetId}, 1, ${String(standard.id)}, 'computer', 'done', ${sql.json(pictures)}, now())`;
    await sql`
      insert into commerce.theme_shots (preset_id, version, showcase_store_id, kind, status, tries, problem)
      values (${presetId}, 1, ${String(standard.id)}, 'phone', 'failed', 3, 'The preview answered 500.')`;
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = testDb();
  try {
    await sql`update commerce.design_presets set published = false where id = ${presetId}`;
  } finally {
    await sql.end();
  }
});

test("a theme's page shows its photographs, says why one could not be made, and tries it again", async ({ page }) => {
  await page.goto(`/admin/platform/design-profiles/${presetId}`);
  const pictures = page.getByRole("region", { name: "Pictures" });
  await expect(pictures).toBeVisible();
  await expect(pictures.getByRole("img", { name: "E2E Pictured on a computer" })).toBeVisible();
  await expect(pictures.getByText("Made", { exact: true })).toBeVisible();
  await expect(pictures.getByText("Could not be made", { exact: true })).toBeVisible();
  await expect(pictures.getByText("The preview answered 500.")).toBeVisible();
  await pictures.getByRole("button", { name: "Try again" }).click();
  // Nothing is left to try again: the phone's picture waits for the job, and the button has gone.
  await expect(pictures.getByText("Waiting to be made", { exact: true })).toBeVisible();
  await expect(pictures.getByRole("button", { name: "Try again" })).toHaveCount(0);
  const sql = testDb();
  try {
    const [row] = await sql`select status, tries from commerce.theme_shots where preset_id = ${presetId} and kind = 'phone'`;
    expect(row).toMatchObject({ status: "waiting", tries: 0 });
  } finally {
    await sql.end();
  }
});
