import { formatTemplate } from "./icu-lite";

/**
 * The interface text as a catalogue (D111): every text and every message that
 * takes arguments, in English, as a key and a template, so a language that has
 * no hand-written text can be translated by AI, stored as data and read back
 * as the same `Messages` the storefront uses. The hand-written languages
 * (nb, sv, da, en) stay code; the catalogue is derived from English, so a new
 * text added there is found here at once. Pure and shared with the browser.
 */

export type Namespace = "ui" | "email";

export type CatalogEntry = {
  /** `ui:cart.title` or `email:orderSubject`: the namespace and the path in the messages. */
  key: string;
  namespace: Namespace;
  /** Plain text, or a template (`{0}`, plural and select: `src/lib/icu-lite.ts`) for what takes arguments. */
  kind: "text" | "template";
  source: string;
  /** For a template: how many arguments the English function takes, for the model's benefit. */
  arity: number;
};

type Fn = (...args: unknown[]) => unknown;

/**
 * Messages whose English is chosen by their arguments (a plural, a yes or no,
 * an empty name), written as templates. `prepare` turns the function's
 * arguments into the template's when they are not the same, as when a
 * number of days is shown as years. Every other function's template is its
 * own text with its arguments in place (`{0}`, `{1}`).
 */
const plural = (one: string, other: string, n = "0") => `{${n}, plural, one {${one}} other {${other}}}`;
const stay = (yes: string, no: string, n = "0") => `{${n}, select, true {${yes}} other {${no}}}`;

export const CHOOSING: Record<string, { template: string; prepare?: (args: unknown[]) => unknown[] }> = {
  "ui:deliveries.leftOutLine": { template: "{2, plural, =0 {{0}: sold out} other {{0}: {2} of {1}}}" },
  "email:deliveries.leftOutLine": { template: "{2, plural, =0 {{0}: sold out} other {{0}: {2} of {1}}}" },
  "ui:companyAccount.sent": { template: plural("# invitation sent.", "# invitations sent.") },
  "ui:companyAccount.resent": { template: plural("# invitation sent again.", "# invitations sent again.") },
  "ui:companyAccount.alreadyMember": { template: plural("# is already in the company.", "# are already in the company.") },
  "ui:days": {
    template: "{0, select, y {{1, plural, one {# year} other {# years}}} other {{1, plural, one {# day} other {# days}}}}",
    prepare: ([n]) => ((n as number) % 365 === 0 ? ["y", (n as number) / 365] : ["d", n]),
  },
  "ui:downloadsLeft": { template: plural("# download left", "# downloads left") },
  "ui:bonus.dayCount": { template: plural("# day", "# days") },
  "ui:bonus.monthCount": { template: plural("# month", "# months") },
  "ui:planEvery": {
    template:
      "{0, select, week {{1, plural, one {Every week} other {Every # weeks}}} month {{1, plural, one {Every month} other {Every # months}}} other {{1, plural, one {Every year} other {Every # years}}}}",
    prepare: ([interval, n]) => [interval === "week" ? "week" : interval === "month" ? "month" : "year", n],
  },
  "ui:search.results": { template: "{0, plural, one {# result for “{1}”} other {# results for “{1}”}}" },
  "ui:listing.count": { template: plural("# product", "# products") },
  "ui:wishlist.added": { template: plural("# item added to your cart.", "# items added to your cart.") },
  "ui:wishlist.moved": { template: "{0, plural, one {# item moved to {1}.} other {# items moved to {1}.}}" },
  "ui:account.hello": { template: "{1, select, named {Hello, {0}!} other {Hello!}}", prepare: ([name]) => [name, name ? "named" : "anon"] },
  "ui:account.items": { template: plural("# item", "# items") },
  "ui:booking.freeCancel": {
    template: "{0, plural, =0 {Cancel or change for free until it starts.} one {Cancel or change for free until # hour before.} other {Cancel or change for free until # hours before.}}",
  },
  "ui:stay.nights": { template: plural("# night", "# nights") },
  "ui:stay.days": { template: plural("# day", "# days") },
  "ui:stay.hours": { template: plural("# hour", "# hours") },
  "ui:stay.perBooking": { template: stay("per stay", "per rental") },
  "ui:stay.feeIncluded": { template: stay("Final cleaning included.", "Fee included.") },
  "ui:stay.perNight": { template: stay("per night", "per day") },
  "ui:stay.tooShort": {
    template: "{1, select, true {{0, plural, one {At least # night.} other {At least # nights.}}} other {{0, plural, one {At least # day.} other {At least # days.}}}}",
  },
  "ui:stay.tooLong": {
    template: "{1, select, true {{0, plural, one {At most # night.} other {At most # nights.}}} other {{0, plural, one {At most # day.} other {At most # days.}}}}",
  },
  "ui:stay.times": { template: "{2, select, true {Check-in from {0}, check-out by {1}.} other {Pick up from {0}, return by {1}.}}" },
  "ui:stay.freeCancel": {
    template:
      "{0, plural, =0 {Cancel for free until it starts.} one {{1, select, true {Cancel for free until # hour before check-in.} other {Cancel for free until # hour before pick-up.}}} other {{1, select, true {Cancel for free until # hours before check-in.} other {Cancel for free until # hours before pick-up.}}}}",
  },
  "ui:stay.noWithdrawal": { template: stay("Accommodation on set dates has no right of withdrawal.", "Rentals on set dates have no right of withdrawal.") },
  "email:tracking": { template: "Tracking: {0} {1}" },
  "email:bookingCancelledByYouIntro": {
    template: "You have cancelled {0} on {1}.{3, select, yes { We are paying back {2}; it usually takes 5–10 working days.} other {}}",
    prepare: ([service, when, refund]) => [service, when, refund ?? "", refund ? "yes" : "no"],
  },
};

/**
 * Texts that are never machine-translated, whatever language the store offers: the keys that start with one of these are left out of
 * the catalogue and an overlay never replaces them. They state a delivery time to a consumer before and after a purchase (wave 3, D172:
 * `m.backorder.*`, Directive 2011/83/EU Art. 6(1)(g)), so they are written by hand in nb, sv, da and en and flagged for review in
 * `src/lib/i18n.ts`; any other language shows the English sentence, never an unreviewed translation of it. A text of this kind is
 * added here, not left to the generator (`ui-catalog.test.ts` holds the list).
 */
export const HAND_WRITTEN_ONLY: readonly string[] = ["ui:backorder.", "email:backorder."];

export const isHandWrittenOnly = (key: string): boolean => HAND_WRITTEN_ONLY.some((prefix) => key.startsWith(prefix));

/** A short fingerprint of an English text, kept with its translation so a changed original is noticed. */
export function sourceHash(source: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) {
    h ^= source.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function walk(node: unknown, path: string[], visit: (path: string[], leaf: string | Fn) => void) {
  if (typeof node === "string" || typeof node === "function") visit(path, node as string | Fn);
  else if (Array.isArray(node)) node.forEach((value, i) => walk(value, [...path, String(i)], visit));
  else if (node && typeof node === "object") for (const [key, value] of Object.entries(node)) walk(value, [...path, key], visit);
}

/** The template a message with arguments has in English. */
function templateOf(key: string, fn: Fn): string {
  const chosen = CHOOSING[key];
  if (chosen) return chosen.template;
  return String(fn(...Array.from({ length: fn.length }, (_, i) => `{${i}}`)));
}

/**
 * The catalogue of one namespace's English messages, in the order they are
 * written. `english` is the messages object (`t("en")`, `emailText("en")`).
 */
export function catalogOf(namespace: Namespace, english: unknown): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  walk(english, [], (path, leaf) => {
    const key = `${namespace}:${path.join(".")}`;
    if (isHandWrittenOnly(key)) return;
    // An empty text has nothing to translate.
    if (typeof leaf === "string") {
      if (leaf.trim() !== "") entries.push({ key, namespace, kind: "text", source: leaf, arity: 0 });
    } else entries.push({ key, namespace, kind: "template", source: templateOf(key, leaf), arity: leaf.length });
  });
  return entries;
}

/**
 * The messages with the texts a language has: each text or template it has
 * replaces the English one (a template becomes a function of the same
 * arguments), and what it lacks stays English, key by key.
 */
export function overlayMessages<T>(namespace: Namespace, english: T, texts: ReadonlyMap<string, string> | Record<string, string>, locale: string): T {
  const get = (key: string) => (texts instanceof Map ? texts.get(key) : (texts as Record<string, string>)[key]);
  const build = (node: unknown, path: string[]): unknown => {
    if (typeof node === "string" || typeof node === "function") {
      const key = `${namespace}:${path.join(".")}`;
      const text = isHandWrittenOnly(key) ? undefined : get(key);
      if (text === undefined) return node;
      if (typeof node === "string") return text;
      const chosen = CHOOSING[key];
      return (...args: unknown[]) => formatTemplate(text, chosen?.prepare ? chosen.prepare(args) : args, locale);
    }
    if (Array.isArray(node)) return node.map((value, i) => build(value, [...path, String(i)]));
    if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, build(v, [...path, k])]));
    return node;
  };
  return build(english, []) as T;
}

/** The English message with `key`'s arguments applied to its template: what a translation is compared with. */
export function englishTemplate(entries: readonly CatalogEntry[], key: string): string | undefined {
  return entries.find((e) => e.key === key)?.source;
}

/** Runs a function-valued message from a template the way the storefront does, for tests and previews. */
export function runTemplate(key: string, template: string, args: unknown[], locale: string): string {
  const chosen = CHOOSING[key];
  return formatTemplate(template, chosen?.prepare ? chosen.prepare(args) : args, locale);
}
