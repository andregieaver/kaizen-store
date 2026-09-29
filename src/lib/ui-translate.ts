import { pluralForms, templateProblem } from "./icu-lite";
import type { CatalogEntry } from "./ui-catalog";

/**
 * Translating the interface text with AI (D111): the instructions to the
 * model, and the checks on what it answers. A text is used only if it keeps
 * every placeholder of the original and, for a message that chooses by its
 * arguments, chooses the same way in the language's own plural forms; what
 * fails is left for a person. Pure and shared with the browser.
 */

/** The named placeholders some texts carry for the site to fill in (`{left}`), which a translation keeps. */
const named = (text: string) => [...text.matchAll(/\{([A-Za-z]+)\}/g)].map((m) => m[1]).sort();

/** Why a translation of a plain text cannot be used, or null. */
export function textProblem(source: string, translated: string): string | null {
  const text = translated.trim();
  if (text === "") return "The text is empty.";
  if (/\{\d+\}|\{\d+,/.test(text)) return "It has a placeholder the original has not.";
  if (named(source).join(",") !== named(text).join(",")) {
    const want = named(source);
    return want.length > 0 ? `It must keep ${want.map((n) => `{${n}}`).join(" ")} as it is.` : "It has a placeholder the original has not.";
  }
  if (/[<>]/.test(text) && !/[<>]/.test(source)) return "It must be plain text, without markup.";
  if (text.length > source.length * 4 + 60) return "It is much longer than the original.";
  return null;
}

/** Why a translation of an entry cannot be used, or null. */
export function entryProblem(entry: CatalogEntry, translated: string, lang: string): string | null {
  if (entry.kind === "text") return textProblem(entry.source, translated);
  const text = translated.trim();
  if (text.length > entry.source.length * 4 + 80) return "It is much longer than the original.";
  return templateProblem(entry.source, text, lang);
}

/** The instructions and the texts, for one request to the model. */
export function uiMessages(language: { name: string; lang: string }, entries: readonly CatalogEntry[]): { role: "system" | "user"; content: string }[] {
  const forms = pluralForms(language.lang).join(", ");
  const rules = [
    `You translate the interface text of an online store (its storefront, cart, checkout, account pages and the emails it sends shoppers) from English into ${language.name}.`,
    `Write natural, short text, in the polite form of address that online shops use in ${language.name}. Keep the meaning; add and remove nothing; keep arrows, quotation marks and punctuation that belong to the interface.`,
    "Keep every placeholder exactly: {0}, {1}, … stand for values the site fills in (names, amounts, dates, numbers). Use all of them, in any order the language needs. A name in braces such as {left} is kept as it is.",
    `Some texts choose a form by a value: {0, plural, one {# day} other {# days}}. Translate the words inside the braces, keep the structure and the number sign #, and write every plural form ${language.name} needs: ${forms}. Where a text has =0 keep it.`,
    "A choice such as {1, select, true {…} other {…}} keeps its option names (true, other, yes, no, week…) exactly; translate only the words inside the braces.",
    "Do not translate brand or product names, and do not use HTML or markdown.",
    "Each text has an id, its key (where it is used, for context: cart.checkout is the checkout button) and its English. Answer with JSON only, one entry per id: {\"0\": \"translation\", \"1\": \"translation\"}.",
  ];
  const items = entries.map((entry, i) => ({ id: String(i), key: entry.key.replace(/^(ui|email):/, ""), en: entry.source }));
  return [
    { role: "system", content: rules.join("\n") },
    { role: "user", content: JSON.stringify(items) },
  ];
}

export type UiAnswer = { done: Map<string, string>; problems: { key: string; problem: string }[] };

/** The model's answer to a batch, checked entry by entry. */
export function readUiAnswer(answer: unknown, entries: readonly CatalogEntry[], lang: string): UiAnswer {
  const reply = answer && typeof answer === "object" ? (answer as Record<string, unknown>) : {};
  const result: UiAnswer = { done: new Map(), problems: [] };
  entries.forEach((entry, i) => {
    const value = reply[String(i)];
    if (typeof value !== "string") {
      result.problems.push({ key: entry.key, problem: "The AI left it out." });
      return;
    }
    const problem = entryProblem(entry, value, lang);
    if (problem) result.problems.push({ key: entry.key, problem });
    else result.done.set(entry.key, value.trim());
  });
  return result;
}

/** The entries in groups a model can answer in one reply. */
export function batchEntries(entries: readonly CatalogEntry[], maxCharacters = 4500, maxItems = 40): CatalogEntry[][] {
  const batches: CatalogEntry[][] = [];
  let current: CatalogEntry[] = [];
  let size = 0;
  for (const entry of entries) {
    if (current.length > 0 && (size + entry.source.length > maxCharacters || current.length >= maxItems)) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(entry);
    size += entry.source.length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
