"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { GATE_WORDS } from "@/lib/owner-tools";
import type { Approval, AssistantEvent, AssistantMessage, Conversation, ConversationSummary } from "@/server/owner-assistant";

type Result<T> = ({ ok: true } & T) | { ok: false; problem: string };

export type OwnerAssistantActions = {
  decide: (approvalId: string, approve: boolean) => Promise<Approval | null>;
  remove: (conversationId: string) => Promise<boolean>;
  hear: ((form: FormData) => Promise<Result<{ text: string }>>) | null;
  speak: ((text: string) => Promise<Result<{ audio: string }>>) | null;
};

const button = "inline-flex min-h-10 items-center justify-center rounded-md px-4 text-sm font-medium disabled:opacity-50";
const primary = `${button} bg-foreground text-background`;
const secondary = `${button} border border-border hover:bg-surface`;

/** What the owner sees while a tool runs. */
const TOOL_WORDS: Record<string, string> = {
  store_overview: "Looking at the store",
  sales_summary: "Adding up sales",
  list_orders: "Looking at orders",
  get_order: "Reading the order",
  list_products: "Looking at products",
  get_product: "Reading the product",
  low_stock: "Checking stock",
  list_bookings: "Looking at bookings",
  list_discounts: "Looking at coupons",
  list_pages: "Looking at pages",
  search_insights: "Looking at searches",
  add_order_note: "Adding a note",
  mark_order_sent: "Preparing the shipment",
  cancel_booking: "Preparing the cancellation",
  archive_product: "Preparing the change",
  unpublish_page: "Preparing the change",
};

const SUGGESTIONS = [
  "How did sales go this week?",
  "Which orders are waiting to be sent?",
  "What is running low in stock?",
  "What did shoppers search for and not find?",
];

/** The browser's recording formats, best first. */
function recorderType(): string | undefined {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  return types.find((type) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type));
}

/** Text with the admin's own paths and web addresses as links; the rest stays text, never HTML. */
function Linked({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const pattern = /(\/admin\/[A-Za-z0-9/_-]+|https:\/\/[^\s)]+)/g;
  let at = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > at) parts.push(text.slice(at, index));
    const href = match[0].replace(/[.,;:]+$/, "");
    parts.push(
      href.startsWith("/") ? (
        <Link key={index} href={href} className="underline">
          {href}
        </Link>
      ) : (
        <a key={index} href={href} target="_blank" rel="noopener noreferrer" className="underline">
          {href}
        </a>
      ),
    );
    at = index + href.length;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

/**
 * The owner assistant (D94): the store's AI working for its owner in the
 * admin. The owner types or talks; the answer streams in as it is written,
 * with a line saying which tools it is using. Changes that send, publish or
 * cost money come as cards to approve or decline; approving runs exactly
 * the kept call. Conversations are listed beside it.
 */
export function OwnerAssistant({
  storeSlug,
  storeName,
  abilities,
  conversations: initialList,
  conversation,
  actions,
}: {
  storeSlug: string;
  storeName: string;
  abilities: { text: boolean; hear: boolean; speak: boolean };
  conversations: ConversationSummary[];
  conversation: Conversation | null;
  actions: OwnerAssistantActions;
}) {
  const inputId = useId();
  const base = `/admin/${storeSlug}/assistant`;
  const [list, setList] = useState(initialList);
  const [conversationId, setConversationId] = useState(conversation?.id ?? null);
  const [messages, setMessages] = useState<AssistantMessage[]>(conversation?.messages ?? []);
  const [approvals, setApprovals] = useState<Approval[]>(conversation?.approvals ?? []);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState("");
  const [working, setWorking] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [aloud, setAloud] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const sendRef = useRef<(text: string) => void>(() => undefined);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages, approvals, streaming, working]);

  const say = async (text: string) => {
    if (!aloud || !actions.speak) return;
    const spoken = await actions.speak(text);
    if (!spoken.ok) return;
    audioRef.current?.pause();
    const audio = new Audio(`data:audio/mpeg;base64,${spoken.audio}`);
    audioRef.current = audio;
    void audio.play().catch(() => undefined);
  };

  async function send(text: string) {
    const words = text.trim();
    if (!words || busy) return;
    setDraft("");
    setProblem(null);
    setBusy(true);
    setStreaming("");
    setWorking("Thinking");
    setMessages((current) => [...current, { id: `local-${Date.now()}`, role: "user", content: words, tools: [], createdAt: new Date().toISOString() }]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch(`${base}/turn`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, message: words }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error((await response.json().catch(() => null))?.error ?? "The assistant could not be reached.");
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) handle(JSON.parse(line) as AssistantEvent);
      }
    } catch (error) {
      if (!controller.signal.aborted) setProblem(error instanceof Error ? error.message : "The assistant could not be reached.");
    } finally {
      abortRef.current = null;
      setBusy(false);
      setWorking(null);
      setStreaming("");
    }
  }
  sendRef.current = (text) => void send(text);

  function handle(event: AssistantEvent) {
    switch (event.type) {
      case "conversation":
        setConversationId(event.id);
        setList((current) => [{ id: event.id, title: event.title, updatedAt: new Date().toISOString() }, ...current]);
        window.history.replaceState(window.history.state, "", `${base}?c=${event.id}`);
        return;
      case "text":
        setWorking(null);
        setStreaming((current) => current + event.delta);
        return;
      case "round":
        setStreaming("");
        setWorking(event.tools.map((name) => TOOL_WORDS[name] ?? "Working").filter((v, i, all) => all.indexOf(v) === i).join(" · "));
        return;
      case "approval":
        setApprovals((current) => [...current, event.approval]);
        return;
      case "done":
        setMessages((current) => [...current, event.message]);
        setStreaming("");
        void say(event.message.content);
        return;
      case "error":
        setProblem(event.message);
        return;
    }
  }

  async function decide(approval: Approval, approve: boolean) {
    setApprovals((current) => current.map((a) => (a.id === approval.id ? { ...a, status: approve ? "done" : "declined", outcome: approve ? "Working …" : null } : a)));
    const decided = await actions.decide(approval.id, approve);
    if (!decided) {
      setProblem("That change was already decided.");
      return;
    }
    setApprovals((current) => current.map((a) => (a.id === decided.id ? decided : a)));
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this conversation?")) return;
    if (!(await actions.remove(id))) return;
    setList((current) => current.filter((c) => c.id !== id));
    if (id === conversationId) {
      setConversationId(null);
      setMessages([]);
      setApprovals([]);
      window.history.replaceState(window.history.state, "", base);
    }
  }

  async function talk() {
    const hear = actions.hear;
    if (!hear) return;
    if (recorderRef.current) {
      recorderRef.current.stop();
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setProblem("The browser did not let the page use the microphone.");
      return;
    }
    audioRef.current?.pause();
    const type = recorderType();
    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    const limit = window.setTimeout(() => recorder.state === "recording" && recorder.stop(), 60_000);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      window.clearTimeout(limit);
      stream.getTracks().forEach((track) => track.stop());
      recorderRef.current = null;
      setRecording(false);
      const audio = new Blob(chunks, { type: recorder.mimeType || type || "audio/webm" });
      if (audio.size === 0) return;
      const form = new FormData();
      form.set("audio", audio, "message");
      setWorking("Listening");
      void (async () => {
        const heard = await hear(form);
        setWorking(null);
        if (!heard.ok) return setProblem(heard.problem);
        sendRef.current(heard.text);
      })();
    };
    recorderRef.current = recorder;
    recorder.start();
    setRecording(true);
  }

  if (!abilities.text) {
    return (
      <p className="rounded-lg border border-border p-4 text-sm">
        The assistant uses the store&apos;s AI and needs a text model.{" "}
        <Link href={`/admin/${storeSlug}/settings/ai`} className="underline">
          Set one up under AI
        </Link>
        .
      </p>
    );
  }

  // Messages in order, each approval under the answer of the turn that asked for it (saved after it).
  const thread: ReactNode[] = [];
  const shown = new Set<string>();
  for (const message of messages) {
    thread.push(<Bubble key={message.id} message={message} />);
    if (message.role !== "assistant" || !message.createdAt) continue;
    for (const approval of approvals) {
      if (shown.has(approval.id) || approval.createdAt > message.createdAt) continue;
      shown.add(approval.id);
      thread.push(<ApprovalCard key={approval.id} approval={approval} onDecide={decide} />);
    }
  }
  // Asked for in the turn still being answered.
  const waiting = approvals.filter((a) => !shown.has(a.id));

  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
      <nav aria-label="Conversations" className="flex flex-col gap-2">
        <Link
          href={base}
          onClick={(event) => {
            event.preventDefault();
            setConversationId(null);
            setMessages([]);
            setApprovals([]);
            setProblem(null);
            window.history.replaceState(window.history.state, "", base);
          }}
          className={secondary}
        >
          New conversation
        </Link>
        <ul className="flex max-h-[60dvh] flex-col gap-1 overflow-y-auto">
          {list.map((c) => (
            <li key={c.id} className={`group flex items-center gap-1 rounded-md ${c.id === conversationId ? "bg-surface" : ""}`}>
              <a href={`${base}?c=${c.id}`} className="min-w-0 flex-1 truncate px-2 py-2 text-sm" aria-current={c.id === conversationId ? "page" : undefined}>
                {c.title || "Conversation"}
              </a>
              <button type="button" onClick={() => void remove(c.id)} className="px-2 text-sm text-muted hover:text-foreground" aria-label={`Delete "${c.title}"`}>
                ×
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <section aria-label={`${storeName}'s assistant`} className="flex min-h-[60dvh] flex-col gap-4">
        <div className="flex flex-1 flex-col gap-3" aria-live="polite">
          {thread.length === 0 && !busy && (
            <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
              <p className="text-sm">
                Ask about {storeName}: sales, orders, stock, bookings, pages or searches. Changes that email customers, change the site or cost money wait for your yes.
              </p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" className={secondary} onClick={() => void send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {thread}
          {streaming && <Bubble message={{ id: "streaming", role: "assistant", content: streaming, tools: [], createdAt: "" }} />}
          {waiting.map((approval) => (
            <ApprovalCard key={approval.id} approval={approval} onDecide={decide} />
          ))}
          {working && (
            <p className="text-sm text-muted" role="status">
              {working} …
            </p>
          )}
          {problem && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {problem}
            </p>
          )}
          <div ref={endRef} />
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send(draft);
          }}
          className="sticky bottom-0 flex flex-col gap-2 border-t border-border bg-background pt-3"
        >
          <label htmlFor={inputId} className="sr-only">
            Message
          </label>
          <textarea
            id={inputId}
            value={draft}
            rows={2}
            maxLength={4000}
            placeholder="Ask the assistant …"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send(draft);
              }
            }}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            {busy ? (
              <button type="button" className={secondary} onClick={() => abortRef.current?.abort()}>
                Stop
              </button>
            ) : (
              <button type="submit" className={primary} disabled={!draft.trim()}>
                Send
              </button>
            )}
            {abilities.hear && actions.hear && (
              <button type="button" className={secondary} onClick={() => void talk()} aria-pressed={recording} disabled={busy && !recording}>
                {recording ? "Stop and send" : "Talk"}
              </button>
            )}
            {abilities.speak && actions.speak && (
              <label className="ml-auto flex items-center gap-2 text-sm">
                <input type="checkbox" checked={aloud} onChange={(event) => setAloud(event.target.checked)} className="size-4" />
                Read answers aloud
              </label>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}

function Bubble({ message }: { message: AssistantMessage }) {
  const mine = message.role === "user";
  return (
    <div className={`flex flex-col gap-1 ${mine ? "items-end" : "items-start"}`}>
      <p className={`max-w-[46rem] whitespace-pre-wrap wrap-anywhere rounded-lg px-3 py-2 text-sm ${mine ? "bg-foreground text-background" : "bg-surface"}`}>
        {mine ? message.content : <Linked text={message.content} />}
      </p>
      {message.tools.length > 0 && (
        <p className="text-xs text-muted">
          Used: {[...new Set(message.tools.map((t) => t.name.replaceAll("_", " ")))].join(", ")}
          {message.tools.some((t) => !t.ok) ? " (some answered with a problem)" : ""}
        </p>
      )}
    </div>
  );
}

function ApprovalCard({ approval, onDecide }: { approval: Approval; onDecide: (approval: Approval, approve: boolean) => void }) {
  return (
    <div className="flex max-w-[46rem] flex-col gap-2 rounded-lg border border-border p-3" role="group" aria-label="Waiting for your approval">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{GATE_WORDS[approval.category]}</p>
      <p className="text-sm">{approval.summary}</p>
      {approval.status === "pending" ? (
        <div className="flex gap-2">
          <button type="button" className={primary} onClick={() => onDecide(approval, true)}>
            Approve
          </button>
          <button type="button" className={secondary} onClick={() => onDecide(approval, false)}>
            Decline
          </button>
        </div>
      ) : (
        <p className="text-sm text-muted">
          {approval.status === "declined" ? "Declined." : approval.status === "failed" ? `Could not: ${approval.outcome}` : (approval.outcome ?? "Done.")}
        </p>
      )}
    </div>
  );
}
