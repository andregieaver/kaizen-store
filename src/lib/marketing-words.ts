import { countWords } from "./admin-fill";
import { marketingEn, type MarketingMessages } from "./admin-messages/marketing.en";
import type { LifecycleKind } from "./automation-kinds";

/**
 * The marketing screens' sentences in a person's language (D312 A6). The server modules (`broadcasts.ts`, `segments.ts`, `automations.ts`) answer
 * in English, as the AI manager reads them; their actions say those answers in the account's language through `marketingProblem()`.
 */

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const PATTERNS = Object.entries(marketingEn.problems).map(([key, english]) => {
  const names: string[] = [];
  const source = english
    .split(/(\{\w+\})/)
    .map((part) => {
      const name = /^\{(\w+)\}$/.exec(part)?.[1];
      if (!name) return escape(part);
      names.push(name);
      return "(.+?)";
    })
    .join("");
  return { key: key as keyof MarketingMessages["problems"], names, pattern: new RegExp(`^${source}$`, "s") };
});

/**
 * An English answer of the server in the catalogue's words: the listed text whose English matches, with each `{name}` part carried over (and
 * said in the language too, where it is itself a listed text, as *It is on, so it needs words it can send: …*). Anything else stays as written.
 */
export function marketingProblem(text: string, words: MarketingMessages["problems"]): string {
  for (const { key, names, pattern } of PATTERNS) {
    const found = pattern.exec(text);
    if (!found) continue;
    return names.reduce((out, name, i) => out.replace(`{${name}}`, () => marketingProblem(found[i + 1], words)), words[key]);
  }
  return text;
}

/** What a lifecycle automation's days mean: *Sent 7 days after the order is delivered.* (and *Sent as soon as they join.* for a welcome at 0). */
export function automationDays(kind: LifecycleKind, n: number, words: MarketingMessages["automations"] = marketingEn.automations): string {
  const w = words.kinds[kind];
  return n === 0 && w.now ? w.now : countWords(n, w.days);
}
