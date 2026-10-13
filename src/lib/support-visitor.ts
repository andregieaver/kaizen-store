import type { ChatAction, ChatProduct } from "./chat";
import { POLL_VISITOR_MS, type ConversationStatus, type Handler, type MessageAuthor, type SupportMode } from "./support-rules";

/**
 * The visitor's side of a support conversation (D216, `docs/support.md` 5.1 and 5.3), pure and free of zod: the widget imports it
 * (D211). The conversation lives in the database; the tab keeps only a reference to it and a copy of what it has shown
 * (`kaizen_chat`, version 2), so a reload draws at once and then asks for what is new.
 */

/** A conversation as the visitor's tab knows it: its id and the token only this tab was given. */
export type ConversationRef = { id: string; token: string };

/** The authors a visitor sees (never a note or the partner's help). */
export type VisitorAuthor = Extract<MessageAuthor, "customer" | "ai" | "agent" | "system">;

/**
 * A link the AI's tools gave (D216, 2.1, step 9): a parcel's tracking page, an invoice or credit note, an order, a return, the withdrawal
 * page, a subscription, the subscription boxes, the bonus page, or (Kaizen's desk, step 11) an admin page. Drawn by the widget as a chip in the site's words for its `kind`, with
 * `label` (a number) put in; the address is made by code and passed `isSafeAddress()`, never written by the model.
 */
export const CHIP_KINDS = ["order", "tracking", "invoice", "credit_note", "return", "withdraw", "booking", "subscription", "boxes", "bonus", "page"] as const;
export type ChipKind = (typeof CHIP_KINDS)[number];
export type SupportChip = { kind: ChipKind; label: string; href: string };

/** A card the AI asked the widget to show under its answer (step 9): the sign-in card or the email card. */
export type SupportCard = "sign_in" | "email";

/** At most this many chips under one answer. */
export const CHIPS_MAX = 8;

/** What a message from the AI carries for the widget to draw: product cards, the page it opened, link chips and a card. Drawn by code, never from model text. */
/** `translated`: a person's message the AI translated into the customer's language, which the agent read and sent (step 13). */
export type VisitorMessageData = { products?: ChatProduct[]; actions?: ChatAction[]; chips?: SupportChip[]; card?: SupportCard; translated?: boolean };

/** A proposal or request the AI's message carries (step 10): the summary written by code, and where it stands. */
export type VisitorAction = { id: string; summary: string; status: "proposed" | "done" | "declined" | "failed" | "expired"; confirmer: "customer" | "staff" };

export type VisitorMessage = {
  seq: number;
  author: VisitorAuthor;
  body: string;
  /** A system line's kind (`ended`, `reopened`, `queued`, `joined`, `left`, `assistant_back`). */
  kind?: string;
  data?: VisitorMessageData;
  /** The AI's proposal for the customer to confirm, or its request to the staff (step 10). */
  action?: VisitorAction;
  /** ISO time. */
  at: string;
};

export type VisitorState = {
  status: ConversationStatus;
  handler: Handler;
  mode: SupportMode;
  /** The person answering, once one has joined (step 4). */
  agent: { name: string; picture: string | null } | null;
  /** The visitor's place in line while waiting. */
  queue: { position: number } | null;
  /** Whether someone can answer now: someone online inside the desk's hours (always true unless waiting). */
  available: boolean;
  /** Emails the desk may still send to this conversation. */
  emailLeft: number;
  signedIn: boolean;
  emailFollowup: boolean;
  /** Where answers will be emailed (the email the visitor left, or a signed-in customer's own), when the desk takes email. */
  followupEmail: string | null;
  /** The visitor's answer to "Did we help?" once the conversation ended (step 7). */
  rating: "good" | "bad" | null;
  /** The conversation's realtime topic (`sc:{key}`, step 12) while it waits for or is with a person; null otherwise. */
  channel: string | null;
};

/** What every visitor route answers with. `token` only when the conversation was just made (or started anew). */
export type VisitorReply = {
  conversation?: { id: string; token?: string; channel: string };
  state: VisitorState;
  messages: VisitorMessage[];
  /** A sentence for the visitor when the answer could not be given (the message was kept). */
  error?: string;
};

// The tab's copy -----------------------------------------------------------------------------------------------------------------

export const STORAGE_KEY = "kaizen_chat";
export const STORAGE_VERSION = 2;
/** The messages a tab keeps a copy of. */
export const STORED_MESSAGES = 40;

export type StoredConversation = {
  v: typeof STORAGE_VERSION;
  /** The site the conversation was held on (`{store}/{market}`, empty for Kaizen's). */
  site: string;
  conversation: ConversationRef | null;
  lastSeq: number;
  status: ConversationStatus;
  messages: VisitorMessage[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{20,100}$/;

/** The tab's copy for this site, or an empty one: an old version (v1 held the whole conversation), another site's or a broken value is dropped. */
export function readStored(raw: string | null, site: string): StoredConversation {
  const empty: StoredConversation = { v: STORAGE_VERSION, site, conversation: null, lastSeq: 0, status: "open", messages: [] };
  if (!raw) return empty;
  try {
    const value = JSON.parse(raw) as Partial<StoredConversation> | null;
    if (!value || value.v !== STORAGE_VERSION || value.site !== site) return empty;
    const ref = value.conversation;
    const conversation = ref && typeof ref.id === "string" && UUID.test(ref.id) && typeof ref.token === "string" && TOKEN.test(ref.token) ? { id: ref.id, token: ref.token } : null;
    if (!conversation) return empty;
    const messages = Array.isArray(value.messages) ? value.messages.filter(isMessage).slice(-STORED_MESSAGES) : [];
    const lastSeq = Number.isInteger(value.lastSeq) && (value.lastSeq as number) >= 0 ? (value.lastSeq as number) : 0;
    return { v: STORAGE_VERSION, site, conversation, lastSeq, status: value.status === "ended" ? "ended" : "open", messages };
  } catch {
    return empty;
  }
}

function isMessage(value: unknown): value is VisitorMessage {
  if (!value || typeof value !== "object") return false;
  const m = value as Record<string, unknown>;
  return Number.isInteger(m.seq) && typeof m.body === "string" && typeof m.at === "string" && ["customer", "ai", "agent", "system"].includes(String(m.author));
}

/** What the tab writes back: the last messages only. */
export function storedValue(stored: StoredConversation): string {
  return JSON.stringify({ ...stored, messages: stored.messages.slice(-STORED_MESSAGES) });
}

/** Messages merged by number: what is new is added in order, what the tab had is kept, nothing twice. */
export function mergeMessages(current: VisitorMessage[], incoming: VisitorMessage[]): VisitorMessage[] {
  const bySeq = new Map(current.map((m) => [m.seq, m]));
  for (const m of incoming) bySeq.set(m.seq, m);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/** The highest number the tab has seen. */
export const lastSeqOf = (messages: VisitorMessage[], before = 0) => messages.reduce((max, m) => Math.max(max, m.seq), before);

/** How long the widget waits before asking for what is new (when it polls at all): sooner while waiting for or with a person. */
export function pollDelay(state: Pick<VisitorState, "status" | "handler">, hidden: boolean): number | null {
  if (state.status !== "open") return null;
  if (hidden) return POLL_VISITOR_MS.hidden;
  return state.handler === "ai" ? POLL_VISITOR_MS.ai : POLL_VISITOR_MS.waiting;
}
