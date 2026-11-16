"use client";

import { ChevronDown, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { countWords, fillWords } from "@/lib/admin-fill";
import { TAB_WORDS, durationWords, topicWords } from "@/lib/support-inbox-text";
import { topicsFor } from "@/lib/support-summary";
import { TONE_BANDS } from "@/lib/support-tone";
import { TYPING_SHOWN_MS, staffDelay } from "@/lib/support-realtime";
import { HEARTBEAT_SECONDS, PARTNER_PAUSE_SECONDS } from "@/lib/support-rules";
import type { InboxTab } from "@/server/support";
import type { ConversationFeed, InboxFeed } from "@/server/support-inbox";

import { useSupportChannel } from "../../chat/use-support-channel";

import { ConversationActions } from "./conversation-actions";
import { ConversationList } from "./conversation-list";
import { ConversationContext, ConversationView } from "./conversation-view";
import { PartnerPanel } from "./partner-panel";
import {
  conversationHref,
  runAct,
  type SupportDeskContext,
} from "./desk-context";
import { CARD_CLASS } from "@/components/admin/ui";

import { useAdminText } from "../admin-text";

/**
 * The support inbox (D216, `docs/support.md` 2.4, 5.4), the same at every level: the list on the left, the conversation in the middle
 * and who it is with on the right, each scrolling on its own (on a phone the list and the conversation are separate views). It asks
 * for the list every 3 seconds and the open conversation's new messages every 2, slower in a hidden tab; nothing is cached.
 */
export function Inbox({
  context,
  initial,
  initialTab,
  initialOpen = null,
}: {
  context: SupportDeskContext;
  initial: InboxFeed;
  initialTab: InboxTab;
  /** A conversation to open at once (`?c=`, from the Requests page). */
  initialOpen?: string | null;
}) {
  const t = useAdminText("support");
  const w = t.inbox;
  const [tab, setTab] = useState<InboxTab>(initialTab);
  const [query, setQuery] = useState("");
  const [store, setStore] = useState("");
  const [tone, setTone] = useState("");
  const [topic, setTopic] = useState("");
  // The search and the filters, one press away (round 4, D612); open by themselves while one is in use.
  const [filtering, setFiltering] = useState(false);
  const [rows, setRows] = useState(initial.rows);
  const [waiting, setWaiting] = useState(initial.waiting);
  const [open, setOpen] = useState<{ id: string; store: string | null } | null>(
    initialOpen ? { id: initialOpen, store: null } : null,
  );
  const [conversation, setConversation] = useState<ConversationFeed | null>(
    null,
  );
  // Bumped after an action, so the conversation and the list are asked for again at once.
  const [refresh, setRefresh] = useState(0);
  const [presence, setPresenceState] = useState(context.presence);
  const [partnerOn, setPartnerOn] = useState(context.partnerOn);
  // The right column's tab: the partner by default where it may help, else the context (step 8).
  const [side, setSide] = useState<"partner" | "context" | null>(null);
  // A partner's draft put in the composer (*Use*): the composer is drawn again with it.
  const [fill, setFill] = useState<{ text: string; n: number } | null>(null);
  const [partnerWorking, setPartnerWorking] = useState(false);
  const asked = useRef(new Set<string>());
  const [now, setNow] = useState(() => new Date());
  const [gone, setGone] = useState(false);
  const [mineUnread, setMineUnread] = useState(initial.mineUnread);
  const [toneAlertAt, setToneAlertAt] = useState(initial.lastToneAlert);
  // Realtime (D216, 4.6, step 12): the desks' topics and the open conversation's; a ping asks at once, the timers slow to the safety net.
  const [deskChannels, setDeskChannels] = useState(initial.channels);
  const [customerTyping, setCustomerTyping] = useState(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Sound and browser notifications, once the person turned them on (2.9): the browser asks first.
  const [alerts, setAlerts] = useState(false);
  const seen = useRef({
    waiting: initial.waiting,
    mineUnread: initial.mineUnread,
    toneAlertAt: initial.lastToneAlert,
  });
  const hidden = () =>
    typeof document !== "undefined" && document.visibilityState === "hidden";

  const loadList = useCallback(async () => {
    const params = new URLSearchParams({ tab });
    if (query.trim()) params.set("q", query.trim());
    if (store) params.set("store", store);
    if (tone) params.set("tone", tone);
    if (topic && tab === "ended") params.set("topic", topic);
    try {
      const response = await fetch(`${context.feedUrl}?${params}`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const body = (await response.json()) as InboxFeed;
      setRows(body.rows);
      setWaiting(body.waiting);
      setMineUnread(body.mineUnread);
      setToneAlertAt(body.lastToneAlert);
      setDeskChannels((current) =>
        current.join() === body.channels.join() ? current : body.channels,
      );
      setNow(new Date());
    } catch {
      // Offline for a moment: the next poll tries again.
    }
  }, [context.feedUrl, tab, query, store, tone, topic]);

  const conversationTopic =
    conversation?.status === "open" ? conversation.channel : "";
  const realtime = useSupportChannel(
    [...deskChannels, ...(conversationTopic ? [conversationTopic] : [])],
    {
      onPing: () => {
        void loadList();
        setRefresh((n) => n + 1);
      },
      onTyping: (by) => {
        if (by !== "customer") return;
        if (typingTimer.current) clearTimeout(typingTimer.current);
        setCustomerTyping(true);
        typingTimer.current = setTimeout(
          () => setCustomerTyping(false),
          TYPING_SHOWN_MS,
        );
      },
    },
  );
  const connected = realtime.connected;

  // The list: at once when the filters change, then every 3 seconds (15 in a hidden tab or while realtime is connected).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const tick = async () => {
      await loadList();
      if (!stopped)
        timer = setTimeout(tick, staffDelay("list", hidden(), connected));
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [loadList, connected]);

  // The open conversation: everything first, then what came after the last message seen, every 2 seconds.
  useEffect(() => {
    if (!open) return;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    let last = 0;
    const tick = async () => {
      try {
        const response = await fetch(
          conversationHref(context, open.id, open.store, last),
          { cache: "no-store" },
        );
        if (response.status === 404) {
          setGone(true);
          return;
        }
        if (response.ok) {
          const fresh = (await response.json()) as ConversationFeed;
          setConversation((current) => {
            if (!current || current.id !== fresh.id) return fresh;
            const seen = new Set(current.messages.map((m) => m.seq));
            return {
              ...fresh,
              messages: [
                ...current.messages,
                ...fresh.messages.filter((m) => !seen.has(m.seq)),
              ],
            };
          });
          last = Math.max(last, ...fresh.messages.map((m) => m.seq));
          setNow(new Date());
        }
      } catch {
        // The next poll tries again.
      }
      if (!stopped)
        timer = setTimeout(
          tick,
          staffDelay("conversation", hidden(), connected),
        );
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [context, open, refresh, connected]);

  // The heartbeat keeps an online agent counted as online while the inbox is open.
  useEffect(() => {
    const beat = () => void context.actions.heartbeat().catch(() => undefined);
    beat();
    const timer = setInterval(beat, HEARTBEAT_SECONDS * 1000);
    return () => clearInterval(timer);
  }, [context.actions]);

  // Someone new waiting, or a customer writing in one of the person's own conversations: a sound and a notification, if on.
  useEffect(() => {
    const before = seen.current;
    seen.current = { waiting, mineUnread, toneAlertAt };
    if (!alerts) return;
    const toneFell =
      toneAlertAt !== null &&
      (before.toneAlertAt === null || toneAlertAt > before.toneAlertAt);
    const words =
      waiting > before.waiting
        ? countWords(waiting, w.alertWaiting)
        : toneFell
          ? w.alertTone
          : mineUnread > before.mineUnread
            ? w.alertWrote
            : null;
    if (words) alert(words, w.notification);
  }, [waiting, mineUnread, toneAlertAt, alerts, w]);

  // The tab's title says how many wait while the inbox is open.
  useEffect(() => {
    const original = document.title;
    return () => {
      document.title = original;
    };
  }, []);
  useEffect(() => {
    document.title =
      waiting > 0 ? fillWords(w.tabTitleWaiting, { n: waiting }) : w.tabTitle;
  }, [waiting, w]);

  async function turnOnAlerts() {
    if (
      typeof Notification !== "undefined" &&
      Notification.permission === "default"
    )
      await Notification.requestPermission().catch(() => "denied");
    // The sound is allowed from this press on; notifications only where the browser said yes.
    chime();
    setAlerts(true);
  }

  // The silent partner looks once the customer has stopped writing for a moment, when the person has the conversation (step 8). The
  // server decides again (switches, the person, once per message); this only says when to ask.
  const partnerFor = conversation;
  const lastCustomer = partnerFor
    ? partnerFor.messages.reduce(
        (max, m) => (m.author === "customer" ? Math.max(max, m.seq) : max),
        0,
      )
    : 0;
  const partnerShould = Boolean(
    partnerFor &&
    partnerFor.partner.available &&
    partnerFor.partner.mine &&
    !partnerFor.partnerPaused &&
    partnerFor.status === "open" &&
    partnerFor.handler === "human" &&
    partnerFor.assignee?.id === partnerFor.me &&
    lastCustomer > partnerFor.partnerSeq,
  );
  const partnerConversation = partnerFor?.id ?? null;
  const partnerStore = partnerFor?.store?.slug ?? null;
  useEffect(() => {
    if (!partnerShould || !partnerConversation) return;
    const key = `${partnerConversation}:${lastCustomer}`;
    if (asked.current.has(key)) return;
    const timer = setTimeout(() => {
      asked.current.add(key);
      setPartnerWorking(true);
      void runAct(context, partnerStore, partnerConversation, {
        kind: "partner",
        seq: lastCustomer,
      })
        .catch(() => undefined)
        .finally(() => {
          setPartnerWorking(false);
          setRefresh((n) => n + 1);
        });
    }, PARTNER_PAUSE_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [partnerShould, partnerConversation, partnerStore, lastCustomer, context]);

  /** Opens a conversation (or goes back to the list on a phone), forgetting the one shown before. */
  function openConversation(next: { id: string; store: string | null } | null) {
    setConversation(null);
    setGone(false);
    setFill(null);
    setOpen(next);
  }

  async function changePartner(next: boolean) {
    if (!context.actions.partner) return;
    const before = partnerOn;
    setPartnerOn(next);
    const result = await context.actions
      .partner(next)
      .catch(() => ({ ok: false }));
    if (!result.ok) setPartnerOn(before);
    else setRefresh((n) => n + 1);
  }

  async function changePresence(next: "online" | "away") {
    if (!context.actions.presence) return;
    const before = presence;
    setPresenceState(next);
    const result = await context.actions
      .presence(next)
      .catch(() => ({ ok: false }));
    if (!result.ok) setPresenceState(before);
  }

  const showing = open !== null;
  // How long the one waiting longest has waited (round 4, D612): the oldest queue time among the open rows waiting for a person.
  const longest = rows.filter((r) => r.handler === "queue" && r.status === "open" && r.queuedAt).map((r) => r.queuedAt as string).sort()[0] ?? null;
  return (
    <div
      className={`flex h-[calc(100dvh-7rem)] min-h-[28rem] flex-col overflow-hidden ${CARD_CLASS}`}
    >
      {/* Round 4 (D612): who waits, in a sentence, and one menu for being reachable (presence, alerts, the AI partner). */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3">
        <div className="flex min-w-0 flex-col">
          <h1 className="text-title text-ink">{w.title}</h1>
          <p className="text-body text-ink-2" role="status">
            {waiting > 0 ? (
              <>
                <span className="text-ink">{countWords(waiting, w.leadWaiting)}</span>
                {longest ? fillWords(w.leadLongest, { time: durationWords(longest, now.toISOString(), t.lib) }) : "."}
              </>
            ) : (
              w.leadNobody
            )}
          </p>
        </div>
        <span className="flex-1" />
        <details className="relative">
          <summary className="inline-flex h-10 cursor-pointer list-none items-center gap-2 rounded-pill border border-edge bg-card px-4 text-body text-ink hover:bg-sunken [&::-webkit-details-marker]:hidden">
            {context.presence !== null && (
              <>
                <span aria-hidden className={`size-2 rounded-pill ${presence === "online" ? "bg-insight-solid" : "bg-neutral-solid"}`} />
                {presence === "online" ? w.available : w.away}
                {" · "}
              </>
            )}
            {alerts ? w.alertsShort.on : w.alertsShort.off}
            <ChevronDown aria-hidden className="size-4" />
          </summary>
          <div className="absolute right-0 z-30 mt-2 flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-panel border border-line bg-card p-4 shadow-[var(--shadow-float)]">
            <span className="text-caption text-muted">{w.reach}</span>
            {context.presence !== null && context.actions.presence && (
              <label className="flex items-center justify-between gap-3 text-body">
                <span>{w.youAre}</span>
                <select
                  value={presence ?? "away"}
                  onChange={(event) =>
                    void changePresence(event.target.value as "online" | "away")
                  }
                  className="rounded-md border border-line bg-card px-2 py-1"
                >
                  <option value="online">{w.online}</option>
                  <option value="away">{w.away}</option>
                </select>
              </label>
            )}
            {alerts ? (
              <button
                type="button"
                onClick={() => setAlerts(false)}
                className="rounded-pill border border-edge px-3 py-1.5 text-body hover:bg-sunken"
                aria-pressed
              >
                {w.alertsOn}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void turnOnAlerts()}
                className="rounded-pill border border-edge px-3 py-1.5 text-body hover:bg-sunken"
                aria-pressed={false}
              >
                {w.turnOnAlerts}
              </button>
            )}
            {partnerOn !== null && context.actions.partner && (
              <label className="flex items-start gap-2 text-body">
                <input
                  type="checkbox"
                  checked={partnerOn}
                  onChange={(event) => void changePartner(event.target.checked)}
                  className="mt-1 size-4"
                />
                <span className="flex flex-col">
                  {w.partner}
                  <span className="text-caption text-muted">{w.partnerHint}</span>
                </span>
              </label>
            )}
          </div>
        </details>
      </div>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[22rem_1fr_18rem]">
        <section
          className={`${showing ? "hidden lg:flex" : "flex"} min-h-0 flex-col border-line lg:border-r`}
          aria-label={w.conversations}
        >
          <div className="flex flex-col gap-2 border-b border-line p-3">
            <div className="flex items-center gap-2">
            <div
              role="tablist"
              aria-label={w.whichConversations}
              className="flex min-w-0 flex-1 flex-wrap gap-1"
            >
              {(Object.keys(TAB_WORDS) as InboxTab[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => setTab(key)}
                  className={`shrink-0 whitespace-nowrap rounded-pill px-2.5 py-1 text-sm ${tab === key ? "bg-ink text-card" : "text-ink-2 hover:bg-sunken"}`}
                >
                  {t.lib.tabs[key]}
                  {key === "waiting" && waiting > 0 ? ` (${waiting})` : ""}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setFiltering((shown) => !shown)}
              aria-expanded={filtering || Boolean(query || tone || topic || store)}
              aria-label={w.filters}
              className="flex size-8 shrink-0 items-center justify-center rounded-pill bg-sunken text-ink hover:bg-line"
            >
              <Search aria-hidden className="size-4" />
            </button>
            </div>
            {(filtering || Boolean(query || tone || topic || store)) && (
            <>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={w.search}
              aria-label={w.searchLabel}
              className="rounded-md border border-line bg-card px-2 py-1 text-sm"
            />
            <select
              value={tone}
              onChange={(event) => setTone(event.target.value)}
              aria-label={w.tone}
              className="rounded-md border border-line bg-card px-2 py-1 text-sm"
            >
              <option value="">{w.anyTone}</option>
              {TONE_BANDS.map((band) => (
                <option key={band} value={band}>
                  {t.lib.tones[band]}
                </option>
              ))}
            </select>
            {tab === "ended" && (
              <select
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                aria-label={w.topic}
                className="rounded-md border border-line bg-card px-2 py-1 text-sm"
              >
                <option value="">{w.anyTopic}</option>
                {topicsFor(context.level === "platform").map((t) => (
                  <option key={t} value={t}>
                    {topicWords(t)}
                  </option>
                ))}
              </select>
            )}
            {context.stores.length > 1 && (
              <select
                value={store}
                onChange={(event) => setStore(event.target.value)}
                aria-label={w.store}
                className="rounded-md border border-line bg-card px-2 py-1 text-sm"
              >
                <option value="">{w.allStores}</option>
                {context.stores.map((s) => (
                  <option key={s.slug} value={s.slug}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
            </>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <ConversationList
              rows={rows}
              selected={open?.id ?? null}
              now={now}
              onOpen={(row) =>
                openConversation({ id: row.id, store: row.store?.slug ?? null })
              }
              empty={t.empty[tab]}
            />
          </div>
        </section>
        <section
          className={`${showing ? "flex" : "hidden lg:flex"} min-h-0 flex-col`}
          aria-label={w.conversation}
        >
          {showing && (
            <button
              type="button"
              onClick={() => openConversation(null)}
              className="border-b border-line px-4 py-2 text-left text-sm lg:hidden"
            >
              {w.back}
            </button>
          )}
          {conversation ? (
            <>
              <ConversationView
                conversation={conversation}
                now={now}
                translate={
                  conversation.translate
                    ? (seq) =>
                        runAct(
                          context,
                          conversation.store?.slug ?? null,
                          conversation.id,
                          { kind: "translate", seq },
                        )
                    : undefined
                }
              />
              <ConversationActions
                key={`${conversation.id}:${fill?.n ?? 0}`}
                initialDraft={fill?.text}
                conversation={conversation}
                act={(input) =>
                  runAct(
                    context,
                    conversation.store?.slug ?? null,
                    conversation.id,
                    input,
                  )
                }
                onTyping={() =>
                  realtime.sendTyping(conversationTopic || null, "agent")
                }
                customerTyping={customerTyping}
                onDone={() => {
                  setRefresh((n) => n + 1);
                  void loadList();
                }}
              />
            </>
          ) : (
            <p className="p-6 text-sm text-muted">
              {gone ? w.gone : showing ? w.opening : w.choose}
            </p>
          )}
        </section>
        <aside
          className="hidden min-h-0 flex-col border-l border-line lg:flex"
          aria-label={w.side}
        >
          {conversation && (
            <>
              <div
                role="tablist"
                aria-label={w.beside}
                className="flex gap-1 border-b border-line p-2"
              >
                {(["partner", "context"] as const).map((key) => {
                  const shown =
                    side ??
                    (conversation.partner.available ? "partner" : "context");
                  return (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={shown === key}
                      onClick={() => setSide(key)}
                      className={`rounded-pill px-2 py-1 text-sm ${shown === key ? "bg-brand text-brand-ink" : "hover:bg-sunken"}`}
                    >
                      {key === "partner" ? w.partner : w.context}
                    </button>
                  );
                })}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                {(side ??
                  (conversation.partner.available ? "partner" : "context")) ===
                "partner" ? (
                  <PartnerPanel
                    conversation={conversation}
                    working={partnerWorking}
                    act={(input) =>
                      runAct(
                        context,
                        conversation.store?.slug ?? null,
                        conversation.id,
                        input,
                      )
                    }
                    onDone={() => setRefresh((n) => n + 1)}
                    onUse={(text) =>
                      setFill((current) => ({ text, n: (current?.n ?? 0) + 1 }))
                    }
                  />
                ) : (
                  <ConversationContext conversation={conversation} />
                )}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

/** A short tone, made in the browser (no file to load). */
function chime() {
  try {
    const AudioContextClass =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextClass) return;
    const audio = new AudioContextClass();
    const tone = audio.createOscillator();
    const gain = audio.createGain();
    tone.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, audio.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.4);
    tone.connect(gain).connect(audio.destination);
    tone.start();
    tone.stop(audio.currentTime + 0.45);
    tone.onended = () => void audio.close();
  } catch {
    // No sound where the browser allows none.
  }
}

/** The sound, and a browser notification when the tab is not in front and the browser allows them. */
function alert(words: string, title: string) {
  chime();
  if (
    typeof Notification !== "undefined" &&
    Notification.permission === "granted" &&
    document.visibilityState === "hidden"
  ) {
    try {
      new Notification(title, { body: words, tag: "kaizen-support" });
    } catch {
      // Some browsers allow notifications only from a service worker: the sound and the title still say it.
    }
  }
}
