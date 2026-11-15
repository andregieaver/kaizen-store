/**
 * A language's flag and short code in the language switcher (D479). Kept apart from `language-switch.ts` (which reads the page model):
 * the visitor's scripts draw Kaizena Flow's own switcher with them, and must not carry the model (`storefront-bundle.scan.test.ts`).
 */

/**
 * The countries whose flags are kept (`public/flags/{code}.svg`, from flag-icons, MIT; a test holds the two together): the EU's, the EEA's, Switzerland, the United
 * Kingdom and the United States. A language whose country has none is shown without a flag.
 */
export const FLAG_COUNTRIES: readonly string[] = [
  "at", "be", "bg", "ch", "cy", "cz", "de", "dk", "ee", "es", "fi", "fr", "gb", "gr", "hr", "hu", "ie",
  "is", "it", "li", "lt", "lu", "lv", "mt", "nl", "no", "pl", "pt", "ro", "se", "si", "sk", "us",
];

/** Flags with detailed arms are kept as 60 by 45 pixel pictures (three times their drawn size): as drawings they weighed 165 KB together (bloat review step 0.32). */
export const RASTER_FLAGS: readonly string[] = ["es", "hr", "mt", "li", "pt", "cy"];

/** The country a language's flag is, for a language written without a country (`en` alone): where most of its readers are. */
const LANGUAGE_COUNTRY: Readonly<Record<string, string>> = {
  bg: "bg", cs: "cz", da: "dk", de: "de", el: "gr", en: "gb", es: "es", et: "ee", fi: "fi", fr: "fr", ga: "ie", hr: "hr", hu: "hu",
  is: "is", it: "it", lb: "lu", lt: "lt", lv: "lv", mt: "mt", nb: "no", nl: "nl", nn: "no", no: "no", pl: "pl", pt: "pt", ro: "ro",
  sk: "sk", sl: "si", sv: "se",
};

/**
 * A language's flag, as an address under `/flags`: the country its variant names (`en-IE` the Irish flag, `sv-FI` the Finnish), else the
 * country most of its readers are in; null where none is kept.
 */
export function flagOf(locale: string): string | null {
  const [lang = "", region] = locale.split("-");
  const country = region?.toLowerCase() ?? LANGUAGE_COUNTRY[lang.toLowerCase()];
  return country && FLAG_COUNTRIES.includes(country) ? `/flags/${country}.${RASTER_FLAGS.includes(country) ? "webp" : "svg"}` : null;
}

/** A language's short code as the switcher writes it: `EN`, `NB`. */
export const languageCode = (locale: string): string => locale.split("-")[0].toUpperCase();
