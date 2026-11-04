/**
 * The docs guide (wave 14 unit E5, D444), the shapes its parts share: the server, the docs' panel (which loads only when a reader opens it)
 * and the admin. Pure and without zod, so the panel's few kilobytes stay its own; the checks of what is sent are `docs-guide-schema.ts`, the
 * guide's rules and tools `docs-guide.ts`, the conversations `src/server/docs-guide-store.ts`.
 */

/** Where the panel asks: the guide's profile (GET) and a reader's message (POST). The same on every host, as every `/api` is. */
export const DOCS_GUIDE_ENDPOINT = "/api/docs/guide";

/** The tab's copy of its conversation with the guide (sessionStorage, necessary: the conversation is the docs', D216 as the chat's). */
export const DOCS_GUIDE_STORAGE_KEY = "kaizen_docs_guide";

/** The longest message a reader may send. */
export const GUIDE_MESSAGE_MAX = 1000;
/** The longest answer kept. */
export const GUIDE_ANSWER_MAX = 4000;
/** Messages the model is given of a conversation, the newest. */
export const GUIDE_HISTORY = 20;
/** Messages a conversation may hold; past it the reader starts a new one. */
export const GUIDE_CONVERSATION_MAX = 200;
/** Links under one answer, at most. */
export const GUIDE_LINKS_MAX = 5;

/** The docs' languages the guide answers in. */
export const GUIDE_LANGS = ["en", "nb"] as const;
export type GuideLang = (typeof GUIDE_LANGS)[number];
export const isGuideLang = (value: unknown): value is GuideLang => value === "en" || value === "nb";

/** A page of the docs an answer used, drawn as a link under it by code (never written by the model). */
export type GuideLink = { title: string; href: string };

/** A page the guide opened for the reader: a docs page, or (signed in) an admin page. */
export type GuideAction = { type: "navigate"; href: string; label: string };

/**
 * Kaizena Flow's support, offered when the docs do not cover a question (the guide's hand-over, as the platform chat's `handoff_to_human`
 * hands to a person): the admin's *Kaizena Flow support* for a store's owner or staff, and the platform's own email address when it has one.
 */
export type GuideSupport = { admin: string; email: string | null };

/** What the guide's answer carries besides its words, kept in the message's `data`. */
export type GuideMessageData = { links?: GuideLink[]; action?: GuideAction; support?: GuideSupport; prompt?: string };

/** A message as the reader's panel draws it. */
export type GuideMessage = {
  seq: number;
  author: "reader" | "ai";
  body: string;
  at: string;
  links?: GuideLink[];
  action?: GuideAction;
  support?: GuideSupport;
};

/** The tab's reference to its conversation: its id and the token only the tab holds. */
export type GuideConversationRef = { id: string; token: string };

/**
 * The guide as the docs' panel shows it (`ChatWidgetProfile`'s shape, D81 and D391): who answers, how it greets, how long the conversation
 * is kept, and what an AI does with the reader's messages besides answering (nothing: `aiUse` says so in the notice).
 */
export type GuideProfile = {
  /** Whether it answers now: switched on, and the platform's AI has a text model. */
  on: boolean;
  name: string;
  occupation: string;
  avatar: { url: string; width: number; height: number } | null;
  avatarStyle: unknown;
  /** Its greeting in the docs' language, or "" for the built-in one. */
  greeting: string;
  keptDays: number;
  aiUse: { tone: boolean; summaries: boolean };
};

/** What a turn answers: the conversation (its token only when it was made), the messages after the one the tab last saw, and a refusal. */
export type GuideTurnAnswer = {
  conversation: { id: string; token?: string };
  messages: GuideMessage[];
  /** A token, key or password was taken out of the reader's message before it was kept or sent to the AI. */
  removedSecret?: boolean;
};

/** What stands where a secret was taken out of a reader's message (and out of an answer, should one ever repeat it). */
export const SECRET_MARK = "•••";

/**
 * Secrets as they are typed: Kaizena Flow's tokens (`kf_`, a storefront's `kfs_`, OAuth's `kfa_` and `kfr_`), payment and AI providers' keys,
 * webhook secrets, GitHub and AWS keys, a bearer header, a JSON web token, and a password written after its name. What it matches is taken
 * out wherever it stands; the words around it stay.
 */
const SECRETS: RegExp[] = [
  /\bkf[sar]?_[A-Za-z0-9_-]{8,}/g,
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{6,}/g,
  /\bwhsec_[A-Za-z0-9+/=]{8,}/g,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g,
];
/** A credential after `Bearer` or `Basic`: long and with a digit, so "Bearer authentication" stays words. */
const BEARER = /\b(Bearer|Basic)\s+(?=[A-Za-z0-9._~+/=-]*\d)[A-Za-z0-9._~+/=-]{16,}/gi;
/** A password after its name and `:` or `=`, or after "is" or "er" when it holds a digit (so "the password is required" is left alone). */
const PASSWORD = /\b(password|passord|passwd|pwd|passcode)(\s*[:=]\s*|\s+(?:is|er)\s+(?=\S*\d))(\S{3,})/gi;

/**
 * A text with every secret taken out (`SECRET_MARK` in its place), and whether one was: the guide never keeps, sends on or repeats a token,
 * a key or a password (D444). Applied to a reader's message before it is kept or reaches the AI, and to the AI's answer before it is shown.
 */
export function withoutSecrets(text: string): { text: string; removed: boolean } {
  let removed = false;
  let out = text;
  for (const pattern of SECRETS) {
    out = out.replace(pattern, () => {
      removed = true;
      return SECRET_MARK;
    });
  }
  out = out.replace(BEARER, (_all, kind: string) => {
    removed = true;
    return `${kind} ${SECRET_MARK}`;
  });
  out = out.replace(PASSWORD, (all, name: string, between: string, value: string) => {
    if (value === SECRET_MARK) return all;
    removed = true;
    return `${name}${between}${SECRET_MARK}`;
  });
  return { text: out, removed };
}

/**
 * A verdict on Kaizena Flow (D444): a ranking, "cheapest", "the best", "better than", or what reviewers are said to agree on, in English
 * and Norwegian. The guide states what the docs say Kaizena Flow does and never weighs it against another platform; the prompt says so,
 * and since a model may still repeat a page's praise (the eval's guide-comparison case, where a page told it to), its answer is held to it
 * in code as well.
 */
const PLATFORMS = String.raw`(?:kaizena(?:\s+flow)?|shopify|woocommerce|wix|squarespace|bigcommerce|shopware|magento|prestashop|ecwid|webflow)`;
const VERDICTS: RegExp[] = [
  // "the cheapest platform", "the best e-commerce platform", "the leading store builder"
  /\b(?:cheapest|best|most affordable|least expensive|leading|top[- ]rated|number one)\s+(?:platform|e-?commerce|store builder|shop(?:ping)? platform)\b/i,
  // "the cheapest in Europe"
  /\b(?:cheapest|best|leading)\s+(?:in|of)\s+(?:europe|the eu|the world)\b/i,
  // "better than Shopify", "Kaizena Flow is cheaper than …"
  new RegExp(String.raw`\b(?:better|cheaper|faster|easier|superior)\s+(?:than|to)\s+${PLATFORMS}\b`, "i"),
  new RegExp(String.raw`\b${PLATFORMS}(?:'s)?\s+(?:is|are)\s+(?:much\s+|far\s+)?(?:better|cheaper|faster|easier|superior|the\s+(?:best|cheapest))\b`, "i"),
  /\breviewers?\s+(?:agree|say|said|rate|rank|call|praise)/i,
  /\b(?:billigste|beste|ledende)\s+(?:plattform(?:en)?|nettbutikkløsning(?:en)?)/i,
  /\b(?:billigste|beste|ledende)\s+i\s+(?:europa|eu|verden)\b/i,
  new RegExp(String.raw`\b(?:bedre|billigere|raskere|enklere)\s+enn\s+${PLATFORMS}\b`, "i"),
  /\banmeldere\s+(?:er enige|sier|mener|kaller)/i,
];

/**
 * A text with every sentence that makes such a verdict left out, and whether one was. Line breaks and every other sentence stay as written.
 */
export function withoutVerdicts(text: string): { text: string; removed: boolean } {
  let removed = false;
  const lines = text.split("\n").map((line) => {
    const sentences = line.split(/(?<=[.!?])\s+/);
    const kept = sentences.filter((sentence) => {
      const verdict = VERDICTS.some((pattern) => pattern.test(sentence));
      if (verdict) removed = true;
      return !verdict;
    });
    return kept.join(" ");
  });
  return { text: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(), removed };
}
