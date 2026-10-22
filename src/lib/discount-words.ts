/**
 * The refusals of discount codes and campaigns in the admin's language (D312 A6): the server and the forms' schemas write them in English
 * (the AI manager's tools read them so), and a screen says each in the person's language when it is one of the catalogue's `problems`
 * written exactly so. A `{name}` in a template stands for whatever the English has there, carried over as it is (a code, an email, a
 * country), except the amount `notAmount` names, said from `amounts`. Any other text is left as written. Pure.
 */
import { fillWords } from "./admin-fill";
import { discountsEn, type DiscountsMessages } from "./admin-messages/discounts.en";

export type DiscountsWords = DiscountsMessages;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The values a template's placeholders stand for in `text`, or null when it is not written so. */
function matchTemplate(template: string, text: string): Record<string, string> | null {
  const names: string[] = [];
  const pattern = template
    .split(/(\{\w+\})/)
    .map((part) => {
      const name = /^\{(\w+)\}$/.exec(part)?.[1];
      if (!name) return escape(part);
      names.push(name);
      return "(.+?)";
    })
    .join("");
  const found = new RegExp(`^${pattern}$`, "s").exec(text);
  if (!found) return null;
  return Object.fromEntries(names.map((name, i) => [name, found[i + 1]]));
}

/** One text from an English table in the same key's words of another, its placeholders carried over; null when none fits. */
function fromTable(text: string, english: Record<string, string>, local: Record<string, string>): { key: string; text: string } | null {
  for (const [key, template] of Object.entries(english)) {
    const values = matchTemplate(template, text);
    if (values && local[key]) return { key, text: fillWords(local[key], values) };
  }
  return null;
}

/** A refusal in the person's language (`words` the `discounts` catalogue); the English when it is not one of the catalogue's. */
export function discountProblemText(text: string, words: DiscountsWords): string {
  if (words === discountsEn) return text;
  for (const [key, template] of Object.entries(discountsEn.problems)) {
    const values = matchTemplate(template, text);
    if (!values) continue;
    const local = (words.problems as Record<string, string>)[key];
    if (!local) return text;
    if (key === "notAmount" && values.what) values.what = fromTable(values.what, discountsEn.amounts, words.amounts)?.text ?? values.what;
    return fillWords(local, values);
  }
  return text;
}

/** Every refusal of a list in the person's language. */
export const discountProblemsText = (problems: readonly string[], words: DiscountsWords): string[] => problems.map((p) => discountProblemText(p, words));
