import { expect, test } from "@playwright/test";

import { testDb } from "./db";

test("a store's footer leads to Kaizena Flow's form for illegal content, which takes a notice and says what happens next (DSA, D411)", async ({ page }) => {
  await page.goto("/s/demo/no");
  const link = page.getByRole("contentinfo").getByRole("link", { name: "Meld fra om ulovlig innhold" });
  await expect(link).toHaveAttribute("href", /\/no\/report$/);

  const email = `notice-${Date.now()}@example.com`;
  await page.goto(`/report?url=${encodeURIComponent("http://localhost:3000/s/demo/no/p/demo-handlenett")}`);
  await expect(page.getByRole("heading", { level: 1, name: "Report illegal content" })).toBeVisible();
  await expect(page.getByLabel("Address of the content")).toHaveValue("http://localhost:3000/s/demo/no/p/demo-handlenett");
  await page.getByLabel("What kind of problem is it?").selectOption("counterfeit_ip");
  await page.getByLabel("Why is it illegal?").fill("The bag copies a registered design.");
  await page.getByLabel("Your name").fill("Kari Nordmann");
  await page.getByLabel("Your email").fill(email);
  await page.getByLabel(/I believe in good faith/).check();
  await page.getByRole("button", { name: "Send the notice" }).click();
  await expect(page.getByRole("status")).toContainText("We have your notice");

  const sql = testDb();
  try {
    const rows = await sql`
      select r.category, r.status, s.slug from commerce.content_reports r left join commerce.stores s on s.id = r.store_id
      where r.reporter_email = ${email}`;
    expect(rows).toEqual([{ category: "counterfeit_ip", status: "received", slug: "demo" }]);
  } finally {
    await sql.end();
  }
});

test("a notice without a sender is refused at the fields that need one, unless it is about children", async ({ page }) => {
  await page.goto("/report");
  await page.getByLabel("Address of the content").fill("https://example.com/p/x");
  await page.getByLabel("What kind of problem is it?").selectOption("other");
  await page.getByLabel("Why is it illegal?").fill("It is illegal.");
  await page.getByLabel(/I believe in good faith/).check();
  await page.getByRole("button", { name: "Send the notice" }).click();
  await expect(page.getByLabel("Your name")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Your name")).toBeFocused();
  await expect(page.getByLabel("Your email")).toHaveAttribute("aria-invalid", "true");

  await page.getByLabel("What kind of problem is it?").selectOption("minors");
  await page.getByRole("button", { name: "Send the notice" }).click();
  await expect(page.getByRole("status")).toContainText("We have your notice");
});
