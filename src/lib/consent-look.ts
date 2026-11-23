import { consentColours, type ConsentColours, type ConsentLook, type ThemeSettings } from "./theme";

/**
 * The cookie banner and popup's look (D883), as Design settings' *Cookie popup* card edits it. Pure; the CSS is written by `themeCss()`
 * (`--consent-*`) and drawn by `.consent-look` in globals.css, so the popup reads only its own variables wherever it sits on the page.
 */

/** The look with a change laid over it: a choice set to `undefined` is taken out, so it follows the theme again. */
export function patchConsentLook(current: ConsentLook | undefined, patch: Partial<ConsentLook>): ConsentLook {
  const next: Record<string, unknown> = { ...current, ...patch };
  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
  return next as ConsentLook;
}

/** Whether the popup is drawn otherwise than the theme draws it in Lisa's settings: colours, corners, font or shadow of its own (the set it takes is Homer's choice). */
export const consentLookOwn = (look: ConsentLook | undefined): boolean =>
  look !== undefined &&
  (look.colours !== undefined || look.corners !== undefined || look.buttonCorners !== undefined || look.heading !== undefined || look.shadow !== undefined);

/** The look drawn as the theme draws it again, its colour set kept. */
export const followTheme = (current: ConsentLook | undefined): ConsentLook => (current?.scheme ? { scheme: current.scheme } : {});

/** Colours of its own to start from: what the popup shows now in each set, so choosing them changes nothing until one is edited. */
export function startingColours(settings: ThemeSettings): { light: ConsentColours; dark: ConsentColours } {
  if (settings.consent?.colours) return settings.consent.colours;
  const plain: ThemeSettings = { ...settings, consent: undefined };
  return { light: consentColours(plain, "light").colours, dark: consentColours(plain, "dark").colours };
}
