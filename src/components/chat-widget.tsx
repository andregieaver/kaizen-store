"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useId, useRef, useState } from "react";

import { MESSAGE_MAX, type ChatProduct } from "@/lib/chat";
import { readSession, signalsOf } from "@/lib/recommend-session";
import {
  STORAGE_KEY,
  lastSeqOf,
  mergeMessages,
  readStored,
  storedValue,
  type ConversationRef,
  type StoredConversation,
  type VisitorMessage,
  type VisitorReply,
  type VisitorState,
} from "@/lib/support-visitor";

import { TYPING_SHOWN_MS, visitorDelay, widgetListens } from "@/lib/support-realtime";
import type { UnitLabels } from "@/lib/unit-price-text";

import { Chips, type ChipLabels } from "./chat/chips";
import { ConfirmCard, actionLine, type ActionLabels } from "./chat/confirm-card";
import { EmailForm } from "./chat/email-card";
import { SignInCard, type SignInCardLabels } from "./chat/sign-in-card";
import { useSupportChannel } from "./chat/use-support-channel";
import { Icon } from "./icons";
import { UnitLine, VatAmount } from "./price";

/** The widget's words, in the site's language; `opened` holds `{label}` for the page opened. */
export type ChatLabels = {
  open: string;
  close: string;
  aiAssistant: string;
  greeting: string;
  placeholder: string;
  send: string;
  talk: string;
  listening: string;
  thinking: string;
  opened: string;
  sorry: string;
  disclaimer: string;
  micDenied: string;
  restart: string;
  conversation: string;
  /** The notice under the conversation (D216, legal: needs review): who answers and how long the site keeps it, in the desk's mode. */
  notice: string;
  privacy: string;
  /** People only: the header's words beside the desk's name. */
  peopleTitle: string;
  talkToPerson: string;
  continueAssistant: string;
  /** `{place}` stands for the visitor's place in line. */
  queuePlace: string;
  nobody: string;
  nobodyLater: string;
  /** The rating card after the end (step 7). */
  rating: { question: string; yes: string; no: string; comment: string; send: string; thanks: string };
  /** The email card; `sent` holds `{email}`. */
  emailCard: { intro: string; name: string; email: string; send: string; sent: string; use: string; change: string; invalid: string };
  /** The words of the conversation's system lines, by kind; `{name}` stands for a person's name. */
  lines: { ended: string; reopened: string; queued: string; joined: string; left: string; assistantBack: string };
  /** The sign-in card (D216, 2.1: a person's request, step 4, or the AI's, step 9). */
  signInCard: SignInCardLabels;
  /** The link chips under the AI's answers (step 9), by kind; `{label}` stands for the number. */
  chips: ChipLabels;
  /** The confirm card and the lines after an action or request (step 10). */
  actions: ActionLabels;
  /** On the closed chat's button when a person wrote. */
  newMessage: string;
  vatIncluded: string;
  vatExcluded: string;
  fromPrice: string;
  priorPrice: string;
  /** The words of a unit price (D160), so a card shows the price per kg, litre or metre worked out in code from the price it shows. */
  unit: UnitLabels;
};

export type ChatWidgetProps = {
  /** Which site the messages are for: a store in one of its countries, or Kaizen's (neither). */
  site: { store?: string; market?: string };
  /** Where a customer signs in (a store's account page), for the card a person can send; none on Kaizen's site. */
  signInHref?: string;
  locale: string;
  /** Who answers: the agent while the AI answers first; with people only its name is empty and `deskName` is shown. */
  agent: {
    name: string;
    occupation: string;
    avatar: { url: string; width: number; height: number } | null;
    voice: boolean;
    /** The desk's mode (D216): the chat agent alone, the AI first, or people only. */
    mode: "off" | "ai_first" | "people";
    /** Whether the AI answers here (with the AI first but no AI set up, every conversation goes to the queue). */
    ai: boolean;
  };
  /** The store's name, or Kaizen's: shown with people only. */
  deskName: string;
  /** The site's privacy page, linked from the notice while support is on. */
  privacyHref?: string;
  labels: ChatLabels;
};

/** A sentence from the widget itself (a limit, an error): shown after the conversation, never kept or sent. */
type Notice = { id: number; text: string };

/** What the tab remembers of the products looked at and the searches made (D139), for the agent's recommendations; none without it. */
function tabSignals() {
  try {
    return signalsOf(readSession(window.sessionStorage));
  } catch {
    return { views: [], searches: [] };
  }
}

/** A spoken message's longest recording. */
const RECORDING_MS = 60_000;

/**
 * The tab's copy of its conversation (`kaizen_chat`, D58, version 2): which conversation is the visitor's and what it has shown. The
 * conversation itself is the site's (D216); the copy only lets a reload draw at once before asking for what is new.
 */
function loadStored(site: string): StoredConversation {
  try {
    return readStored(sessionStorage.getItem(STORAGE_KEY), site);
  } catch {
    return readStored(null, site);
  }
}

function saveStored(stored: StoredConversation) {
  try {
    if (!stored.conversation) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, storedValue(stored));
  } catch {
    // Private windows and full storage: the conversation lasts as long as the page.
  }
}

const isReply = (body: unknown): body is VisitorReply => Boolean(body && typeof body === "object" && Array.isArray((body as VisitorReply).messages) && (body as VisitorReply).state);

const phone = () => window.matchMedia("(max-width: 767px)").matches;

function recorderType(): string | undefined {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  return types.find((type) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type));
}

/**
 * The site's chat agent (D81): a button in the corner that opens a
 * conversation with the AI assistant, typed or spoken. It opens the pages
 * the agent opens for the visitor, and shows the products it found as
 * cards with the site's own prices. It is labelled as AI, as the AI Act asks.
 * The conversation is the site's (D216): the widget sends only the new
 * message and draws what the site answers.
 */
export function ChatWidget({ site, signInHref, locale, agent, deskName, privacyHref, labels }: ChatWidgetProps) {
  const router = useRouter();
  const key = `${site.store ?? ""}/${site.market ?? ""}`;
  const [open, setOpen] = useState(false);
  const [stored, setStored] = useState<StoredConversation>(() => readStored(null, key));
  const [pending, setPending] = useState<string | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [draft, setDraft] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // The conversation's state as the site last said it (who answers, the person who joined); not kept in the tab.
  const [state, setState] = useState<VisitorState | null>(null);
  // A person wrote while the chat was closed.
  const [unseen, setUnseen] = useState(false);
  // The sign-in card the visitor just signed in with (step 9): it says so where it was.
  const [signedInAt, setSignedInAt] = useState<number | null>(null);
  const storedRef = useRef(stored);
  const openRef = useRef(open);
  const panelId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  const messages = stored.messages;
  useEffect(() => {
    storedRef.current = stored;
    openRef.current = open;
  }, [stored, open]);
  useEffect(() => {
    if (loaded) saveStored(stored);
  }, [loaded, stored]);

  // While a conversation is open, the widget asks the site for what is new (D216): every 3 seconds while waiting for or talking to a
  // person, 10 with the AI, 15 with the chat closed or the tab hidden. A person's answer while the chat is closed marks its button.
  // With realtime (step 12, only while waiting for or with a person) a ping asks at once and the timer slows to the safety net.
  const conversationId = stored.conversation?.id ?? null;
  const live = loaded && conversationId !== null && stored.status === "open";
  const handler = state?.handler ?? "ai";
  const topic = live && widgetListens(state) ? state!.channel : null;
  const [nudge, setNudge] = useState(0);
  // "typing…" from a person shows for a few seconds after their last keystroke, and goes with their message.
  const [agentTyping, setAgentTyping] = useState(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setAgentTypingAt = (at: number) => {
    if (typingTimer.current) clearTimeout(typingTimer.current);
    setAgentTyping(at > 0);
    if (at > 0) typingTimer.current = setTimeout(() => setAgentTyping(false), TYPING_SHOWN_MS);
  };
  const realtime = useSupportChannel(topic ? [topic] : [], {
    onPing: () => setNudge((n) => n + 1),
    onTyping: (by) => {
      if (by === "agent") setAgentTypingAt(Date.now());
    },
  });
  const connected = realtime.connected;
  useEffect(() => {
    if (!live) return;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const tick = async () => {
      const current = storedRef.current;
      if (current.conversation) {
        try {
          const response = await fetch("/api/chat/feed", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...site, conversation: current.conversation, after: current.lastSeq }),
          });
          const body = (await response.json().catch(() => ({}))) as unknown;
          if (response.ok && isReply(body) && !stopped) {
            setState(body.state);
            if (body.messages.length > 0) {
              setStored((now) => {
                const merged = mergeMessages(now.messages, body.messages);
                return { ...now, status: body.state.status, messages: merged, lastSeq: lastSeqOf(merged, now.lastSeq) };
              });
              if (body.messages.some((m) => m.author === "agent")) setAgentTypingAt(0);
              if (!openRef.current && body.messages.some((m) => m.author === "agent")) setUnseen(true);
            } else if (body.state.status !== storedRef.current.status) {
              setStored((now) => ({ ...now, status: body.state.status }));
            }
          }
        } catch {
          // Offline for a moment: the next time asks again.
        }
      }
      const hidden = document.visibilityState === "hidden" || !openRef.current;
      const delay = visitorDelay({ status: "open", handler }, hidden, connected);
      if (!stopped && delay !== null) timer = setTimeout(tick, delay);
    };
    // A ping asks at once; otherwise the first ask waits its delay.
    timer = setTimeout(tick, nudge > 0 ? 0 : (visitorDelay({ status: "open", handler }, !openRef.current, connected) ?? 10_000));
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [live, conversationId, handler, site, nudge, connected]);

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: "end" });
  }, [messages, notices, pending, waiting, open]);
  // Focus moves into the chat as it opens, and back to its button as it closes.
  useEffect(() => {
    if (open) inputRef.current?.focus();
    else if (wasOpen.current) launcherRef.current?.focus();
    wasOpen.current = open;
  }, [open]);
  // Stops a recording and any reading when the widget goes.
  useEffect(
    () => () => {
      recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
      audioRef.current?.pause();
    },
    [],
  );

  const notice = (text: string) => setNotices((current) => [...current, { id: Date.now() + current.length, text }]);

  /** Takes what the site answered: the conversation (a new one replaces the old), its state and the new messages; opens a page the agent opened. */
  const received = useCallback(
    (reply: VisitorReply, ref: ConversationRef | null) => {
      const conversation = reply.conversation ? { id: reply.conversation.id, token: reply.conversation.token ?? ref?.token ?? "" } : ref;
      setStored((current) => {
        const same = current.conversation?.id === conversation?.id;
        const base = same ? current.messages : [];
        const merged = mergeMessages(base, reply.messages);
        return { ...current, conversation: conversation && conversation.token ? conversation : null, status: reply.state.status, messages: merged, lastSeq: lastSeqOf(merged, same ? current.lastSeq : 0) };
      });
      setNotices(reply.error ? [{ id: Date.now(), text: reply.error }] : []);
      setState(reply.state);
      const go = reply.messages
        .filter((message) => message.author === "ai")
        .flatMap((message) => message.data?.actions ?? [])
        .find((action) => action.type === "navigate");
      if (go) {
        router.push(go.href);
        // On a phone the conversation covers the page, so it steps aside to show it.
        if (phone()) setOpen(false);
      }
    },
    [router],
  );

  /** The request every message carries: the site, the page, the tab's signals and the conversation with the last message seen. */
  const turn = () => ({
    ...site,
    path: window.location.pathname,
    signals: tabSignals(),
    ...(stored.conversation ? { conversation: stored.conversation } : {}),
    after: stored.lastSeq,
  });

  /** What to do with a refused request: a conversation the site no longer has is forgotten, so the next message starts a new one. */
  function refused(status: number, error: string | undefined) {
    if (status === 404 && stored.conversation) setStored((current) => ({ ...current, conversation: null, messages: [], lastSeq: 0, status: "open" }));
    notice(error ?? labels.sorry);
  }

  async function sendText(text: string) {
    const content = text.trim().slice(0, MESSAGE_MAX);
    if (!content || waiting) return;
    setPending(content);
    setDraft("");
    setWaiting(true);
    const ref = stored.conversation;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...turn(), message: content }),
      });
      const body = (await response.json().catch(() => ({}))) as unknown;
      if (!response.ok || !isReply(body)) {
        refused(response.status, (body as { error?: string }).error);
        setDraft((current) => current || content);
      } else received(body, ref);
    } catch {
      notice(labels.sorry);
      setDraft((current) => current || content);
    } finally {
      setPending(null);
      setWaiting(false);
    }
  }

  async function sendRecording(audio: Blob) {
    setWaiting(true);
    const ref = stored.conversation;
    try {
      const form = new FormData();
      form.set("audio", audio, "message");
      form.set("request", JSON.stringify(turn()));
      const response = await fetch("/api/chat/voice", { method: "POST", body: form });
      const body = (await response.json().catch(() => ({}))) as unknown;
      if (!response.ok || !isReply(body)) {
        refused(response.status, (body as { error?: string }).error);
        return;
      }
      received(body, ref);
      const spoken = (body as { audio?: string | null }).audio;
      if (spoken) {
        audioRef.current?.pause();
        audioRef.current = new Audio(`data:audio/mpeg;base64,${spoken}`);
        void audioRef.current.play().catch(() => undefined);
      }
    } catch {
      notice(labels.sorry);
    } finally {
      setWaiting(false);
    }
  }

  /** On opening: the tab's copy at once, then what is new since (the conversation may have ended, or a person may have written). */
  async function load() {
    const copy = loadStored(key);
    setStored(copy);
    setLoaded(true);
    if (!copy.conversation) return;
    try {
      const response = await fetch("/api/chat/feed", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...site, conversation: copy.conversation, after: copy.lastSeq }),
      });
      const body = (await response.json().catch(() => ({}))) as unknown;
      if (response.status === 404) setStored({ ...copy, conversation: null, messages: [], lastSeq: 0, status: "open" });
      else if (response.ok && isReply(body)) {
        setState(body.state);
        setStored((current) => {
          const merged = mergeMessages(current.messages, body.messages);
          return { ...current, status: body.state.status, messages: merged, lastSeq: lastSeqOf(merged, current.lastSeq) };
        });
      }
    } catch {
      // Offline: the copy is shown; the next message asks again.
    }
  }

  /** Push to talk: the first press starts recording, the second sends it. */
  async function talk() {
    const recorder = recorderRef.current;
    if (recorder) {
      recorder.stop();
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      notice(labels.micDenied);
      return;
    }
    audioRef.current?.pause();
    const type = recorderType();
    const next = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    const limit = window.setTimeout(() => next.state === "recording" && next.stop(), RECORDING_MS);
    next.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    next.onstop = () => {
      window.clearTimeout(limit);
      stream.getTracks().forEach((track) => track.stop());
      recorderRef.current = null;
      setRecording(false);
      const audio = new Blob(chunks, { type: next.mimeType || type || "audio/webm" });
      if (audio.size > 0) void sendRecording(audio);
    };
    recorderRef.current = next;
    next.start();
    setRecording(true);
  }

  /** A new conversation: the old one is ended at the site (kept for its period, then anonymised) and forgotten by the tab. */
  function restart() {
    recorderRef.current?.stop();
    audioRef.current?.pause();
    const ref = stored.conversation;
    if (ref && stored.status === "open") {
      void fetch("/api/chat/end", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...site, conversation: ref, after: stored.lastSeq }),
      }).catch(() => undefined);
    }
    setStored({ ...stored, conversation: null, messages: [], lastSeq: 0, status: "open" });
    setNotices([]);
    inputRef.current?.focus();
  }

  /** *Talk to a person* or *Continue with the assistant* (D216, 2.3): the site moves the conversation and answers with how it stands. */
  async function change(to: "handoff" | "assistant") {
    const ref = stored.conversation;
    if (!ref || waiting) return;
    setWaiting(true);
    try {
      const response = await fetch(`/api/chat/${to}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...site, conversation: ref, after: stored.lastSeq }),
      });
      const body = (await response.json().catch(() => ({}))) as unknown;
      if (!response.ok || !isReply(body)) refused(response.status, (body as { error?: string }).error);
      else received(body, ref);
    } catch {
      notice(labels.sorry);
    } finally {
      setWaiting(false);
    }
  }

  // A person who has taken the conversation over is shown instead of the AI persona, never with the AI label (D216, S11).
  const person = state?.status === "open" && state.handler === "human" ? state.agent : null;
  // People only (D216, 2.1): the desk's name and "Our team answers here", never an AI persona or label; so too the AI first with no AI set up.
  const people = agent.mode === "people" || (agent.mode === "ai_first" && !agent.ai);
  const who = people ? deskName : `${agent.name}, ${labels.aiAssistant}`;
  const isOpen = stored.conversation !== null && stored.status === "open";
  const queued = isOpen && state?.status === "open" && state.handler === "queue" ? state : null;
  // Proposals a later line settled (step 10): their cards take no more answers.
  const settled = new Set(
    messages.flatMap((message) => {
      const id = message.author === "system" ? (message.data as { actionId?: unknown } | undefined)?.actionId : undefined;
      return typeof id === "string" ? [id] : [];
    }),
  );
  // The latest card asked for (D216, step 9): a person's or the AI's sign-in card, or the AI's email card. Only that one is drawn.
  const lastCard = [...messages].reverse().find((message) => (message.author === "system" && message.kind === "sign_in") || (message.author === "ai" && message.data?.card));
  const cardOf = (message: VisitorMessage) => (message.seq !== lastCard?.seq || !isOpen ? null : message.author === "system" ? "sign_in" : (message.data?.card ?? null));
  const cardFor = (message: VisitorMessage) => {
    const kind = cardOf(message);
    if (kind === "sign_in" && signedInAt === message.seq) {
      return (
        <li key={`card-${message.seq}`} className="flex justify-center">
          <p className="text-center text-xs text-muted">{labels.signInCard.done}</p>
        </li>
      );
    }
    if (kind === "sign_in" && signInHref && !state?.signedIn && stored.conversation) {
      return (
        <SignInCard
          key={`card-${message.seq}`}
          labels={labels.signInCard}
          sorry={labels.sorry}
          site={site}
          conversation={stored.conversation}
          after={stored.lastSeq}
          focus={false}
          onSignedIn={(reply) => {
            if (reply.state.signedIn) setSignedInAt(message.seq);
            received(reply, stored.conversation);
          }}
        />
      );
    }
    if (kind === "email" && state?.emailFollowup && stored.conversation) {
      return (
        <li key={`card-${message.seq}`} className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
          {state.followupEmail ? (
            <p>{labels.emailCard.sent.replace("{email}", state.followupEmail)}</p>
          ) : (
            <EmailForm labels={labels.emailCard} sorry={labels.sorry} site={site} conversation={stored.conversation} after={stored.lastSeq} onReply={(reply) => received(reply, stored.conversation)} />
          )}
        </li>
      );
    }
    return null;
  };

  const avatar = (size: string) =>
    agent.avatar ? (
      // eslint-disable-next-line @next/next/no-img-element -- the owner's uploaded picture, already small
      <img src={agent.avatar.url} alt="" width={agent.avatar.width} height={agent.avatar.height} className={`${size} shrink-0 rounded-full object-cover`} />
    ) : (
      <span aria-hidden className={`${size} flex shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground`}>
        <Icon name="chat" className="size-1/2" />
      </span>
    );

  return (
    <div className="print:hidden">
      {open && (
        <section
          id={panelId}
          role="dialog"
          aria-label={who}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
          className="fixed inset-x-0 bottom-0 z-[90] flex h-[85dvh] flex-col overflow-hidden rounded-t-2xl border border-border bg-background text-foreground shadow-2xl md:inset-x-auto md:right-6 md:bottom-24 md:h-[36rem] md:max-h-[calc(100dvh-8rem)] md:w-[24rem] md:rounded-2xl"
        >
          <header className="flex items-center gap-3 border-b border-border px-4 py-3">
            {person ? <PersonPicture person={person} size="size-10" /> : avatar("size-10")}
            <div className="min-w-0 flex-1">
              {person ? (
                <p className="truncate font-semibold">{person.name}</p>
              ) : people ? (
                <>
                  <p className="truncate font-semibold">{deskName}</p>
                  <p className="truncate text-sm text-muted">{labels.peopleTitle}</p>
                </>
              ) : (
                <>
                  <p className="truncate font-semibold">{agent.name}</p>
                  <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted">
                    {agent.occupation && <span className="truncate">{agent.occupation}</span>}
                    <span className="shrink-0 rounded-button bg-accent px-1.5 py-0.5 text-xs whitespace-nowrap text-accent-foreground">{labels.aiAssistant}</span>
                  </p>
                </>
              )}
            </div>
            {agent.mode === "ai_first" && agent.ai && isOpen && state?.handler === "ai" && (
              <button type="button" onClick={() => void change("handoff")} disabled={waiting} className="rounded-button border border-border px-2 py-1 text-sm whitespace-nowrap hover:bg-surface disabled:opacity-50">
                {labels.talkToPerson}
              </button>
            )}
            {messages.length > 0 && (
              <button type="button" onClick={restart} className="rounded-button px-2 py-1 text-sm text-muted hover:text-foreground">
                {labels.restart}
              </button>
            )}
            <button type="button" onClick={() => setOpen(false)} aria-label={labels.close} className="rounded-button p-1.5 text-muted hover:text-foreground">
              <Icon name="close" className="size-5" />
            </button>
          </header>

          <ol ref={listRef} role="log" aria-label={labels.conversation} aria-live="polite" className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
            <li className="flex items-end gap-2">
              {avatar("size-7")}
              <p className="max-w-[85%] rounded-2xl rounded-bl-sm bg-surface px-3 py-2 whitespace-pre-line">{labels.greeting}</p>
            </li>
            {messages.map((message) =>
              message.author === "customer" ? (
                <li key={message.seq} className="flex justify-end">
                  <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-foreground px-3 py-2 whitespace-pre-line text-background">{message.body}</p>
                </li>
              ) : message.author === "system" ? (
                message.kind === "sign_in" ? (
                  cardFor(message)
                ) : (
                  <SystemLine key={message.seq} message={message} labels={labels} />
                )
              ) : message.author === "agent" ? (
                <li key={message.seq} className="flex flex-col gap-1">
                  <span className="ml-9 text-xs text-muted">{agentOf(message)?.name ?? ""}</span>
                  <div className="flex items-end gap-2">
                    <PersonPicture person={agentOf(message)} size="size-7" />
                    <p className="max-w-[85%] rounded-2xl rounded-bl-sm bg-surface px-3 py-2 whitespace-pre-line">{message.body}</p>
                  </div>
                </li>
              ) : (
                <Fragment key={message.seq}>
                <li className="flex flex-col gap-2">
                  <div className="flex items-end gap-2">
                    {avatar("size-7")}
                    <p className="max-w-[85%] rounded-2xl rounded-bl-sm bg-surface px-3 py-2 whitespace-pre-line">{message.body}</p>
                  </div>
                  {message.data?.chips && message.data.chips.length > 0 && <Chips chips={message.data.chips} labels={labels.chips} onOpen={() => phone() && setOpen(false)} />}
                  {message.action && stored.conversation && (
                    <ConfirmCard
                      action={message.action}
                      open={isOpen && !settled.has(message.action.id)}
                      labels={labels.actions}
                      sorry={labels.sorry}
                      site={site}
                      conversation={stored.conversation}
                      after={stored.lastSeq}
                      onReply={(reply) => received(reply, stored.conversation)}
                    />
                  )}
                  {message.data?.actions?.map((action) => (
                    <Link
                      key={action.href}
                      href={action.href}
                      onClick={() => phone() && setOpen(false)}
                      className="ml-9 self-start rounded-button border border-border px-3 py-1 text-sm hover:bg-surface"
                    >
                      {labels.opened.replace("{label}", action.label)} →
                    </Link>
                  ))}
                  {message.data?.products && message.data.products.length > 0 && (
                    <ul className="ml-9 flex snap-x gap-2 overflow-x-auto pb-1">
                      {message.data.products.map((product) => (
                        <li key={product.handle} className="w-36 shrink-0 snap-start">
                          <ProductCard product={product} locale={locale} labels={labels} onOpen={() => phone() && setOpen(false)} />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
                {cardFor(message)}
                </Fragment>
              ),
            )}
            {pending && (
              <li className="flex justify-end">
                <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-foreground px-3 py-2 whitespace-pre-line text-background opacity-80">{pending}</p>
              </li>
            )}
            {notices.map((item) => (
              <li key={item.id} className="flex items-end gap-2">
                {avatar("size-7")}
                <p className="max-w-[85%] rounded-2xl rounded-bl-sm border border-border px-3 py-2 whitespace-pre-line text-muted">{item.text}</p>
              </li>
            ))}
            {queued && (
              <Waiting
                state={queued}
                labels={labels}
                site={site}
                conversation={stored.conversation!}
                after={stored.lastSeq}
                onReply={(reply) => received(reply, stored.conversation)}
                onAssistant={agent.mode === "ai_first" && agent.ai ? () => void change("assistant") : null}
              />
            )}
            {agent.mode !== "off" && stored.conversation && stored.status === "ended" && state?.status === "ended" && (
              <RatingCard state={state} labels={labels} site={site} conversation={stored.conversation} after={stored.lastSeq} onReply={(reply) => setState(reply.state)} />
            )}
            {agentTyping && !waiting && (
              <li className="flex items-end gap-2 text-sm text-muted">
                <PersonPicture person={state?.agent ?? null} size="size-7" />
                <span>{labels.thinking}</span>
              </li>
            )}
            {(waiting || recording) && (
              <li className="flex items-end gap-2 text-sm text-muted">
                {avatar("size-7")}
                <span>{recording ? labels.listening : labels.thinking}</span>
              </li>
            )}
          </ol>

          <form
            className="border-t border-border px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:pb-3"
            onSubmit={(event) => {
              event.preventDefault();
              void sendText(draft);
            }}
          >
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  // The person answering sees "typing…" (never the words), at most every 2 seconds.
                  if (topic && event.target.value) realtime.sendTyping(topic, "customer");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void sendText(draft);
                  }
                }}
                rows={1}
                maxLength={MESSAGE_MAX}
                placeholder={labels.placeholder}
                aria-label={labels.placeholder}
                disabled={recording}
                className="max-h-32 min-h-10 flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-base [field-sizing:content]"
              />
              {agent.voice && (
                <button
                  type="button"
                  onClick={() => void talk()}
                  disabled={waiting}
                  aria-pressed={recording}
                  aria-label={recording ? labels.listening : labels.talk}
                  className={`rounded-button p-2.5 ${recording ? "bg-red-600 text-white" : "border border-border"} disabled:opacity-50`}
                >
                  <Icon name="mic" className="size-5" />
                </button>
              )}
              <button type="submit" disabled={waiting || recording || !draft.trim()} aria-label={labels.send} className="button-primary rounded-button p-2.5 disabled:opacity-50">
                <Icon name="send" className="size-5" />
              </button>
            </div>
            <p className="mt-2 text-xs text-muted">
              {people ? "" : `${labels.disclaimer} `}
              {labels.notice}
              {agent.mode !== "off" && privacyHref && (
                <>
                  {" "}
                  <a href={privacyHref} className="underline">
                    {labels.privacy}
                  </a>
                </>
              )}
            </p>
          </form>
        </section>
      )}

      {!open && (
        <button
          ref={launcherRef}
          type="button"
          onClick={() => {
            // The conversation so far in this tab, read when the chat is first opened.
            if (!loaded) void load();
            setUnseen(false);
            setOpen(true);
          }}
          aria-expanded={false}
          aria-label={`${labels.open}: ${who}`}
          className="fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[55] flex items-center gap-2 rounded-full bg-foreground p-1 text-background shadow-lg md:right-6 md:bottom-6 md:pr-4"
        >
          {avatar("size-12")}
          <span className="hidden text-sm font-medium md:inline">{labels.open}</span>
          {unseen && (
            <span className="absolute -top-1 -right-1 rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">{labels.newMessage}</span>
          )}
        </button>
      )}
    </div>
  );
}

/**
 * While a conversation waits for a person (D216, 2.1 and 2.3): the visitor's place in line; when nobody can answer now, that, and the
 * email card where the desk answers by email (or where answers will go); with the AI first, *Continue with the assistant*.
 */
function Waiting({
  state,
  labels,
  site,
  conversation,
  after,
  onReply,
  onAssistant,
}: {
  state: VisitorState;
  labels: ChatLabels;
  site: { store?: string; market?: string };
  conversation: ConversationRef;
  after: number;
  onReply: (reply: VisitorReply) => void;
  onAssistant: (() => void) | null;
}) {
  const [editing, setEditing] = useState(false);
  const card = labels.emailCard;
  const asking = state.emailFollowup && (editing || (!state.followupEmail && !state.available));

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
      {state.queue && <p>{labels.queuePlace.replace("{place}", String(state.queue.position))}</p>}
      {!state.available && (
        <p>
          {labels.nobody} {labels.nobodyLater}
        </p>
      )}
      {asking ? (
        <EmailForm
          labels={card}
          sorry={labels.sorry}
          site={site}
          conversation={conversation}
          after={after}
          onReply={(reply) => {
            setEditing(false);
            onReply(reply);
          }}
        />
      ) : (
        state.followupEmail && (
          <p className="flex flex-wrap items-center gap-2">
            <span>{card.sent.replace("{email}", state.followupEmail)}</span>
            {!state.signedIn && (
              <button type="button" onClick={() => setEditing(true)} className="underline">
                {card.change}
              </button>
            )}
          </p>
        )
      )}
      {onAssistant && (
        <button type="button" onClick={onAssistant} className="self-start rounded-button border border-border px-3 py-1.5 hover:bg-surface">
          {labels.continueAssistant}
        </button>
      )}
    </li>
  );
}

/** "Did we help?" after the conversation ended (D216, 2.1, step 7): yes or no, then an optional comment; the answer can be changed. */
function RatingCard({
  state,
  labels,
  site,
  conversation,
  after,
  onReply,
}: {
  state: VisitorState;
  labels: ChatLabels;
  site: { store?: string; market?: string };
  conversation: ConversationRef;
  after: number;
  onReply: (reply: VisitorReply) => void;
}) {
  const [chosen, setChosen] = useState<"good" | "bad" | null>(state.rating);
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const words = labels.rating;

  async function rate(rating: "good" | "bad", withComment: string | null) {
    setBusy(true);
    try {
      const response = await fetch("/api/chat/rate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...site, conversation, after, rating, ...(withComment ? { comment: withComment } : {}) }),
      });
      const body = (await response.json().catch(() => ({}))) as unknown;
      if (response.ok && isReply(body)) {
        setChosen(rating);
        onReply(body);
        if (withComment !== null) setSent(true);
      }
    } catch {
      // The card stays: the visitor may press again.
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm" aria-busy={busy || undefined}>
      <p>{words.question}</p>
      <div className="flex gap-2" role="group" aria-label={words.question}>
        {(["good", "bad"] as const).map((rating) => (
          <button
            key={rating}
            type="button"
            aria-pressed={chosen === rating}
            disabled={busy}
            onClick={() => void rate(rating, null)}
            className={`rounded-button border border-border px-3 py-1.5 disabled:opacity-50 ${chosen === rating ? "button-primary" : "hover:bg-surface"}`}
          >
            {rating === "good" ? words.yes : words.no}
          </button>
        ))}
      </div>
      {chosen && !sent && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (comment.trim()) void rate(chosen, comment.trim());
          }}
          className="flex flex-col gap-2"
        >
          <label className="flex flex-col gap-1">
            <span>{words.comment}</span>
            <textarea value={comment} onChange={(event) => setComment(event.target.value)} maxLength={500} rows={2} className="rounded-lg border border-border bg-background px-3 py-2 text-base" />
          </label>
          <button type="submit" disabled={busy || !comment.trim()} className="self-start rounded-button border border-border px-3 py-1.5 hover:bg-surface disabled:opacity-50">
            {words.send}
          </button>
        </form>
      )}
      {chosen && <p role="status">{words.thanks}</p>}
    </li>
  );
}

/** A person's name and picture as the message was written with (`data`, D216): never an email. */
function agentOf(message: VisitorMessage): { name: string; picture: string | null } | null {
  const data = message.data as { name?: unknown; picture?: unknown } | undefined;
  return data && typeof data.name === "string" ? { name: data.name, picture: typeof data.picture === "string" ? data.picture : null } : null;
}

/** A person's own picture, else the first letter of their name. */
function PersonPicture({ person, size }: { person: { name: string; picture: string | null } | null; size: string }) {
  if (person?.picture) {
    // eslint-disable-next-line @next/next/no-img-element -- the person's own uploaded picture
    return <img src={person.picture} alt="" className={`${size} shrink-0 rounded-full object-cover`} />;
  }
  return (
    <span aria-hidden className={`${size} flex shrink-0 items-center justify-center rounded-full bg-surface text-sm font-semibold`}>
      {(person?.name ?? "?").slice(0, 1).toLocaleUpperCase()}
    </span>
  );
}

/**
 * A line about the conversation itself (it ended, it was opened again, waiting for a person, a person joined or left, the assistant
 * is back), in the site's words; kinds the widget has no words for are left out (the sign-in card a person sends is drawn by the list).
 */
function SystemLine({ message, labels }: { message: VisitorMessage; labels: ChatLabels }) {
  const name = (message.data as { name?: unknown } | undefined)?.name;
  const byKind: Record<string, string> = {
    ended: labels.lines.ended,
    reopened: labels.lines.reopened,
    queued: labels.lines.queued,
    joined: labels.lines.joined.replace("{name}", typeof name === "string" ? name : ""),
    left: labels.lines.left.replace("{name}", typeof name === "string" ? name : ""),
    assistant_back: labels.lines.assistantBack,
  };
  const words = (message.kind ? byKind[message.kind] : undefined) ?? actionLine(message.kind, message.data, labels.actions);
  if (!words) return null;
  return (
    <li className="flex justify-center">
      <p className="text-center text-xs text-muted">{words}</p>
    </li>
  );
}

/** A product the agent found, with the site's own price display (never the model's words). */
export function ProductCard({ product, locale, labels, onOpen }: { product: ChatProduct; locale: string; labels: ChatLabels; onOpen: () => void }) {
  const { price } = product;
  return (
    <Link href={product.href} onClick={onOpen} className="product-card flex h-full flex-col overflow-hidden rounded-lg border border-border text-sm hover:bg-surface">
      {product.image ? (
        // eslint-disable-next-line @next/next/no-img-element -- the catalogue's own thumbnail
        <img src={product.image.url} alt={product.image.alt} className="product-card-image aspect-square w-full object-cover" loading="lazy" />
      ) : (
        <span aria-hidden className="aspect-square w-full bg-surface" />
      )}
      <span className="flex flex-1 flex-col gap-1 p-2">
        <span className="line-clamp-2 font-medium">{product.title}</span>
        {product.offers && product.offers.length > 0 && (
          <span className="flex flex-wrap gap-1">
            {product.offers.map((offer) => (
              <span key={offer} className="rounded-button bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
                {offer}
              </span>
            ))}
          </span>
        )}
        <span className="font-semibold">
          {product.from && <span className="font-normal">{labels.fromPrice} </span>}
          <VatAmount amountMinor={price.amountMinor} currency={price.currency} locale={locale} vat={price.vat} labels={labels} />
        </span>
        {price.referenceMinor !== null && (
          <span className="text-xs text-muted">
            {labels.priorPrice}: <VatAmount amountMinor={price.referenceMinor} currency={price.currency} locale={locale} vat={price.vat} labels={labels} label={false} />
          </span>
        )}
        <UnitLine amountMinor={price.amountMinor} currency={price.currency} locale={locale} vat={price.vat} measure={price.measure} labels={labels.unit} inline />
      </span>
    </Link>
  );
}
