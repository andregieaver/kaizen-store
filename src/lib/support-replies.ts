/**
 * Saved replies (D216, `docs/support.md` 2.4, step 13): a desk's texts that a person puts in the composer with `/`, filled in for the
 * conversation. Pure, shared with the browser (no zod: the schema is `support-replies-schema.ts`).
 */

export const REPLY_TITLE_MAX = 80;
export const REPLY_BODY_MAX = 2000;
export const REPLY_SHORTCUT_MAX = 20;
/** A desk's saved replies at most. */
export const REPLIES_MAX = 200;
/** How many the `/` picker shows at once. */
export const PICKER_MAX = 8;

/** A shortcut: lower-case letters, digits and dashes, typed after `/`. */
export const SHORTCUT = /^[a-z0-9][a-z0-9-]{0,19}$/;

/** The placeholders a reply may hold, and what each stands for. */
export const PLACEHOLDERS = {
  customer_first_name: "The customer's first name, when it is known",
  agent_first_name: "Your name as customers see it",
  store: "The store's name (Kaizen on Kaizen's desk)",
} as const;
export type Placeholder = keyof typeof PLACEHOLDERS;

export type PlaceholderFacts = { customerFirstName: string | null; agentFirstName: string | null; store: string | null };

export type SavedReply = { id: string; title: string; body: string; shortcut: string; locale: string | null };

/** A name's first word, or null. */
export function firstName(name: string | null | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  // An email address is no name: "Hi {customer_first_name}" never greets someone by their address.
  return first && !first.includes("@") ? first.slice(0, 40) : null;
}

/**
 * The reply with its placeholders filled in. A placeholder whose value is not known is left out with the space before it, and a
 * comma or full stop it leaves alone at the start goes too ("Hi {customer_first_name}," becomes "Hi,"); anything else in braces
 * stays as it was written.
 */
export function fillPlaceholders(body: string, facts: PlaceholderFacts): string {
  const values: Record<Placeholder, string | null> = { customer_first_name: facts.customerFirstName, agent_first_name: facts.agentFirstName, store: facts.store };
  const GONE = "\u0000";
  return body
    .replaceAll(GONE, "")
    .replace(/([ \t]*)\{(customer_first_name|agent_first_name|store)\}/g, (_, space: string, name: Placeholder) => {
      const value = values[name]?.trim();
      return value ? `${space}${value}` : GONE;
    })
    .split("\n")
    .map((line) => (line.includes(GONE) ? line.replace(/^[ \t]*\u0000[ \t]*[,.;:]?[ \t]*/, "").replaceAll(GONE, "").replace(/[ \t]+$/, "") : line))
    .join("\n");
}

/** The placeholders a text names that are not ours (a typo the page warns about). */
export function unknownPlaceholders(body: string): string[] {
  const names = [...body.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]);
  return [...new Set(names.filter((name) => !(name in PLACEHOLDERS)))];
}

/**
 * What the composer's `/` is asking for: the word after a `/` at the start of the text or of a line, up to the cursor, or null when
 * the cursor is not in one.
 */
export function slashQuery(text: string, cursor: number): { query: string; start: number } | null {
  const before = text.slice(0, cursor);
  const match = /(?:^|\n)\/([a-z0-9-]{0,20})$/i.exec(before);
  if (!match) return null;
  return { query: match[1].toLowerCase(), start: cursor - match[1].length - 1 };
}

/** A locale's language ("nb" of "nb-NO"), so a reply for Norwegian is offered in every Norwegian conversation. */
export const languageOf = (locale: string) => locale.split("-")[0].toLowerCase();

/**
 * The replies the picker offers for what was typed after `/`: a shortcut that starts with it first, then a title with a word that
 * does; a reply in the conversation's language before one for any language, and one written for another language last.
 */
export function matchReplies<T extends Pick<SavedReply, "title" | "shortcut" | "locale">>(replies: readonly T[], query: string, locale: string | null): T[] {
  const q = query.trim().toLowerCase();
  const rank = (reply: T): number | null => {
    const byShortcut = reply.shortcut.startsWith(q);
    const byTitle = reply.title.toLowerCase().split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(q));
    if (q && !byShortcut && !byTitle) return null;
    const language = reply.locale === null ? 1 : locale && languageOf(reply.locale) === languageOf(locale) ? 0 : 2;
    return (byShortcut ? 0 : 10) + language;
  };
  return replies
    .map((reply) => ({ reply, rank: rank(reply) }))
    .filter((r): r is { reply: T; rank: number } => r.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.reply.shortcut.localeCompare(b.reply.shortcut))
    .slice(0, PICKER_MAX)
    .map((r) => r.reply);
}

/** The composer's text with the `/word` replaced by the reply, and where the cursor goes after it. */
export function insertReply(text: string, slash: { query: string; start: number }, body: string): { text: string; cursor: number } {
  const end = slash.start + 1 + slash.query.length;
  return { text: text.slice(0, slash.start) + body + text.slice(end), cursor: slash.start + body.length };
}

/** A shortcut suggested from a title: its words in lower case joined by dashes. */
export function shortcutFrom(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[æ]/g, "ae")
    .replace(/[ø]/g, "o")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, REPLY_SHORTCUT_MAX)
    .replace(/-+$/, "");
}
