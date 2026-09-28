"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { HISTORY_MAX, MESSAGE_MAX, type ChatAction, type ChatProduct, type ChatReply } from "@/lib/chat";

import { Icon } from "./icons";
import { VatAmount } from "./price";

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
  vatIncluded: string;
  vatExcluded: string;
  fromPrice: string;
  priorPrice: string;
};

export type ChatWidgetProps = {
  /** Which site the messages are for: a store in one of its countries, or Kaizen's (neither). */
  site: { store?: string; market?: string };
  locale: string;
  agent: { name: string; occupation: string; avatar: { url: string; width: number; height: number } | null; voice: boolean };
  labels: ChatLabels;
};

type Message = {
  role: "user" | "assistant";
  content: string;
  products?: ChatProduct[];
  actions?: ChatAction[];
  /** A notice from the widget (a limit, an error): shown, never sent to the agent. */
  notice?: boolean;
};

/** The conversation is kept in the tab only (`kaizen_chat`, D58), for the site it was held on. */
const STORAGE = "kaizen_chat";
/** A spoken message's longest recording. */
const RECORDING_MS = 60_000;

function readStored(key: string): Message[] {
  try {
    const stored = JSON.parse(sessionStorage.getItem(STORAGE) ?? "null") as { site?: string; messages?: Message[] } | null;
    return stored?.site === key && Array.isArray(stored.messages) ? stored.messages.slice(-40) : [];
  } catch {
    return [];
  }
}

function writeStored(key: string, messages: Message[]) {
  try {
    if (messages.length === 0) sessionStorage.removeItem(STORAGE);
    else sessionStorage.setItem(STORAGE, JSON.stringify({ site: key, messages: messages.slice(-40) }));
  } catch {
    // Private windows and full storage: the conversation lasts as long as the page.
  }
}

/** What the agent is sent: the conversation's last messages, without the widget's own notices. */
const history = (messages: Message[]) =>
  messages
    .filter((message) => !message.notice)
    .slice(-HISTORY_MAX)
    .map((message) => ({ role: message.role, content: message.content.slice(0, MESSAGE_MAX) }));

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
 */
export function ChatWidget({ site, locale, agent, labels }: ChatWidgetProps) {
  const router = useRouter();
  const key = `${site.store ?? ""}/${site.market ?? ""}`;
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const panelId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (loaded) writeStored(key, messages);
  }, [key, loaded, messages]);
  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: "end" });
  }, [messages, waiting, open]);
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

  const received = useCallback(
    (reply: ChatReply) => {
      setMessages((current) => [...current, { role: "assistant", content: reply.reply, products: reply.products, actions: reply.actions }]);
      const go = reply.actions.find((action) => action.type === "navigate");
      if (go) {
        router.push(go.href);
        // On a phone the conversation covers the page, so it steps aside to show it.
        if (phone()) setOpen(false);
      }
    },
    [router],
  );

  const notice = (content: string) => setMessages((current) => [...current, { role: "assistant", content, notice: true }]);

  async function sendText(text: string) {
    const content = text.trim().slice(0, MESSAGE_MAX);
    if (!content || waiting) return;
    const next: Message[] = [...messages, { role: "user", content }];
    setMessages(next);
    setDraft("");
    setWaiting(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...site, path: window.location.pathname, messages: history(next) }),
      });
      const body = (await response.json().catch(() => ({}))) as Partial<ChatReply> & { error?: string };
      if (!response.ok || typeof body.reply !== "string") notice(body.error ?? labels.sorry);
      else received({ reply: body.reply, actions: body.actions ?? [], products: body.products ?? [] });
    } catch {
      notice(labels.sorry);
    } finally {
      setWaiting(false);
    }
  }

  async function sendRecording(audio: Blob) {
    setWaiting(true);
    try {
      const form = new FormData();
      form.set("audio", audio, "message");
      form.set("request", JSON.stringify({ ...site, path: window.location.pathname, messages: history(messages) }));
      const response = await fetch("/api/chat/voice", { method: "POST", body: form });
      const body = (await response.json().catch(() => ({}))) as Partial<ChatReply> & { error?: string; transcript?: string; audio?: string | null };
      if (!response.ok || typeof body.reply !== "string") {
        notice(body.error ?? labels.sorry);
        return;
      }
      if (body.transcript) setMessages((current) => [...current, { role: "user", content: body.transcript! }]);
      received({ reply: body.reply, actions: body.actions ?? [], products: body.products ?? [] });
      if (body.audio) {
        audioRef.current?.pause();
        audioRef.current = new Audio(`data:audio/mpeg;base64,${body.audio}`);
        void audioRef.current.play().catch(() => undefined);
      }
    } catch {
      notice(labels.sorry);
    } finally {
      setWaiting(false);
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

  function restart() {
    recorderRef.current?.stop();
    audioRef.current?.pause();
    setMessages([]);
    inputRef.current?.focus();
  }

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
            {avatar("size-10")}
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{agent.name}</p>
              <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted">
                {agent.occupation && <span className="truncate">{agent.occupation}</span>}
                <span className="shrink-0 rounded-button bg-accent px-1.5 py-0.5 text-xs whitespace-nowrap text-accent-foreground">{labels.aiAssistant}</span>
              </p>
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

          <ol ref={listRef} aria-label={labels.conversation} aria-live="polite" className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
            <li className="flex items-end gap-2">
              {avatar("size-7")}
              <p className="max-w-[85%] rounded-2xl rounded-bl-sm bg-surface px-3 py-2 whitespace-pre-line">{labels.greeting}</p>
            </li>
            {messages.map((message, index) =>
              message.role === "user" ? (
                <li key={index} className="flex justify-end">
                  <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-foreground px-3 py-2 whitespace-pre-line text-background">{message.content}</p>
                </li>
              ) : (
                <li key={index} className="flex flex-col gap-2">
                  <div className="flex items-end gap-2">
                    {avatar("size-7")}
                    <p className={`max-w-[85%] rounded-2xl rounded-bl-sm px-3 py-2 whitespace-pre-line ${message.notice ? "border border-border text-muted" : "bg-surface"}`}>
                      {message.content}
                    </p>
                  </div>
                  {message.actions?.map((action) => (
                    <Link
                      key={action.href}
                      href={action.href}
                      onClick={() => phone() && setOpen(false)}
                      className="ml-9 self-start rounded-button border border-border px-3 py-1 text-sm hover:bg-surface"
                    >
                      {labels.opened.replace("{label}", action.label)} →
                    </Link>
                  ))}
                  {message.products && message.products.length > 0 && (
                    <ul className="ml-9 flex snap-x gap-2 overflow-x-auto pb-1">
                      {message.products.map((product) => (
                        <li key={product.handle} className="w-36 shrink-0 snap-start">
                          <ProductCard product={product} locale={locale} labels={labels} onOpen={() => phone() && setOpen(false)} />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ),
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
            <p className="mt-2 text-xs text-muted">{labels.disclaimer}</p>
          </form>
        </section>
      )}

      {!open && (
        <button
          ref={launcherRef}
          type="button"
          onClick={() => {
            // The conversation so far in this tab, read when the chat is first opened.
            if (!loaded) {
              setMessages(readStored(key));
              setLoaded(true);
            }
            setOpen(true);
          }}
          aria-expanded={false}
          aria-label={`${labels.open}: ${agent.name}, ${labels.aiAssistant}`}
          className="fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[55] flex items-center gap-2 rounded-full bg-foreground p-1 text-background shadow-lg md:right-6 md:bottom-6 md:pr-4"
        >
          {avatar("size-12")}
          <span className="hidden text-sm font-medium md:inline">{labels.open}</span>
        </button>
      )}
    </div>
  );
}

/** A product the agent found, with the site's own price display (never the model's words). */
function ProductCard({ product, locale, labels, onOpen }: { product: ChatProduct; locale: string; labels: ChatLabels; onOpen: () => void }) {
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
        <span className="font-semibold">
          {product.from && <span className="font-normal">{labels.fromPrice} </span>}
          <VatAmount amountMinor={price.amountMinor} currency={price.currency} locale={locale} vat={price.vat} labels={labels} />
        </span>
        {price.referenceMinor !== null && (
          <span className="text-xs text-muted">
            {labels.priorPrice}: <VatAmount amountMinor={price.referenceMinor} currency={price.currency} locale={locale} vat={price.vat} labels={labels} label={false} />
          </span>
        )}
      </span>
    </Link>
  );
}
