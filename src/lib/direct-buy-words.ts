/**
 * The words of Buy now past the cart page (D915): the button's, and the lead before what pressing it agrees to. Loaded with import() by the
 * product page and the pricing table only where a product skips the cart, so the store's other pages carry none (the storefront messages
 * budget). The hand-written languages, else English, as `t()` falls back.
 */
const WORDS: Record<string, { buyNow: string; lead: string }> = {
  en: { buyNow: "Buy now", lead: "By pressing the button, you confirm:" },
  nb: { buyNow: "Kjøp nå", lead: "Ved å trykke på knappen bekrefter du:" },
  sv: { buyNow: "Köp nu", lead: "Genom att trycka på knappen bekräftar du:" },
  da: { buyNow: "Køb nu", lead: "Ved at trykke på knappen bekræfter du:" },
};

export const directBuyWords = (lang: string) => (Object.hasOwn(WORDS, lang) ? WORDS[lang] : WORDS.en);
