import { platformEn, type PlatformMessages } from "./messages/platform-en";
import { platformNb } from "./messages/platform-nb";
import type { PlatformLang } from "./platform-lang";

export type { PlatformMessages };

const TEXTS: Record<PlatformLang, PlatformMessages> = { en: platformEn, nb: platformNb };

/** Kaizena Flow's own site's words in `lang` (D312 P2). */
export function platformText(lang: PlatformLang): PlatformMessages {
  return TEXTS[lang];
}
