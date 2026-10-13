"use client";

import { useCallback, useEffect, useState } from "react";

import { TAB_WORDS } from "@/lib/support-inbox-text";
import { HEARTBEAT_SECONDS, POLL_STAFF_MS } from "@/lib/support-rules";
import type { InboxRow, InboxTab } from "@/server/support";
import type { ConversationFeed } from "@/server/support-inbox";

import { ConversationActions } from "./conversation-actions";
import { ConversationList } from "./conversation-list";
import { ConversationContext, ConversationView } from "./conversation-view";
import { conversationHref, runAct, type SupportDeskContext } from "./desk-context";

/**
 * The support inbox (D216, `docs/support.md` 2.4, 5.4), the same at every level: the list on the left, the conversation in the middle
 * and who it is with on the right, each scrolling on its own (on a phone the list and the conversation are separate views). It asks
 * for the list every 3 seconds and the open conversation's new messages every 2, slower in a hidden tab; nothing is cached.
 */
export function Inbox({
  context,
  initial,
  initialTab,
}: {
  context: SupportDeskContext;
  initial: { rows: InboxRow[]; waiting: number };
  initialTab: InboxTab;
}) {
  const [tab, setTab] = useState<InboxTab>(initialTab);
  const [query, setQuery] = useState("");
  const [store, setStore] = useState("");
  const [rows, setRows] = useState(initial.rows);
  const [waiting, setWaiting] = useState(initial.waiting);
  const [open, setOpen] = useState<{ id: string; store: string | null } | null>(null);
  const [conversation, setConversation] = useState<ConversationFeed | null>(null);
  // Bumped after an action, so the conversation and the list are asked for again at once.
  const [refresh, setRefresh] = useState(0);
  const [presence, setPresenceState] = useState(context.presence);
  const [now, setNow] = useState(() => new Date());
  const [gone, setGone] = useState(false);
  const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

  const loadList = useCallback(async () => {
    const params = new URLSearchParams({ tab });
    if (query.trim()) params.set("q", query.trim());
    if (store) params.set("store", store);
    try {
      const response = await fetch(`${context.feedUrl}?${params}`, { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as { rows: InboxRow[]; waiting: number };
      setRows(body.rows);
      setWaiting(body.waiting);
      setNow(new Date());
    } catch {
      // Offline for a moment: the next poll tries again.
    }
  }, [context.feedUrl, tab, query, store]);

  // The list: at once when the filters change, then every 3 seconds (15 in a hidden tab).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const tick = async () => {
      await loadList();
      if (!stopped) timer = setTimeout(tick, hidden() ? POLL_STAFF_MS.realtime : POLL_STAFF_MS.list);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [loadList]);

  // The open conversation: everything first, then what came after the last message seen, every 2 seconds.
  useEffect(() => {
    if (!open) return;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    let last = 0;
    const tick = async () => {
      try {
        const response = await fetch(conversationHref(context, open.id, open.store, last), { cache: "no-store" });
        if (response.status === 404) {
          setGone(true);
          return;
        }
        if (response.ok) {
          const fresh = (await response.json()) as ConversationFeed;
          setConversation((current) => {
            if (!current || current.id !== fresh.id) return fresh;
            const seen = new Set(current.messages.map((m) => m.seq));
            return { ...fresh, messages: [...current.messages, ...fresh.messages.filter((m) => !seen.has(m.seq))] };
          });
          last = Math.max(last, ...fresh.messages.map((m) => m.seq));
          setNow(new Date());
        }
      } catch {
        // The next poll tries again.
      }
      if (!stopped) timer = setTimeout(tick, hidden() ? POLL_STAFF_MS.realtime : POLL_STAFF_MS.conversation);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [context, open, refresh]);

  // The heartbeat keeps an online agent counted as online while the inbox is open.
  useEffect(() => {
    const beat = () => void context.actions.heartbeat().catch(() => undefined);
    beat();
    const timer = setInterval(beat, HEARTBEAT_SECONDS * 1000);
    return () => clearInterval(timer);
  }, [context.actions]);

  /** Opens a conversation (or goes back to the list on a phone), forgetting the one shown before. */
  function openConversation(next: { id: string; store: string | null } | null) {
    setConversation(null);
    setGone(false);
    setOpen(next);
  }

  async function changePresence(next: "online" | "away") {
    if (!context.actions.presence) return;
    const before = presence;
    setPresenceState(next);
    const result = await context.actions.presence(next).catch(() => ({ ok: false }));
    if (!result.ok) setPresenceState(before);
  }

  const showing = open !== null;
  return (
    <div className="flex h-[calc(100dvh-10rem)] min-h-[28rem] flex-col overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2">
        <h1 className="text-lg font-semibold">Inbox</h1>
        <p className="text-sm text-muted" role="status">
          {waiting === 1 ? "1 waiting" : `${waiting} waiting`}
        </p>
        <span className="flex-1" />
        {context.presence !== null && context.actions.presence && (
          <label className="flex items-center gap-2 text-sm">
            <span>You are</span>
            <select value={presence ?? "away"} onChange={(event) => void changePresence(event.target.value as "online" | "away")} className="rounded-md border border-border bg-background px-2 py-1">
              <option value="online">Online</option>
              <option value="away">Away</option>
            </select>
          </label>
        )}
      </div>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[22rem_1fr_18rem]">
        <section className={`${showing ? "hidden lg:flex" : "flex"} min-h-0 flex-col border-border lg:border-r`} aria-label="Conversations">
          <div className="flex flex-col gap-2 border-b border-border p-3">
            <div role="tablist" aria-label="Which conversations" className="flex flex-wrap gap-1">
              {(Object.keys(TAB_WORDS) as InboxTab[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => setTab(key)}
                  className={`rounded-md px-2 py-1 text-sm ${tab === key ? "bg-foreground text-background" : "hover:bg-surface"}`}
                >
                  {TAB_WORDS[key]}
                  {key === "waiting" && waiting > 0 ? ` (${waiting})` : ""}
                </button>
              ))}
            </div>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name, email or summary"
              aria-label="Search conversations"
              className="rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
            {context.stores.length > 1 && (
              <select value={store} onChange={(event) => setStore(event.target.value)} aria-label="Store" className="rounded-md border border-border bg-background px-2 py-1 text-sm">
                <option value="">All stores</option>
                {context.stores.map((s) => (
                  <option key={s.slug} value={s.slug}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <ConversationList rows={rows} selected={open?.id ?? null} now={now} onOpen={(row) => openConversation({ id: row.id, store: row.store?.slug ?? null })} empty={EMPTY[tab]} />
          </div>
        </section>
        <section className={`${showing ? "flex" : "hidden lg:flex"} min-h-0 flex-col`} aria-label="Conversation">
          {showing && (
            <button type="button" onClick={() => openConversation(null)} className="border-b border-border px-4 py-2 text-left text-sm lg:hidden">
              ← Conversations
            </button>
          )}
          {conversation ? (
            <>
              <ConversationView conversation={conversation} now={now} />
              <ConversationActions
                key={conversation.id}
                conversation={conversation}
                act={(input) => runAct(context, conversation.store?.slug ?? null, conversation.id, input)}
                onDone={() => {
                  setRefresh((n) => n + 1);
                  void loadList();
                }}
              />
            </>
          ) : (
            <p className="p-6 text-sm text-muted">{gone ? "This conversation is no longer here." : showing ? "Opening…" : "Choose a conversation to read it as it happens."}</p>
          )}
        </section>
        <aside className="hidden min-h-0 overflow-y-auto overscroll-contain border-l border-border lg:block" aria-label="Context">
          {conversation && <ConversationContext conversation={conversation} />}
        </aside>
      </div>
    </div>
  );
}

const EMPTY: Record<InboxTab, string> = {
  waiting: "Nobody is waiting for a person.",
  mine: "You have no open conversations.",
  ai: "Nobody is talking to the assistant right now.",
  open: "No open conversations.",
  ended: "No ended conversations yet.",
};
