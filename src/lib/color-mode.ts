/**
 * Light and dark (D99): someone's own choice over their device's. The page's
 * `<html>` carries `data-color-mode` ("light" or "dark") when a choice is
 * made; without it, the device decides. globals.css, store themes (D60)
 * and Tailwind's `dark:` all follow it.
 */

export const COLOR_CHOICES = { system: "Same as this device", light: "Light", dark: "Dark" } as const;
export type ColorChoice = keyof typeof COLOR_CHOICES;

export const isColorChoice = (value: unknown): value is ColorChoice =>
  typeof value === "string" && Object.hasOwn(COLOR_CHOICES, value);

/** Where the admin keeps the account's choice in the browser, for the first paint (the account holds it too). */
export const ADMIN_COLOR_KEY = "kaizen_admin_color_mode";

/** Where a store keeps a visitor's choice (D99): per store, as stores can share Kaizen's address. */
export const storeColorKey = (storeId: string) => `color_mode_${storeId}`;

/**
 * The first script of a page: the saved choice on `<html>` before the page
 * is drawn, so it never flashes the other colours. Without one, the page's
 * own mode stays (a store's fixed light or dark, or the device's).
 */
export function colorModeScript(key: string): string {
  return `(function(){try{var m=localStorage.getItem(${JSON.stringify(key)});if(m==="light"||m==="dark")document.documentElement.setAttribute("data-color-mode",m);}catch(e){}})();`;
}

/** Whether the page shows its dark colours now: the choice on `<html>`, else the device's. */
export function showsDark(): boolean {
  const chosen = document.documentElement.getAttribute("data-color-mode");
  if (chosen === "dark" || chosen === "light") return chosen === "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Applies a choice to the page and keeps it in the browser; `system` goes
 * back to `fallback` (a store's fixed mode) or the device.
 */
export function applyColorChoice(key: string, choice: ColorChoice, fallback: "light" | "dark" | null = null): void {
  const root = document.documentElement;
  const mode = choice === "system" ? fallback : choice;
  if (mode) root.setAttribute("data-color-mode", mode);
  else root.removeAttribute("data-color-mode");
  try {
    if (choice === "system") localStorage.removeItem(key);
    else localStorage.setItem(key, choice);
  } catch {
    // Storage blocked: the choice lasts for this page.
  }
  window.dispatchEvent(new Event(COLOR_EVENT));
}

/** Said on `window` when the page's colours change, for parts drawn by script (Stripe's). */
export const COLOR_EVENT = "kaizen:color-mode";
