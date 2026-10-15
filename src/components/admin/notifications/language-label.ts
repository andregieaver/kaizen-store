/** A language code as the admin names it, in English (`nb` → "Norwegian Bokmål"); the code itself when the browser or server cannot name it. */
export function languageLabel(lang: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(lang) ?? lang;
  } catch {
    return lang;
  }
}
