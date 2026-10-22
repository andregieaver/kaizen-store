/** A language code as the admin names it, in the admin's language (`nb` → "Norwegian Bokmål", or "norsk bokmål"); English unless a display language is given, and the code itself when the browser or server cannot name it. */
export function languageLabel(lang: string, display = "en"): string {
  try {
    return new Intl.DisplayNames([display], { type: "language" }).of(lang) ?? lang;
  } catch {
    return lang;
  }
}
