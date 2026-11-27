---
paths:
 - "e2e/**"
 - "playwright*.config.ts"
---

# Browser tests: how-to

The admin as signed-in people see it is tested in `e2e/signed-in/` (D234): only with `E2E_SIGNED_IN=1`, in a build whose
`NEXT_PUBLIC_SUPABASE_URL` is the Auth stand-in `e2e/fixtures/auth-stub.mjs` (`http://127.0.0.1:3912`, any publishable key), as
CI's `signed-in` job does; `auth.setup.ts` signs an owner and a Read-only member in through the real form and keeps their browser
states (`test.use({ storageState: OWNER.state })`); a platform admin (`ADMIN`, D254) signs in through the real two-step page, the
stand-in checking a code from `e2e/fixtures/totp.mjs`.

Never add a bypass to the app's sign-in for a test: the stand-in is the only fake, and only it is told it is one.

The specs that switch the one test store's Deals and Projects on and off (`contracts`, `deals`, `projects`) run one at a time in the project
`signed-in-switches` beside the rest (`playwright.config.ts`); run them with `--project=signed-in-switches`, and add a spec
there when it switches a store feature another spec relies on.
