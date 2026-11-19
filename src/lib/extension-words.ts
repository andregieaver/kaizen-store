import type { PublicExtensions } from "./extension-offer";
import { EXTENSION_WORDS_NB } from "./extension-words.nb";

/** The extensions' own words by language (D312): Norwegian by the English they are written in; English is the data as it is. */
const WORDS: Partial<Record<string, Record<string, string>>> = { nb: EXTENSION_WORDS_NB };

/**
 * Kaizena Flow's extensions in `lang` (D748 E8, as `plansIn()` for plans): each extension's and bundle's name and line and each size's name
 * where they are written in it, else as written. Pure: `ExtensionsSection` reads the catalogue and draws it in the page's language.
 */
export function extensionsIn(data: PublicExtensions, lang: string): PublicExtensions {
  const words = WORDS[lang];
  if (!words) return data;
  const say = (text: string) => (Object.hasOwn(words, text) ? words[text] : text);
  return {
    ...data,
    extensions: data.extensions.map((e) => ({ ...e, name: say(e.name), description: say(e.description), size: e.size && { ...e.size, label: say(e.size.label) } })),
    bundles: data.bundles.map((b) => ({ ...b, name: say(b.name), description: say(b.description) })),
  };
}
