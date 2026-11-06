import type { PlatformLang } from "./platform-lang";
import { platformText } from "./platform-text";

/**
 * A platform menu's name for screen readers in the page's language (D85, D312): as the platform admin named it in English, else its
 * Norwegian by that name (`menuNames`) or plainly "Meny", never an English name read out on a Norwegian page.
 */
export function platformMenuName(name: string, lang: PlatformLang): string {
  if (lang === "en") return name;
  const words = platformText(lang);
  return Object.hasOwn(words.menuNames, name) ? words.menuNames[name] : words.nav.menu;
}
