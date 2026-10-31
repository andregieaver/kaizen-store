import "server-only";

import type { SupportMode } from "@/lib/support-rules";
import { KAIZEN_TOPICS, STORE_TOPICS } from "@/lib/support-summary";
import { TONE_BANDS, type ToneBand } from "@/lib/support-tone";

import { aiFor } from "./ai";
import { INBOX_TABS, conversationChannel, deskChannels, deskSettings, lastToneAlert, markRead, presence, mineUnreadCount, staffConversation, staffList, waitingCount, type InboxRow, type InboxTab, type StaffConversation } from "./support";
import { memberCan } from "./permissions";
import { deskAgents } from "./support-agent";
import type { StaffDesk } from "./support-desk";

/**
 * What the inbox's feed routes answer (D216, `docs/support.md` 5.4), at every level: the list of the desks the person may read, and
 * one conversation after the message the page last saw. Polled every 3 and 2 seconds (`POLL_STAFF_MS`); never cached. The routes
 * only check who may read the desk and pass it here.
 */

export const NO_STORE = { "Cache-Control": "no-store" } as const;

/** The list, how many wait for a person, and how many of the person's own conversations have a customer message they have not read (the alerts, 2.9). */
export type InboxFeed = {
  rows: InboxRow[];
  waiting: number;
  mineUnread: number;
  /** When a tone alert was last raised (2.6): the inbox notifies when it moves. */
  lastToneAlert: string | null;
  /** The desks' realtime topics (`sd:{key}`, 4.6, step 12), handed out only to people who may read them. */
  channels: string[];
};

/** The list's filters from the address: the tab (waiting by default), the words searched and, at the owner's level, the store. */
export function inboxQuery(search: URLSearchParams): { tab: InboxTab; q?: string; store?: string; tone?: ToneBand; topic?: string } {
  const tab = search.get("tab");
  const tone = search.get("tone");
  const q = search.get("q")?.trim().slice(0, 100);
  const store = search.get("store")?.trim();
  return {
    tab: (INBOX_TABS as readonly string[]).includes(tab ?? "") ? (tab as InboxTab) : "waiting",
    ...(q ? { q } : {}),
    ...(store && /^[a-z0-9-]{1,63}$/.test(store) ? { store } : {}),
    ...((TONE_BANDS as readonly string[]).includes(tone ?? "") ? { tone: tone as ToneBand } : {}),
    // Any topic of either desk kind's closed list; the list's own condition finds nothing for the other kind's.
    ...(([...STORE_TOPICS, ...KAIZEN_TOPICS] as string[]).includes(search.get("topic") ?? "") ? { topic: search.get("topic")! } : {}),
  };
}

/** The list of the desks (one, or the owner's several, of which `store` narrows to one by its slug). */
export async function inboxFeed(desks: StaffDesk[], query: ReturnType<typeof inboxQuery>): Promise<InboxFeed> {
  const shown = query.store ? desks.filter((d) => d.store?.slug === query.store) : desks;
  const account = desks[0]?.account.id;
  if (!account || shown.length === 0) return { rows: [], waiting: 0, mineUnread: 0, lastToneAlert: null, channels: [] };
  const plain = shown.map((d) => d.desk);
  const [rows, waiting, mineUnread, toneAlert, channels] = await Promise.all([
    staffList(plain, account, { tab: query.tab, q: query.q, tone: query.tone, topic: query.topic }),
    waitingCount(plain),
    mineUnreadCount(plain, account),
    lastToneAlert(plain),
    deskChannels(plain),
  ]);
  return { rows, waiting, mineUnread, lastToneAlert: toneAlert, channels };
}

/**
 * What the inbox opens on: Waiting while someone waits for a person, else All open, so a desk whose AI answers first shows the
 * conversations it is having rather than "Nobody is waiting" with them a tab away.
 */
export async function openingInbox(desks: StaffDesk[]): Promise<{ feed: InboxFeed; tab: "waiting" | "open" }> {
  const waiting = await inboxFeed(desks, { tab: "waiting" });
  if (waiting.waiting > 0) return { feed: waiting, tab: "waiting" };
  return { feed: await inboxFeed(desks, { tab: "open" }), tab: "open" };
}

/** A conversation as the inbox draws it: the conversation, who is looking (to know whether it is theirs), what they may do and to whom it can be handed. */
export type ConversationFeed = StaffConversation & {
  me: string;
  canWrite: boolean;
  /** The desk's mode: with support off nobody takes over (the chat assistant answers alone). */
  mode: SupportMode;
  agents: { id: string; name: string; online: boolean }[];
  /** The silent partner here (step 8): whether the desk offers it (support on, its switch, a text model), and the person's own switch. */
  partner: { available: boolean; mine: boolean };
  /** The conversation's realtime topic (`sc:{key}`, step 12). */
  channel: string;
  /** Whether the person may have messages and replies translated by AI (step 13): they may answer, and the desk has a text model. */
  translate: boolean;
};

/** One conversation for staff after `after`; looking at it counts as read up to its last message. */
export async function conversationFeed(desk: StaffDesk, id: string, after: number): Promise<ConversationFeed | null> {
  const conversation = await staffConversation(desk.desk, id, after);
  if (!conversation) return null;
  const [, agents, settings, mine, connection, channel] = await Promise.all([
    markRead(desk.desk, id, desk.account.id, conversation.messageSeq),
    deskAgents(desk),
    deskSettings(desk.desk),
    presence(desk.desk, desk.account.id),
    aiFor(desk.desk.storeId),
    conversationChannel(desk.desk, id),
  ]);
  const mode = settings?.mode ?? "off";
  // A form's message is read by people only (D382): no partner and no translation by AI.
  const form = conversation.source === "form";
  return {
    ...conversation,
    // The customer with the address it was written from, only for people who may read customers.
    addressCustomer: desk.holder && memberCan(desk.holder, "customers:read") ? conversation.addressCustomer : null,
    me: desk.account.id,
    canWrite: desk.canWrite,
    mode,
    agents: agents.filter((a) => a.id !== desk.account.id),
    partner: { available: !form && desk.canWrite && mode !== "off" && Boolean(settings?.partner) && Boolean(connection?.textModel), mine: mine.partner },
    channel,
    translate: !form && desk.canWrite && Boolean(connection?.textModel),
  };
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The number after which a conversation's messages are wanted, from the address (0 for all). */
export const afterOf = (search: URLSearchParams) => {
  const n = Number(search.get("after") ?? 0);
  return Number.isInteger(n) && n >= 0 && n <= 1_000_000 ? n : 0;
};
