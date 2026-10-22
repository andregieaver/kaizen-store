/**
 * The server's English answers in a person's language (D312 A8): the tax and payments modules answer in English, as the AI manager and the tests
 * read them, and their screens say each answer from a catalogue's `problems` by matching the English template (`{name}` parts carried over, and
 * said in the language too where they are themselves a listed text). Anything that matches no template stays as written.
 */

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Pattern = { key: string; names: string[]; pattern: RegExp };

const cache = new WeakMap<Record<string, string>, Pattern[]>();

function patternsOf(english: Record<string, string>): Pattern[] {
  const known = cache.get(english);
  if (known) return known;
  const patterns = Object.entries(english).map(([key, template]) => {
    const names: string[] = [];
    const source = template
      .split(/(\{\w+\})/)
      .map((part) => {
        const name = /^\{(\w+)\}$/.exec(part)?.[1];
        if (!name) return escape(part);
        names.push(name);
        return "(.+?)";
      })
      .join("");
    return { key, names, pattern: new RegExp(`^${source}$`, "s") };
  });
  // A template without a placeholder is tried first, so a plain sentence is never taken for a template's part.
  patterns.sort((a, b) => a.names.length - b.names.length);
  cache.set(english, patterns);
  return patterns;
}

/** `text` in `words`, the listed text whose English (`english`) matches it, or `text` as it is. */
export function knownText<T extends Record<string, string>>(text: string, english: T, words: T): string {
  if (english === words) return text;
  for (const { key, names, pattern } of patternsOf(english)) {
    const found = pattern.exec(text);
    if (!found) continue;
    return names.reduce((out, name, i) => out.replace(`{${name}}`, () => knownText(found[i + 1], english, words)), words[key]);
  }
  return text;
}
