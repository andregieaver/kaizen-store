import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PORT ?? 3000);
// The VIES stand-in's port (e2e/fixtures/vies-stub.mjs).
const viesPort = Number(process.env.VIES_STUB_PORT ?? 3911);
// The signed-in admin tests (e2e/signed-in/): only with E2E_SIGNED_IN, in a build whose NEXT_PUBLIC_SUPABASE_URL is the Auth
// stand-in (e2e/fixtures/auth-stub.mjs, CI's `signed-in` job). Without it they are not projects at all, so a plain run never
// tries to sign in.
const signedIn = Boolean(process.env.E2E_SIGNED_IN);
const authPort = Number(process.env.AUTH_STUB_PORT ?? 3912);
const chromium = {
  ...devices["Desktop Chrome"],
  // Lets sandboxes with a preinstalled Chromium skip the download.
  launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
};
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
    { name: "chromium", testIgnore: "signed-in/**", use: chromium },
    ...(signedIn
      ? [
          // Signs the test people in through the real form and keeps their browser states (e2e/signed-in/auth.setup.ts).
          { name: "signed-in-setup", testMatch: "signed-in/auth.setup.ts", use: chromium },
          { name: "signed-in", testMatch: "signed-in/**/*.spec.ts", dependencies: ["signed-in-setup"], use: chromium },
        ]
      : []),
  ],
  webServer: [
    ...(signedIn
      ? [
          {
            command: "node e2e/fixtures/auth-stub.mjs",
            url: `http://127.0.0.1:${authPort}/__health`,
            reuseExistingServer: !process.env.CI,
            env: { AUTH_STUB_PORT: String(authPort) },
          },
        ]
      : []),
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
