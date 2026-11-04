import { expect, test } from "@playwright/test";

import { describeFindings, violationsOn } from "../a11y";
import { testDb } from "../db";
import { ADMIN } from "./accounts";

/**
 * The docs guide's screen (wave 14 unit E5, D444) as Kaizena Flow's platform admin uses it: Homer switches it on with a name, a greeting and
 * a daily limit and saves; Lisa's occupation and guidance are one step away under Customise. The guide itself is tested in
 * src/server/docs-guide.int.test.ts and the docs' panel in e2e/docs.spec.ts.
 */
test.use({ storageState: ADMIN.state });
test.describe.configure({ mode: "serial" });

const clear = async () => {
  const sql = testDb();
  try {
    await sql`delete from commerce.docs_guide`;
  } finally {
    await sql.end();
  }
};

test.beforeAll(clear);
test.afterAll(clear);

test("a platform admin switches the docs guide on with its name, greeting and daily limit, and Customise holds the rest", async ({ page }) => {
  await page.goto("/admin/platform/docs/guide");
  await expect(page.getByRole("heading", { level: 1, name: "Docs guide" })).toBeVisible();
  await expect(page.getByText("The AI guide is off", { exact: false })).toBeVisible();
  await expect(page.getByText("Conversations are kept as the site chat's are", { exact: false })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Docs feedback" })).toHaveAttribute("href", "/admin/platform/docs/feedback");

  // Switched on without a name, it says what is missing.
  await page.getByLabel("Answer readers in the docs").check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Give the guide a name before switching it on.")).toBeVisible();

  await page.getByLabel("Name").fill("Ada");
  await page.getByLabel("English").fill("Hi, I'm Ada. Ask me anything about the docs.");
  await page.getByLabel("Messages a day").fill("250");
  // Lisa's settings wait under Customise.
  await expect(page.getByLabel("Guidance")).toBeHidden();
  await page.locator("[data-advanced] > summary").click();
  await page.getByLabel("Occupation").fill("Docs guide");
  await page.getByLabel("Guidance").fill("Keep answers short.");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  const sql = testDb();
  try {
    const [row] = await sql`select enabled, name, occupation, greeting, instructions, daily_limit from commerce.docs_guide where id = 1`;
    expect(row).toEqual({ enabled: true, name: "Ada", occupation: "Docs guide", greeting: { en: "Hi, I'm Ada. Ask me anything about the docs." }, instructions: "Keep answers short.", daily_limit: 250 });
    // The platform chat's own row is not the guide's.
    expect(await sql`select 1 from commerce.chat_agents where name = 'Ada'`).toHaveLength(0);
  } finally {
    await sql.end();
  }
  await page.reload();
  await expect(page.getByLabel("Name")).toHaveValue("Ada");
});

test("the docs guide's screen passes axe", async ({ page }) => {
  await page.goto("/admin/platform/docs/guide");
  await page.locator("[data-advanced] > summary").click();
  const findings = await violationsOn(page);
  expect(findings, describeFindings(findings).join("\n")).toEqual([]);
});
