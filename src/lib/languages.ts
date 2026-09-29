/**
 * The world's languages a platform admin can add for stores to offer (D111).
 * A curated list of languages with millions of speakers (their names come from
 * `Intl`, in any language), by ISO 639 code; the platform can offer any of them,
 * and a language that is not here can be added by its code.
 */

const WORLD = [
  "af", "am", "ar", "az", "be", "bg", "bn", "bs", "ca", "cs", "cy", "da", "de", "el", "en", "es", "et", "eu", "fa", "fi", "fr", "ga", "gl", "gu",
  "ha", "he", "hi", "hr", "hu", "hy", "id", "ig", "is", "it", "ja", "ka", "kk", "km", "kn", "ko", "ky", "lb", "lo", "lt", "lv", "mg", "mk", "ml",
  "mn", "mr", "ms", "mt", "my", "nb", "ne", "nl", "nn", "pa", "pl", "ps", "pt", "ro", "ru", "si", "sk", "sl", "sn", "so", "sq", "sr", "sv", "sw",
  "ta", "te", "tg", "th", "tk", "tl", "tr", "uk", "ur", "uz", "vi", "xh", "yo", "zh", "zu",
] as const;

/** Languages written right to left, which the storefront will need to draw differently. */
const RIGHT_TO_LEFT = new Set(["ar", "he", "fa", "ur", "ps", "sd", "yi", "dv", "ug", "ckb"]);

export type WorldLanguage = { lang: string; name: string; locale: string; direction: "ltr" | "rtl" };

const englishNames = () => new Intl.DisplayNames(["en"], { type: "language" });

/** A language's main locale, from its likeliest region: `de` → `de-DE`. */
export function defaultLocale(lang: string): string {
  try {
    const region = new Intl.Locale(lang).maximize().region;
    return region ? `${lang}-${region}` : lang;
  } catch {
    return lang;
  }
}

export const directionOf = (lang: string): "ltr" | "rtl" => (RIGHT_TO_LEFT.has(lang) ? "rtl" : "ltr");

/** Whether a string is a language code the platform can add: two or three letters that `Intl` knows. */
export function isLanguageCode(lang: string): boolean {
  if (!/^[a-z]{2,3}$/.test(lang)) return false;
  return englishNames().of(lang) !== lang;
}

export function worldLanguage(lang: string): WorldLanguage {
  return { lang, name: englishNames().of(lang) ?? lang, locale: defaultLocale(lang), direction: directionOf(lang) };
}

/** The curated list, by English name. */
export function worldLanguages(): WorldLanguage[] {
  return WORLD.map(worldLanguage).sort((a, b) => a.name.localeCompare(b.name));
}

/** A language's name in itself, as its speakers know it: "Deutsch", "Norsk bokmål". */
export function nativeName(lang: string): string {
  const name = new Intl.DisplayNames([lang], { type: "language" }).of(lang) ?? lang;
  return name.charAt(0).toLocaleUpperCase(lang) + name.slice(1);
}
