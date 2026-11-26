import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { StatusBar, Style } from "@capacitor/status-bar";

import { showsDark } from "@/lib/color-mode";
import { downloadName, nativeOpenPath } from "@/lib/native-app";

/**
 * What the phone app adds to the admin (D908, `docs/mobile-app.md`), loaded with `import()` by `NativeApp` only inside the app, so a
 * browser never fetches it. Three jobs:
 *
 * 1. Addresses handed to the app (`appUrlOpen`, and the one it was launched with), each once: the sign-in that comes back from the phone's
 *    browser at `kaizenaflow://auth/callback?…`, and an email's sign-in link to `/auth/confirm`, are opened in the app's own web view,
 *    where the sign-in's cookies are (`nativeOpenPath()` says which; anything else is left alone).
 * 2. The status bar: dark or light text for the admin's own colours, which follow the account's choice and not only the phone's.
 * 3. Downloads: a web view saves no file, so a press on a download link (`<a download>`, the admin's exports and reports) fetches the file
 *    with the person's own session and hands it to the phone's share sheet, from which it is saved or sent.
 *
 * Returns what undoes it all.
 */
export async function startNativeApp(): Promise<() => void> {
  const stops: (() => void)[] = [];

  const opened = await App.addListener("appUrlOpen", ({ url }) => open(url));
  stops.push(() => void opened.remove());
  void openLaunchUrl();

  void paintStatusBar();
  const observer = new MutationObserver(() => void paintStatusBar());
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-color-mode", "data-admin-scheme", "class"] });
  const scheme = window.matchMedia("(prefers-color-scheme: dark)");
  const repaint = () => void paintStatusBar();
  scheme.addEventListener("change", repaint);
  stops.push(() => {
    observer.disconnect();
    scheme.removeEventListener("change", repaint);
  });

  document.addEventListener("click", onDownloadClick, true);
  stops.push(() => document.removeEventListener("click", onDownloadClick, true));

  return () => {
    for (const stop of stops) stop();
  };
}

/**
 * The last address handed to the app, kept for the app's run: each is opened once. An iPhone hands the address that launched the app both
 * as an event and as the launch address, and every page load asks for the launch address again; a sign-in link opened twice would spend
 * its one use and then show an error.
 */
const LAST_KEY = "kaizen_native_launch";

function open(url: string): void {
  const path = nativeOpenPath(url, window.location.origin);
  if (!path) return;
  try {
    if (sessionStorage.getItem(LAST_KEY) === url) return;
    sessionStorage.setItem(LAST_KEY, url);
  } catch {
    // Storage refused: opened all the same, as a link the person tapped is worth more than a second opening it may cause.
  }
  // The sign-in page in the phone's browser has done its work: close it where the platform lets the app (iPhone), and go on in the app.
  void Browser.close().catch(() => {});
  window.location.assign(path);
}

async function openLaunchUrl(): Promise<void> {
  try {
    const launch = await App.getLaunchUrl();
    if (launch?.url) open(launch.url);
  } catch {
    // No launch address: the app opened from its icon, on the start page it is already on.
  }
}

async function paintStatusBar(): Promise<void> {
  const dark = showsDark();
  try {
    // `Style.Dark` is light text, for a dark page.
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
    const color = hexOf(getComputedStyle(document.body).backgroundColor);
    // Android before 15 paints a bar of its own behind the status bar; from 15 the page reaches under it and this does nothing.
    if (color) await StatusBar.setBackgroundColor({ color }).catch(() => {});
  } catch {
    // A platform without a status bar to style.
  }
}

/** `rgb(246, 247, 242)` as `#f6f7f2`, or null for anything else (a transparent body). */
function hexOf(css: string): string | null {
  const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(css.trim());
  if (!match || (match[4] !== undefined && Number(match[4]) < 1)) return null;
  return `#${match
    .slice(1, 4)
    .map((part) => Number(part).toString(16).padStart(2, "0"))
    .join("")}`;
}

function onDownloadClick(event: MouseEvent): void {
  if (event.defaultPrevented || event.button !== 0) return;
  const target = event.target;
  const link = target instanceof Element ? target.closest("a[download]") : null;
  if (!(link instanceof HTMLAnchorElement) || !link.href) return;
  let url: URL;
  try {
    url = new URL(link.href, window.location.href);
  } catch {
    return;
  }
  // Only the site's own files (with the person's own session) and files the page made itself; another site's link goes on as a link.
  if (url.protocol !== "blob:" && url.protocol !== "data:" && url.origin !== window.location.origin) return;
  event.preventDefault();
  void saveAndShare(url.href, link.getAttribute("download")).catch(() => {
    // Not fetched or not saved: the web view shows the file itself where it can, as before.
    window.location.assign(url.href);
  });
}

async function saveAndShare(href: string, suggested: string | null): Promise<void> {
  const response = await fetch(href, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`download ${response.status}`);
  const blob = await response.blob();
  const name = downloadName(response.headers.get("content-disposition"), suggested, href);
  const { uri } = await Filesystem.writeFile({ path: name, data: await base64Of(blob), directory: Directory.Cache });
  // Closing the share sheet without choosing is the person's answer, not a failure to fall back from.
  await Share.share({ title: name, files: [uri] }).catch(() => {});
}

function base64Of(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read"));
    // A data URL: the part after the comma is the base64 the file system writes.
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.readAsDataURL(blob);
  });
}
