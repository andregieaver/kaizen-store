import "server-only";

import { INBOX_TABS, markRead, staffConversation, staffList, waitingCount, type InboxRow, type InboxTab, type StaffConversation } from "./support";
import type { StaffDesk } from "./support-desk";

/**
 * What the inbox's feed routes answer (D216, `docs/support.md` 5.4), at every level: the list of the desks the person may read, and
 * one conversation after the message the page last saw. Polled every 3 and 2 seconds (`POLL_STAFF_MS`); never cached. The routes
 * only check who may read the desk and pass it here.
 */

export const NO_STORE = { "Cache-Control": "no-store" } as const;

export type InboxFeed = { rows: InboxRow[]; waiting: number };

/** The list's filters from the address: the tab (waiting by default), the words searched and, at the owner's level, the store. */
export function inboxQuery(search: URLSearchParams): { tab: InboxTab; q?: string; store?: string } {
  const tab = search.get("tab");
  const q = search.get("q")?.trim().slice(0, 100);
  const store = search.get("store")?.trim();
  return {
    tab: (INBOX_TABS as readonly string[]).includes(tab ?? "") ? (tab as InboxTab) : "waiting",
    ...(q ? { q } : {}),
    ...(store && /^[a-z0-9-]{1,63}$/.test(store) ? { store } : {}),
  };
}

/** The list of the desks (one, or the owner's several, of which `store` narrows to one by its slug). */
export async function inboxFeed(desks: StaffDesk[], query: ReturnType<typeof inboxQuery>): Promise<InboxFeed> {
  const shown = query.store ? desks.filter((d) => d.store?.slug === query.store) : desks;
  const account = desks[0]?.account.id;
  if (!account || shown.length === 0) return { rows: [], waiting: 0 };
  const plain = shown.map((d) => d.desk);
  const [rows, waiting] = await Promise.all([staffList(plain, account, { tab: query.tab, q: query.q }), waitingCount(plain)]);
  return { rows, waiting };
}

/** One conversation for staff after `after`; looking at it counts as read up to its last message. */
export async function conversationFeed(desk: StaffDesk, id: string, after: number): Promise<StaffConversation | null> {
  const conversation = await staffConversation(desk.desk, id, after);
  if (conversation) await markRead(desk.desk, id, desk.account.id, conversation.messageSeq);
  return conversation;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The number after which a conversation's messages are wanted, from the address (0 for all). */
export const afterOf = (search: URLSearchParams) => {
  const n = Number(search.get("after") ?? 0);
  return Number.isInteger(n) && n >= 0 && n <= 1_000_000 ? n : 0;
};
