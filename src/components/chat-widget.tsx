"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { MESSAGE_MAX, type ChatProduct } from "@/lib/chat";
import { readSession, signalsOf } from "@/lib/recommend-session";
import {
  STORAGE_KEY,
  lastSeqOf,
  mergeMessages,
  readStored,
  storedValue,
  pollDelay,
  type ConversationRef,
  type StoredConversation,
  type VisitorMessage,
  type VisitorReply,
  type VisitorState,
} from "@/lib/support-visitor";

import type { UnitLabels } from "@/lib/unit-price-text";

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
  /** How long the site keeps the conversation (D216, legal: needs review). */
  kept: string;
  /** The words of the conversation's system lines, by kind; `{name}` stands for a person's name. */
  lines: { ended: string; reopened: string; queued: string; joined: string; left: string; assistantBack: string };
  /** The card asking the customer to sign in (D216, step 4), and its button. */
  signIn: string;
  signInButton: string;
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
  agent: { name: string; occupation: string; avatar: { url: string; width: number; height: number } | null; voice: boolean };
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
export function ChatWidget({ site, signInHref, locale, agent, labels }: ChatWidgetProps) {
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
  const conversationId = stored.conversation?.id ?? null;
  const live = loaded && conversationId !== null && stored.status === "open";
  const handler = state?.handler ?? "ai";
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
      const delay = pollDelay({ status: "open", handler }, hidden);
      if (!stopped && delay !== null) timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, pollDelay({ status: "open", handler }, !openRef.current) ?? 10_000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [live, conversationId, handler, site]);
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

  // A person who has taken the conversation over is shown instead of the AI persona, never with the AI label (D216, S11).
  const person = state?.status === "open" && state.handler === "human" ? state.agent : null;

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
          aria-label={`${agent.name}, ${labels.aiAssistant}`}
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
                <SystemLine key={message.seq} message={message} labels={labels} signInHref={signInHref} signedIn={state?.signedIn ?? false} />
              ) : message.author === "agent" ? (
                <li key={message.seq} className="flex flex-col gap-1">
                  <span className="ml-9 text-xs text-muted">{agentOf(message)?.name ?? ""}</span>
                  <div className="flex items-end gap-2">
                    <PersonPicture person={agentOf(message)} size="size-7" />
                    <p className="max-w-[85%] rounded-2xl rounded-bl-sm bg-surface px-3 py-2 whitespace-pre-line">{message.body}</p>
                  </div>
                </li>
              ) : (
                <li key={message.seq} className="flex flex-col gap-2">
                  <div className="flex items-end gap-2">
                    {avatar("size-7")}
                    <p className="max-w-[85%] rounded-2xl rounded-bl-sm bg-surface px-3 py-2 whitespace-pre-line">{message.body}</p>
                  </div>
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
                onChange={(event) => setDraft(event.target.value)}
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
              {labels.disclaimer} {labels.kept}
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
          aria-label={`${labels.open}: ${agent.name}, ${labels.aiAssistant}`}
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
 * is back), in the site's words, and the card asking the customer to sign in; kinds the widget has no words for are left out.
 */
function SystemLine({ message, labels, signInHref, signedIn }: { message: VisitorMessage; labels: ChatLabels; signInHref?: string; signedIn: boolean }) {
  if (message.kind === "sign_in") {
    if (!signInHref || signedIn) return null;
    return (
      <li className="flex flex-col items-start gap-2 rounded-lg border border-border p-3 text-sm">
        <p>{labels.signIn}</p>
        <a href={signInHref} className="button-primary rounded-button px-3 py-1.5">
          {labels.signInButton}
        </a>
      </li>
    );
  }
  const name = (message.data as { name?: unknown } | undefined)?.name;
  const byKind: Record<string, string> = {
    ended: labels.lines.ended,
    reopened: labels.lines.reopened,
    queued: labels.lines.queued,
    joined: labels.lines.joined.replace("{name}", typeof name === "string" ? name : ""),
    left: labels.lines.left.replace("{name}", typeof name === "string" ? name : ""),
    assistant_back: labels.lines.assistantBack,
  };
  const words = message.kind ? byKind[message.kind] : undefined;
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
