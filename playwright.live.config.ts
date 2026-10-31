import { defineConfig, devices } from "@playwright/test";

/**
 * The scan of the live site (PSI 2026-10-30 ACC-01, ACC-09): `e2e-live/` against production, run each day by
 * `.github/workflows/live-a11y.yml` and by hand with `pnpm exec playwright test -c playwright.live.config.ts`. No server is started and no
 * database is touched: it only reads public pages. `LIVE_URL` points it elsewhere.
 */
export default defineConfig({
  testDir: "./e2e-live",
  retries: 1,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL: process.env.LIVE_URL ?? "https://kaizenaflow.com", trace: "retain-on-failure" },
  projects: [
    { name: "light", use: { ...devices["Desktop Chrome"], colorScheme: "light" } },
    { name: "dark", use: { ...devices["Desktop Chrome"], colorScheme: "dark" } },
  ],
});
