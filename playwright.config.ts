import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PORT ?? 3000);
// The key the server decrypts AI keys with; the chat test (e2e/chat.spec.ts) encrypts its store's with it.
process.env.SETTINGS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Lets sandboxes with a preinstalled Chromium skip the download.
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
          : {},
      },
    },
  ],
  webServer: {
    command: `pnpm start --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    // The scheduler's routes answer to this in tests (e2e/cookie-scan.spec.ts).
    env: { CRON_SECRET: process.env.CRON_SECRET ?? "e2e-cron-secret", SETTINGS_ENCRYPTION_KEY: process.env.SETTINGS_ENCRYPTION_KEY },
  },
});
