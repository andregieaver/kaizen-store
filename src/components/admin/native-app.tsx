"use client";

import { useEffect } from "react";

/** Capacitor's bridge, which the phone app's web view puts on every page it loads (D908); absent in a browser. */
type WithBridge = { Capacitor?: { isNativePlatform?: () => boolean } };

/**
 * The phone app's own parts (D908, `docs/mobile-app.md`): inside the app only, loads `startNativeApp()` with `import()`, so a browser
 * fetches none of it. Drawn by the admin's root layout, sign-in included, because a sign-in comes back to the app on the sign-in page.
 */
export function NativeApp() {
  useEffect(() => {
    if ((window as WithBridge).Capacitor?.isNativePlatform?.() !== true) return;
    let stop: (() => void) | null = null;
    let gone = false;
    import("@/lib/native-app-bridge")
      .then(({ startNativeApp }) => startNativeApp())
      .then((undo) => {
        if (gone) undo();
        else stop = undo;
      })
      .catch(() => {
        // The bridge did not load (an old build without a plugin): the admin works as a web page.
      });
    return () => {
      gone = true;
      stop?.();
    };
  }, []);
  return null;
}
