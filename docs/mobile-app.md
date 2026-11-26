# The phone app (D908)

Kaizena Flow's app for iPhone and Android is a Capacitor shell that loads the admin from `https://kaizenaflow.com` and starts at
`/admin`. Everything a person sees is the deployed admin, so a web deploy reaches the app at once. A new build of the app is needed only
when the shell's own files change: `capacitor.config.ts`, `capacitor-www/`, `android/`, `ios/`, or a Capacitor package. On a computer the
admin is installed from the browser instead (D361's manifest and service worker), and nothing here is needed for that.

## Build it

```bash
pnpm install
pnpm cap:sync            # writes the config and plugins into android/ and ios/; CAPACITOR_SERVER_URL overrides the site
pnpm cap:open:android    # Android Studio, on any computer
pnpm cap:open:ios        # Xcode, on a Mac only
```

- **Android** is also built by GitHub Actions (`.github/workflows/mobile-build.yml`) on every push to `main` that touches the shell: a debug
  build to prove it compiles, or, once the signing secrets below are set, a signed bundle for Play, kept as the run's artifact. Its version
  code is the run number, so each upload is higher than the last.
- **iPhone** is built in Xcode on a Mac: choose the team under Signing & Capabilities, add the **Associated Domains** capability (the
  project already names `applinks:kaizenaflow.com` in `App.entitlements`), set the version, then Product → Archive. The Swift packages
  are resolved from `node_modules`, so run `pnpm install` and `pnpm cap:sync ios` first.
- **Icons and splash screens** are drawn from the platform's icon. The sources are in `resources/` (`icon-only.png`, the adaptive icon's
  two layers, `splash.png`, `splash-dark.png`). For sharper icons, put a 1024 px master there and run
  `npx @capacitor/assets generate --ios --android --assetPath resources`, then sync.

## Set up once

1. **Supabase Auth** (project `ybsozesfuxuitoacntfo`) → Authentication → URL configuration → Redirect URLs: add
   `kaizenaflow://auth/callback**`. Without it, Sign in with Kaizen Life started in the app ends in the phone's browser.
2. **The Android signing key.** Make one and keep it safe (losing it means a new app on Play):
   `keytool -genkeypair -v -keystore release.keystore -alias kaizenaflow -keyalg RSA -keysize 4096 -validity 10000`.
   GitHub → Settings → Secrets: `ANDROID_KEYSTORE_BASE64` (`base64 -w0 release.keystore`), `ANDROID_KEYSTORE_PASSWORD`,
   `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Variables, optional: `ANDROID_VERSION_NAME`, `CAPACITOR_SERVER_URL`.
3. **The link files** (Vercel, production): `APPLE_TEAM_ID` (Apple Developer → Membership) and `ANDROID_APP_SHA256`, the SHA-256
   fingerprints of the upload key and of Google Play's app signing key (Play Console → Test and release → App integrity),
   comma-separated. Then `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` answer, and an email's sign-in link
   opens the app. Until then those links open in the browser, as now.
4. **The store records.** App Store Connect and Play Console, under the same accounts as Kaizen Life: bundle id and package
   `com.humanweb.kaizenaflow`, the privacy answers (the admin's data: account, store and orders; nothing for tracking), screenshots, and
   for review a sign-in to a demo store (an owner without two steps), since only store owners are let in.

## Check on a phone before a release

- Sign in with a password, and with the two-step code; sign out and in again.
- Ask for a sign-in link: once the link files answer, tapping it in the mail app opens the app signed in.
- Sign in with Kaizen Life: the phone's browser opens, and the app comes back signed in.
- Download a report or an export (Work → Reports → CSV, an activity export): the share sheet offers to save or send the file.
- Voice in the AI manager asks for the microphone once; a product photo can be taken or chosen.
- Turn on flight mode and open the app: the offline page; turn it off: the admin comes back by itself.
- Android: Back goes back through the admin and leaves the app at its start. Both: the status bar is readable in light and dark.
- A link to another site (Stripe, a store's own domain) opens in the browser.

## Not yet

- **Push to the app.** Web Push (D361) never reaches a web view. The app needs Firebase Cloud Messaging (Android) and APNs (iPhone), a
  device table beside `push_subscriptions` written only by `src/server/push.ts`, and `sendOrderPush()` sending to both. Apple also
  reviews an app that is only a website against guideline 4.2; push is the native part that answers it.
- **No plan purchase in the app** before App Store review: Apple's guideline 3.1.1 wants a digital plan sold in the app through in-app
  purchase, so the app shows the plan and no price, purchase or checkout (as Kaizen Life does). `isNativeAppAgent()` tells the pages.
- **Downloads that are no `<a download>`** (the capacity CSV's button, the orders export page, a form that answers with a file) open in
  the web view instead of the share sheet.
- **Order links in emails** open the browser; adding `/admin/` to the app links (`APP_LINK_PATHS` and both native projects) opens them
  in the app.
