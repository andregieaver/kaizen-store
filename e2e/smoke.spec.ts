import { expect, test } from "@playwright/test";

test("home page renders the store name", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Kaizen Store");
  await expect(
    page.getByRole("heading", { level: 1, name: "Kaizen Store" }),
  ).toBeVisible();
});

test("health endpoint answers without caching", async ({ request }) => {
  const response = await request.get("/api/health");
  // 503 is expected when Supabase is not configured for the run.
  expect([200, 503]).toContain(response.status());
  expect(response.headers()["cache-control"]).toContain("no-store");
  const body = await response.json();
  expect(body).toHaveProperty("supabase");
  expect(body).toHaveProperty("database");
});
