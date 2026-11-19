/**
 * The language an email is written in, among the languages a site answers in (D332): the AI's email answer and the email around it are
 * written in it, so a customer who writes Norwegian to an English desk is answered in Norwegian. A count of common short words, for the
 * languages the chat's prompt names (`LANGUAGES` in `src/lib/chat.ts`); null when the text does not say clearly (too short, a tie, or a
 * language the site does not offer), and the site's own language stands.
 */

/** Common words of each language, lower case; a word shared by two languages counts for both. */
const WORDS: Record<string, readonly string[]> = {
  en: ["the", "and", "you", "is", "are", "have", "has", "what", "how", "many", "my", "with", "not", "this", "that", "please", "thanks", "thank", "hello", "hi", "can", "would", "will", "your", "do", "does", "i", "me", "it", "of", "to", "in", "an", "a", "where", "when", "why", "order", "help"],
  nb: ["jeg", "og", "ikke", "det", "er", "har", "hva", "hvor", "hvorfor", "hvordan", "mange", "min", "mitt", "mine", "med", "på", "til", "dere", "deg", "du", "hei", "takk", "vil", "kan", "en", "et", "som", "av", "om", "denne", "dette", "meg", "noe", "også", "skal", "bestilling", "hjelp", "hilsen", "vennlig", "eposten", "e-posten", "svare", "nettside", "nettsider"],
  sv: ["jag", "och", "inte", "det", "är", "har", "vad", "hur", "varför", "många", "min", "mitt", "mina", "med", "på", "till", "ni", "dig", "du", "hej", "tack", "vill", "kan", "en", "ett", "som", "av", "om", "denna", "detta", "mig", "något", "också", "ska", "beställning", "hjälp", "hälsningar"],
  da: ["jeg", "og", "ikke", "det", "er", "har", "hvad", "hvor", "hvorfor", "hvordan", "mange", "min", "mit", "mine", "med", "på", "til", "jer", "dig", "du", "hej", "tak", "vil", "kan", "en", "et", "som", "af", "om", "denne", "dette", "mig", "noget", "også", "skal", "bestilling", "hjælp", "hilsen", "venlig"],
  de: ["ich", "und", "nicht", "das", "ist", "habe", "hat", "was", "wie", "warum", "viele", "mein", "meine", "mit", "für", "auf", "zu", "sie", "du", "hallo", "danke", "bitte", "kann", "der", "die", "ein", "eine", "ihr", "mich", "auch", "bestellung", "hilfe", "grüße"],
  fi: ["minä", "ja", "ei", "se", "on", "mitä", "miten", "miksi", "monta", "minun", "kanssa", "sinä", "te", "hei", "kiitos", "haluan", "voin", "voitko", "tämä", "myös", "tilaus", "apua", "terveisin"],
};

/** The language subtag of a locale or a language (`nb-NO` → `nb`). */
const subtag = (lang: string) => lang.split("-")[0].toLowerCase();

/**
 * The language of `text` among `offered` (language subtags or locales, the site's), as the subtag; null when it is not clear. A language
 * needs at least two of its words, and more than any other offered language.
 */
export function emailLanguage(text: string, offered: readonly string[]): string | null {
  const candidates = [...new Set(offered.map(subtag))].filter((lang) => Object.hasOwn(WORDS, lang));
  if (candidates.length < 2) return null;
  const words = text.toLowerCase().slice(0, 4000).match(/[\p{L}-]+/gu) ?? [];
  const scores = candidates
    .map((lang) => {
      const known = new Set(WORDS[lang]);
      return { lang, score: words.filter((word) => known.has(word)).length };
    })
    .sort((a, b) => b.score - a.score);
  const [best, next] = scores;
  return best.score >= 2 && best.score > (next?.score ?? 0) ? best.lang : null;
}
