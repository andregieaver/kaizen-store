import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PORT ?? 3000);
// The VIES stand-in's port (e2e/fixtures/vies-stub.mjs).
const viesPort = Number(process.env.VIES_STUB_PORT ?? 3911);
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
  webServer: [
    {
      // A stand-in for VIES (e2e/vat-reverse-charge.spec.ts); the app below is pointed at it.
      command: `node e2e/fixtures/vies-stub.mjs`,
      url: `http://127.0.0.1:${viesPort}/__health`,
      reuseExistingServer: !process.env.CI,
      env: { VIES_STUB_PORT: String(viesPort) },
    },
    {
      command: `pnpm start --port ${port}`,
      url: `http://localhost:${port}`,
      reuseExistingServer: !process.env.CI,
      // The scheduler's routes answer to this in tests (e2e/cookie-scan.spec.ts); VIES is the stub (never honoured on Vercel).
      env: {
        CRON_SECRET: process.env.CRON_SECRET ?? "e2e-cron-secret",
        SETTINGS_ENCRYPTION_KEY: process.env.SETTINGS_ENCRYPTION_KEY,
        VIES_TEST_URL: `http://127.0.0.1:${viesPort}/check-vat-number`,
        VIES_ALLOW_TEST_URL: "1",
      },
    },
  ],
});
