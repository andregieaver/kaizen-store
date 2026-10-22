import "server-only";

import { languageAlternates, platformPath, type PlatformLang } from "@/lib/platform-lang";

import { getPlatformLangs } from "./platform-navigation";

/**
 * A page of Kaizena Flow's own site in a language (D312): its canonical address in that language and its addresses in every language the
 * site offers (`hreflang`), from its English `path`. With English alone there are no alternates.
 */
export async function languageMeta(lang: PlatformLang, path: string): Promise<{ canonical: string; languages?: Record<string, string> }> {
  const languages = languageAlternates(path, await getPlatformLangs());
  return { canonical: platformPath(lang, path), ...(languages && { languages }) };
}

/** Whether the site is offered in `lang` (English always is). */
export async function offersLang(lang: PlatformLang): Promise<boolean> {
  return (await getPlatformLangs()).includes(lang);
}
