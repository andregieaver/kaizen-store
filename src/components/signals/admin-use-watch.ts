/**
 * Admin heatmaps' and recordings' eyes (D895 phase 3b): for a store owner who allowed heatmaps of their own use, a view of each measured
 * admin screen, kept and sent as the storefront's heatmaps do (`heat-collector.ts`, `click-watch.ts`), but under the screen's key and to the
 * admin's own endpoint; for one who also allowed recordings, the storefront's recorder in its admin form (every text masked, pictures
 * blocked) on a share of tabs. On a screen that is never measured (`adminScreenKey()` null) nothing is watched and the recorder pauses.
 * Loaded only when the browser's choice cookie says so; the server checks the stored choice again.
 */

import { ADMIN_HEAT_ENDPOINT, ADMIN_HEAT_STORE } from "@/lib/admin-heat";
import { scrubAdminEvents } from "@/lib/admin-replay-scrub";
import { adminScreenKey } from "@/lib/admin-screens";
import { deviceClass } from "@/lib/page-heat";

import { flushClicks, startClickWatch, stopClickWatch } from "./click-watch";
import { addVerdicts, endView, startView as startHeatView, summarise, visibilityChanged } from "./heat-collector";

/** The admin's breakpoints: Tailwind's `md` and `lg`. */
const ADMIN_BREAKPOINTS = { md: 768, lg: 1024 };

/** The share of an owner's tabs that are recorded. */
const ADMIN_REC_SHARE = 50;

let current: string | null = null;
let listening = false;
let recording = false;

/** The recorder, loaded on first need so rrweb is never in the admin's first scripts. */
type Recorder = typeof import("./session-recorder");
let recorder: Recorder | null = null;
let loading: Promise<Recorder> | null = null;
const loadRecorder = () => (loading ??= import("./session-recorder").then((m) => (recorder = m)));

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

const onVerdicts = (verdicts: Parameters<typeof addVerdicts>[0]) => {
  addVerdicts(verdicts);
  recorder?.noteClicks(verdicts);
};

/**
 * The screen at `pathname` is now on show: ends the last screen's view and starts this one's, if it is measured; with `record`, the
 * recorder records it, or pauses on a screen never measured.
 */
export function watchScreen(pathname: string, record: boolean): void {
  swallow(() => {
    const key = adminScreenKey(pathname);
    recording = record;
    if (key === current) return;
    if (current !== null) finish();
    current = key;
    if (key === null) {
      stopClickWatch();
      recorder?.pause(false);
      return;
    }
    startClickWatch(onVerdicts);
    startView(key);
    listen();
    if (record) {
      const device = deviceClass(window.innerWidth, ADMIN_BREAKPOINTS);
      void loadRecorder()
        .then((r) =>
          r.recordPage(
            {
              id: "admin",
              slug: "admin",
              share: ADMIN_REC_SHARE,
              mask: "strict",
              device,
              admin: {
                screen: () => adminScreenKey(window.location.pathname),
                // Nothing with a word or an address leaves the browser; the server scrubs again.
                scrub: (event) => {
                  const kept = scrubAdminEvents([event], adminScreenKey(window.location.pathname) ?? "");
                  return kept === null ? null : kept[0];
                },
              },
            },
            key,
          ),
        )
        .catch(() => {});
    }
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
        recorder?.hidden();
      }
    }),
  );
  window.addEventListener("pagehide", () =>
    swallow(() => {
      finish();
      recorder?.pause(true);
      current = null;
    }),
  );
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) watchScreen(window.location.pathname, recording);
  });
}
