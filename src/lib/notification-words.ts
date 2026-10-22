/**
 * The notifications and automation pages' refusals in the person's language (D312 A8). The schemas and the server modules write English, as the AI
 * manager and the tests read it; these find the catalogue's words for that English (an exact sentence, else a pattern with its number and noun) and
 * leave a sentence they do not know as written.
 */
import { fillWords } from "./admin-fill";
import type { NotificationsMessages } from "./admin-messages/notifications.en";

/**
 * A refusal of `orderRuleInput` (English, as the server writes it) in the person's language: an exact sentence from the catalogue, else one of the
 * patterns with its number and noun, else as written.
 */
export function ruleProblemText(message: string, w: NotificationsMessages["rules"]): string {
  if (w.schema[message]) return w.schema[message];
  const p = w.schemaPatterns;
  let m = /^Choose at least one (\w+)\.$/.exec(message);
  if (m) return fillWords(p.chooseOne, { what: p.whats[m[1]] ?? m[1] });
  m = /^Choose at most (\d+) (\w+)s\.$/.exec(message);
  if (m) return fillWords(p.chooseAtMost, { max: m[1], what: p.whatsMany[m[2]] ?? m[2] });
  m = /^At most (\d+) characters\.$/.exec(message);
  if (m) return fillWords(p.atMostChars, { max: m[1] });
  m = /^A rule has at most (\d+) conditions\.$/.exec(message);
  if (m) return fillWords(p.atMostConditions, { max: m[1] });
  m = /^A rule has at most (\d+) actions\.$/.exec(message);
  if (m) return fillWords(p.atMostActions, { max: m[1] });
  return message;
}

/** What `saveRule()`, `orderRules()` and the rules' actions answer, in the person's language. */
export function ruleAnswerText(message: string, w: NotificationsMessages["rules"]): string {
  const a = w.answers;
  const exact: Record<string, string> = {
    "Choose products of this store.": a.ownProducts,
    "Choose countries the store sells to.": a.ownCountries,
    "This rule no longer exists.": a.gone,
    "The order could not be read. Load the page again.": a.unreadable,
    "The rules changed while you were ordering them. Load the page again.": a.changed,
    "Check the rule and try again.": w.editor.check,
  };
  if (exact[message]) return exact[message];
  const m = /^A store has at most (\d+) automation rules\.$/.exec(message);
  if (m) return fillWords(a.limit, { n: m[1] });
  return ruleProblemText(message, w);
}
