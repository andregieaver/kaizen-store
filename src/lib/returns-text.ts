import { daReturns } from "./messages/da-returns";
import { enReturns, type ReturnsMessages } from "./messages/en-returns";
import { nbReturns } from "./messages/nb-returns";
import { svReturns } from "./messages/sv-returns";
import { overlayMessages } from "./ui-catalog";
import { registeredTexts, registeredUi } from "./ui-registry";

/**
 * The withdrawal function's words (D153) for its page's client component, apart from `browserText()` so only that page loads them
 * (D212). A language translated by AI: on the server the registry's whole text, in the browser the catalogue's texts `UiTexts` kept,
 * laid over the English as `t()` would; else English.
 */
const HAND: Partial<Record<string, ReturnsMessages>> = { nb: nbReturns, sv: svReturns, da: daReturns, en: enReturns };

export function returnsText(lang: string): ReturnsMessages {
  if (Object.hasOwn(HAND, lang)) return HAND[lang]!;
  const whole = (registeredUi(lang) as { returns?: ReturnsMessages } | undefined)?.returns;
  if (whole) return whole;
  const texts = registeredTexts(lang);
  return texts ? overlayMessages("ui", { returns: enReturns }, texts, lang).returns : enReturns;
}
