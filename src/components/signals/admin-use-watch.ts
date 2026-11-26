/**
 * Admin heatmaps' eyes (D895 phase 3b): for a store owner who allowed heatmaps of their own use, a view of each measured admin screen,
 * kept and sent as the storefront's heatmaps do (`heat-collector.ts`, `click-watch.ts`), but under the screen's key and to the admin's own
 * endpoint. On a screen that is never measured (`adminScreenKey()` null) nothing is watched. Loaded only when the browser's choice cookie
 * says so; the server checks the stored choice again.
 */

import { ADMIN_HEAT_ENDPOINT, ADMIN_HEAT_STORE } from "@/lib/admin-heat";
import { adminScreenKey } from "@/lib/admin-screens";
import { deviceClass } from "@/lib/page-heat";

import { flushClicks, startClickWatch, stopClickWatch } from "./click-watch";
import { addVerdicts, endView, startView as startHeatView, summarise, visibilityChanged } from "./heat-collector";

/** The admin's breakpoints: Tailwind's `md` and `lg`. */
const ADMIN_BREAKPOINTS = { md: 768, lg: 1024 };

let current: string | null = null;
let listening = false;

const swallow = (run: () => void) => {
  try {
    run();
  } catch {
    // Measuring is never worth an error in an owner's browser.
  }
};

function finish() {
  addVerdicts(flushClicks());
  endView();
}

/** The screen at `pathname` is now on show: ends the last screen's view and starts this one's, if it is measured. */
export function watchScreen(pathname: string): void {
  swallow(() => {
    const key = adminScreenKey(pathname);
    if (key === current) return;
    if (current !== null) finish();
    current = key;
    if (key === null) {
      stopClickWatch();
      return;
    }
    startClickWatch(addVerdicts);
    startView(key);
    listen();
  });
}

function startView(key: string) {
  startHeatView(ADMIN_HEAT_STORE, deviceClass(window.innerWidth, ADMIN_BREAKPOINTS), { endpoint: ADMIN_HEAT_ENDPOINT, path: key });
}

function listen() {
  if (listening) return;
  listening = true;
  document.addEventListener("visibilitychange", () =>
    swallow(() => {
      visibilityChanged();
      if (document.visibilityState === "hidden") {
        addVerdicts(flushClicks());
        summarise();
      }
    }),
  );
  window.addEventListener("pagehide", () =>
    swallow(() => {
      finish();
      current = null;
    }),
  );
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) watchScreen(window.location.pathname);
  });
}
