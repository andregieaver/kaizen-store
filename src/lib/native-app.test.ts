import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SHELL_WORDS } from "./admin-words/shell";
import { appLinksEnv } from "./env";
import {
  APP_LINK_PATHS,
  NATIVE_APP_ID,
  NATIVE_APP_MARK,
  NATIVE_SCHEME,
  appleAppSiteAssociation,
  assetLinks,
  downloadName,
  isNativeAppAgent,
  nativeOpenPath,
  signInReturnUrl,
} from "./native-app";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const SITE = "https://kaizenaflow.com";

// Real web views' user agents, as the app sends them once `appendUserAgent` adds the mark.
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KaizenaFlowApp";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 15; Pixel 8 Build/AP4A.250105.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/142.0.7444.102 Mobile Safari/537.36 KaizenaFlowApp";

describe("the phone app's mark (D908)", () => {
  it("is found in the app's web views and nowhere else", () => {
    expect(isNativeAppAgent(IPHONE)).toBe(true);
    expect(isNativeAppAgent(ANDROID)).toBe(true);
    expect(isNativeAppAgent(IPHONE.replace(" KaizenaFlowApp", ""))).toBe(false);
    expect(isNativeAppAgent(ANDROID.replace(" KaizenaFlowApp", ""))).toBe(false);
    expect(isNativeAppAgent("Mozilla/5.0 NotKaizenaFlowApp")).toBe(false);
    expect(isNativeAppAgent(null)).toBe(false);
    expect(isNativeAppAgent("")).toBe(false);
  });

  it("is the word capacitor.config.ts adds, with the app's id and the scheme the native projects register", () => {
    const config = read("capacitor.config.ts");
    expect(config).toContain(`appendUserAgent: "${NATIVE_APP_MARK}"`);
    expect(config).toContain(`appId: "${NATIVE_APP_ID}"`);
    expect(read("android/app/src/main/AndroidManifest.xml")).toContain(`android:scheme="${NATIVE_SCHEME}"`);
    expect(read("ios/App/App/Info.plist")).toContain(`<string>${NATIVE_SCHEME}</string>`);
  });
});

describe("where a sign-in through Kaizen Life comes back to", () => {
  it("is the site's callback in a browser and the app's scheme in the app", () => {
    expect(signInReturnUrl(SITE, "via=kaizen-life&next=%2Fadmin", false)).toBe(`${SITE}/auth/callback?via=kaizen-life&next=%2Fadmin`);
    expect(signInReturnUrl(SITE, "via=kaizen-life&next=%2Fadmin", true)).toBe("kaizenaflow://auth/callback?via=kaizen-life&next=%2Fadmin");
  });
});

describe("the addresses the app opens when it is handed one", () => {
  it("turns its scheme's sign-in return into the site's callback, query kept", () => {
    expect(nativeOpenPath("kaizenaflow://auth/callback?code=abc&via=kaizen-life&next=%2Fadmin%2Fdemo", SITE)).toBe(
      "/auth/callback?code=abc&via=kaizen-life&next=%2Fadmin%2Fdemo",
    );
  });

  it("opens an email's sign-in link and the admin's pages on its own site", () => {
    expect(nativeOpenPath(`${SITE}/auth/confirm?token_hash=xyz&type=email`, SITE)).toBe("/auth/confirm?token_hash=xyz&type=email");
    expect(nativeOpenPath(`${SITE}/admin/demo/orders/1001`, SITE)).toBe("/admin/demo/orders/1001");
    expect(nativeOpenPath(`${SITE}/admin`, SITE)).toBe("/admin");
  });

  it("opens nothing else: another site, scheme or path, or a path that climbs", () => {
    expect(nativeOpenPath("https://evil.example/auth/confirm?token_hash=xyz", SITE)).toBeNull();
    expect(nativeOpenPath("https://kaizenaflow.com.evil.example/admin", SITE)).toBeNull();
    expect(nativeOpenPath("kaizenaflow://elsewhere/callback?code=abc", SITE)).toBeNull();
    expect(nativeOpenPath("otherapp://auth/callback?code=abc", SITE)).toBeNull();
    expect(nativeOpenPath(`${SITE}/s/demo/no`, SITE)).toBeNull();
    expect(nativeOpenPath(`${SITE}/administrator`, SITE)).toBeNull();
    expect(nativeOpenPath("kaizenaflow://auth/callback/../../admin", SITE)).toBeNull();
    expect(nativeOpenPath("not a url", SITE)).toBeNull();
  });
});

describe("the name a file downloaded in the app is saved under", () => {
  const href = `${SITE}/admin/demo/activity/export`;

  it("takes the server's name first, its UTF-8 form before the plain one", () => {
    expect(downloadName(`attachment; filename="orders.csv"`, null, href)).toBe("orders.csv");
    expect(downloadName(`attachment; filename="ordre.csv"; filename*=UTF-8''%C3%B8kter.csv`, null, href)).toBe("økter.csv");
    expect(downloadName("attachment; filename=report.pdf", "other.csv", href)).toBe("report.pdf");
  });

  it("falls back to the link's name, then the address, then a plain word", () => {
    expect(downloadName(null, "kontakter.csv", href)).toBe("kontakter.csv");
    expect(downloadName(null, "", href)).toBe("export");
    expect(downloadName(null, null, "blob:https://kaizenaflow.com/4f1e")).toBe("4f1e");
    expect(downloadName(null, null, `${SITE}/`)).toBe("download");
  });

  it("is never a path and holds no character a phone refuses", () => {
    expect(downloadName(`attachment; filename="../../etc/passwd"`, null, href)).toBe("passwd");
    expect(downloadName(null, "a:b?c*.csv", href)).toBe("a_b_c_.csv");
    expect(downloadName(null, ".hidden", href)).toBe("hidden");
  });
});

describe("the app's own offline page", () => {
  it("says what the admin's offline page says, in both languages", () => {
    const page = read("capacitor-www/offline.html").replace(/\s+/g, " ");
    for (const lang of ["en", "nb"] as const) {
      const w = SHELL_WORDS[lang].push;
      expect(page).toContain(w.offlineTitle);
      expect(page).toContain(w.offlineBody);
      expect(page).toContain(w.reload);
    }
  });
});

describe("the link files that let an email's sign-in link open the app", () => {
  const FINGERPRINT = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0").toUpperCase()).join(":");

  it("name the app and only the token-hash sign-in path, which the native projects claim too", () => {
    expect(appleAppSiteAssociation("ABCDE12345")).toEqual({
      applinks: { details: [{ appIDs: [`ABCDE12345.${NATIVE_APP_ID}`], components: [{ "/": "/auth/confirm" }] }] },
    });
    expect(assetLinks([FINGERPRINT])).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: { namespace: "android_app", package_name: NATIVE_APP_ID, sha256_cert_fingerprints: [FINGERPRINT] },
      },
    ]);
    const manifest = read("android/app/src/main/AndroidManifest.xml");
    for (const path of APP_LINK_PATHS) expect(manifest).toContain(`android:host="kaizenaflow.com" android:path="${path}"`);
    expect(manifest).not.toMatch(/android:scheme="https"[^>]*\/auth\/callback/);
    expect(read("ios/App/App/App.entitlements")).toContain("<string>applinks:kaizenaflow.com</string>");
    expect(read("ios/App/App.xcodeproj/project.pbxproj")).toContain("CODE_SIGN_ENTITLEMENTS = App/App.entitlements;");
  });

  it("read their settings, empty meaning none, and refuse a malformed one", () => {
    expect(appLinksEnv({})).toEqual({ appleTeamId: null, androidFingerprints: [] });
    expect(appLinksEnv({ APPLE_TEAM_ID: " abcde12345 ", ANDROID_APP_SHA256: `${FINGERPRINT.toLowerCase()}, ${FINGERPRINT}` })).toEqual({
      appleTeamId: "ABCDE12345",
      androidFingerprints: [FINGERPRINT, FINGERPRINT],
    });
    expect(() => appLinksEnv({ APPLE_TEAM_ID: "ABC" })).toThrow(/APPLE_TEAM_ID/);
    expect(() => appLinksEnv({ ANDROID_APP_SHA256: "AA:BB" })).toThrow(/ANDROID_APP_SHA256/);
  });
});
