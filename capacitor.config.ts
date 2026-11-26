import { writeFileSync } from "node:fs";
import { join } from "node:path";

import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize } from "@capacitor/keyboard";

/**
 * The phone app (D908, `docs/mobile-app.md`): a Capacitor shell around the admin at Kaizena Flow's own site, for iPhone and Android.
 * Everything a person sees is the deployed admin; the shell adds the app's icon, its own link scheme, the email links that open it, and
 * an offline page. A change here reaches people only with a new build (`pnpm cap:sync`, then Xcode or Gradle).
 *
 * `server.url` is the site's origin, never `/admin`: on iPhone, Capacitor sends any address that does not start with it to Safari, so a
 * path there would push `/auth/confirm` and `/auth/callback` out of the app. The admin is the start page instead (`appStartPath`).
 */
const site = (process.env.CAPACITOR_SERVER_URL ?? "https://kaizenaflow.com").trim().replace(/\/+$/, "");

// The offline page (capacitor-www/offline.html) is a file inside the app and cannot know where the site lives, so the address is written
// beside it each time this config is read, which `cap sync` and `cap copy` do before they copy the folder.
try {
  writeFileSync(join(__dirname, "capacitor-www", "site-url.js"), `window.__SITE_URL__ = ${JSON.stringify(site)};\n`);
} catch {
  // Read where the folder cannot be written: the page then tries Kaizena Flow's own site.
}

const config: CapacitorConfig = {
  // The store identity on both stores. It can never change once the app is published.
  appId: "com.humanweb.kaizenaflow",
  appName: "Kaizena Flow",
  webDir: "capacitor-www",
  // How the server knows a request comes from the app (`NATIVE_APP_MARK`, `src/lib/native-app.ts`, a test holds the two together).
  appendUserAgent: "KaizenaFlowApp",
  server: {
    url: site,
    appStartPath: "/admin",
    cleartext: false,
    androidScheme: "https",
    // Shown when the site cannot be reached (no connection at launch), instead of the system's error page with no way back in.
    errorPath: "offline.html",
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: "#ffffff",
      showSpinner: false,
    },
    Keyboard: {
      // The web view shrinks while the keyboard shows, so a focused field stays in sight.
      resize: KeyboardResize.Native,
      resizeOnFullScreen: true,
    },
  },
  ios: {
    contentInset: "automatic",
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
  },
};

export default config;
