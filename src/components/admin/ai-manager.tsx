"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";

import { matchPath } from "@/lib/admin-map";
import { TOOL_WORDS } from "@/lib/manager-tools";
import { GATE_WORDS } from "@/lib/owner-tools";
import type { Approval, AssistantEvent, AssistantMessage, Conversation, ConversationSummary } from "@/server/owner-assistant";

type Result<T> = ({ ok: true } & T) | { ok: false; problem: string };

export type Abilities = { text: boolean; hear: boolean; speak: boolean };

export type AiManagerActions = {
  decide: (approvalId: string, approve: boolean) => Promise<Approval | null>;
  remove: (conversationId: string) => Promise<boolean>;
  load: (conversationId: string) => Promise<Conversation | null>;
  rate: (messageId: string, value: 1 | -1 | null) => Promise<boolean>;
  hear: ((form: FormData) => Promise<Result<{ text: string }>>) | null;
  speak: ((text: string) => Promise<Result<{ audio: string }>>) | null;
};

const button = "inline-flex min-h-10 items-center justify-center rounded-md px-4 text-sm font-medium disabled:opacity-50";
const primary = `${button} bg-foreground text-background`;
const secondary = `${button} border border-border hover:bg-surface`;
const chip = "rounded-full border border-border px-3 py-1.5 text-left text-sm hover:bg-surface";

const STARTERS: Record<"store" | "platform", string[]> = {
  store: ["How is the store doing this week?", "What needs my attention?", "What should I do next to get ready?", "How do I run a sale?"],
  platform: ["How is Kaizen doing?", "Who is waiting for access?", "Which emails failed?", "Show me the stores without a plan."],
};

/** The browser's recording formats, best first. */
function recorderType(): string | undefined {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  return types.find((type) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type));
}

/** Text with the admin's own paths and web addresses as links; the rest stays text, never HTML. */
function Linked({ text, onOpen }: { text: string; onOpen?: () => void }) {
  const parts: ReactNode[] = [];
  const pattern = /(\/admin\/[A-Za-z0-9/_-]+|https:\/\/[^\s)]+)/g;
  let at = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > at) parts.push(text.slice(at, index));
    const href = match[0].replace(/[.,;:]+$/, "");
    parts.push(
      href.startsWith("/") ? (
        <Link key={index} href={href} className="underline" onClick={onOpen}>
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
 * The AI manager's conversation (D94, D103): the site's AI working for the
 * person in the admin, as a full page or as the panel the launcher opens on
 * every admin page. They type or talk; the answer streams in as it is
 * written, with a line saying what it is doing. It can open admin pages for
 * them (in the panel, at once; on its own page, as a link). Changes that
 * send, publish or cost money come as cards to approve or decline, and
 * answers take a thumb up or down, which it learns from.
 */
export function AiManagerChat({
  area,
  base,
  siteName,
  settingsHref,
  abilities,
  conversations: initialList,
  conversation,
  actions,
  variant,
  inputRef: givenInputRef,
  onNavigate,
}: {
  area: "store" | "platform";
  /** The AI manager's page; its turn route is `{base}/turn`. */
  base: string;
  siteName: string;
  settingsHref: string;
  abilities: Abilities;
  conversations: ConversationSummary[];
  conversation: Conversation | null;
  actions: AiManagerActions;
  variant: "page" | "panel";
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  /** The panel closes on phones when it opens a page. */
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const inputId = useId();
  const ownInputRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = givenInputRef ?? ownInputRef;
  const [list, setList] = useState(initialList);
  const [showList, setShowList] = useState(false);
  const [conversationId, setConversationId] = useState(conversation?.id ?? null);
  const [messages, setMessages] = useState<AssistantMessage[]>(conversation?.messages ?? []);
  const [approvals, setApprovals] = useState<Approval[]>(conversation?.approvals ?? []);
  const [opened, setOpened] = useState<{ href: string; label: string }[]>([]);
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const sendRef = useRef<(text: string) => void>(() => undefined);
  const panel = variant === "panel";

  useEffect(() => {
    const box = scrollRef.current;
    if (box && panel) box.scrollTop = box.scrollHeight;
    else if (box) box.lastElementChild?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages, approvals, streaming, working, panel]);

  const say = async (text: string) => {
    if (!aloud || !actions.speak) return;
    const spoken = await actions.speak(text);
    if (!spoken.ok) return;
    audioRef.current?.pause();
    const audio = new Audio(`data:audio/mpeg;base64,${spoken.audio}`);
    audioRef.current = audio;
    void audio.play().catch(() => undefined);
  };

  function remember(id: string | null) {
    if (!panel) window.history.replaceState(window.history.state, "", id ? `${base}?c=${id}` : base);
  }

  function startNew() {
    abortRef.current?.abort();
    setConversationId(null);
    setMessages([]);
    setApprovals([]);
    setOpened([]);
    setProblem(null);
    setShowList(false);
    remember(null);
    inputRef.current?.focus();
  }

  async function open(id: string) {
    setShowList(false);
    const found = await actions.load(id);
    if (!found) return setProblem("That conversation is gone.");
    setConversationId(found.id);
    setMessages(found.messages);
    setApprovals(found.approvals);
    setOpened([]);
    setProblem(null);
    remember(found.id);
  }

  async function send(text: string) {
    const words = text.trim();
    if (!words || busy) return;
    setDraft("");
    setProblem(null);
    setBusy(true);
    setStreaming("");
    setOpened([]);
    setWorking("Thinking");
    setMessages((current) => [...current, { id: `local-${Date.now()}`, role: "user", content: words, tools: [], feedback: null, createdAt: new Date().toISOString() }]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch(`${base}/turn`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, message: words, path: window.location.pathname }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error((await response.json().catch(() => null))?.error ?? "The AI manager could not be reached.");
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
      if (!controller.signal.aborted) setProblem(error instanceof Error ? error.message : "The AI manager could not be reached.");
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
        remember(event.id);
        return;
      case "text":
        setWorking(null);
        setStreaming((current) => current + event.delta);
        return;
      case "round":
        setStreaming("");
        setWorking(event.tools.map((name) => TOOL_WORDS[name] ?? "Working").filter((v, i, all) => all.indexOf(v) === i).join(" · "));
        return;
      case "navigate":
        setOpened((current) => [...current, { href: event.href, label: event.label }]);
        // In the panel the page opens behind it; its own page offers a link instead of leaving the conversation.
        if (panel) {
          router.push(event.href);
          onNavigate?.();
        }
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
    router.refresh();
  }

  async function rate(message: AssistantMessage, value: 1 | -1) {
    const next = message.feedback === value ? null : value;
    setMessages((current) => current.map((m) => (m.id === message.id ? { ...m, feedback: next } : m)));
    if (!(await actions.rate(message.id, next))) setMessages((current) => current.map((m) => (m.id === message.id ? message : m)));
  }

  async function removeConversation(id: string) {
    if (!window.confirm("Delete this conversation?")) return;
    if (!(await actions.remove(id))) return;
    setList((current) => current.filter((c) => c.id !== id));
    if (id === conversationId) startNew();
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
      <p className="m-4 rounded-lg border border-border p-4 text-sm">
        The AI manager uses {area === "store" ? "the store's" : "Kaizen's"} AI and needs a text model.{" "}
        <Link href={settingsHref} className="underline" onClick={onNavigate}>
          Set one up under AI
        </Link>
        .
      </p>
    );
  }

  // Suggestions: about the page they are on, then the usual ones.
  const here = matchPath(pathname);
  const onPage = here && here.page.id !== "assistant" && (here.page.area === area || here.page.area === "account") ? here.page : null;
  const starters = [...(onPage ? [`Help me with ${onPage.title.toLowerCase()}: what can I do here?`] : []), ...STARTERS[area]];

  // Messages in order, each approval under the answer of the turn that asked for it (saved after it).
  const thread: ReactNode[] = [];
  const shown = new Set<string>();
  for (const message of messages) {
    thread.push(<Bubble key={message.id} message={message} onRate={rate} onOpen={onNavigate} />);
    if (message.role !== "assistant" || !message.createdAt) continue;
    for (const approval of approvals) {
      if (shown.has(approval.id) || approval.createdAt > message.createdAt) continue;
      shown.add(approval.id);
      thread.push(<ApprovalCard key={approval.id} approval={approval} onDecide={decide} />);
    }
  }
  // Asked for in the turn still being answered.
  const waiting = approvals.filter((a) => !shown.has(a.id));

  const history = (
    <ul className="flex flex-col gap-1">
      {list.length === 0 && <li className="px-2 py-2 text-sm text-muted">No conversations yet.</li>}
      {list.map((c) => (
        <li key={c.id} className={`flex items-center gap-1 rounded-md ${c.id === conversationId ? "bg-surface" : ""}`}>
          <button
            type="button"
            onClick={() => void open(c.id)}
            className="min-w-0 flex-1 truncate px-2 py-2 text-left text-sm"
            aria-current={c.id === conversationId ? "true" : undefined}
          >
            {c.title || "Conversation"}
          </button>
          <button type="button" onClick={() => void removeConversation(c.id)} className="px-2 text-sm text-muted hover:text-foreground" aria-label={`Delete "${c.title}"`}>
            ×
          </button>
        </li>
      ))}
    </ul>
  );

  const conversationView = (
    <section aria-label="Conversation with the AI manager" className={`flex min-h-0 flex-col ${panel ? "flex-1" : "min-h-[60dvh] gap-4"}`}>
      {panel && (
        <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-sm">
          <button type="button" className="rounded px-2 py-1 hover:bg-surface" onClick={startNew}>
            New
          </button>
          <button type="button" className="rounded px-2 py-1 hover:bg-surface" aria-expanded={showList} onClick={() => setShowList((v) => !v)}>
            Earlier
          </button>
          <Link href={conversationId ? `${base}?c=${conversationId}` : base} className="ml-auto rounded px-2 py-1 text-muted hover:bg-surface" onClick={onNavigate}>
            Full page
          </Link>
        </div>
      )}
      {panel && showList ? (
        <nav aria-label="Earlier conversations" className="flex-1 overflow-y-auto p-2">
          {history}
        </nav>
      ) : (
        <div ref={scrollRef} className={`flex flex-1 flex-col gap-3 ${panel ? "overflow-y-auto p-4" : ""}`} aria-live="polite">
          {thread.length === 0 && !busy && (
            <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
              <p className="text-sm">
                {area === "store"
                  ? `I know every part of ${siteName}'s admin, can look at orders, products, customers and sales, and can take you to the right page. Changes that email customers, change the site or cost money wait for your yes.`
                  : "I know every part of Kaizen's admin, can look at requests, stores, plans and emails, and can take you to the right page. Approvals and emails wait for your yes."}
              </p>
              <div className="flex flex-wrap gap-2">
                {starters.map((s) => (
                  <button key={s} type="button" className={chip} onClick={() => void send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {thread}
          {streaming && <Bubble message={{ id: "streaming", role: "assistant", content: streaming, tools: [], feedback: null, createdAt: "" }} />}
          {waiting.map((approval) => (
            <ApprovalCard key={approval.id} approval={approval} onDecide={decide} />
          ))}
          {opened.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {opened.map((o) => (
                <Link key={o.href} href={o.href} className={chip} onClick={onNavigate}>
                  {panel ? `Opened ${o.label}` : `Go to ${o.label} →`}
                </Link>
              ))}
            </div>
          )}
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
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
        className={`flex flex-col gap-2 border-t border-border bg-background ${panel ? "p-3" : "sticky bottom-0 pt-3"}`}
      >
        <label htmlFor={inputId} className="sr-only">
          Message to the AI manager
        </label>
        <textarea
          id={inputId}
          ref={inputRef}
          value={draft}
          rows={2}
          maxLength={4000}
          placeholder="Ask or tell the AI manager …"
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
              Read aloud
            </label>
          )}
        </div>
      </form>
    </section>
  );

  if (panel) return conversationView;
  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
      <nav aria-label="Conversations" className="flex flex-col gap-2">
        <button type="button" onClick={startNew} className={secondary}>
          New conversation
        </button>
        <div className="max-h-[60dvh] overflow-y-auto">{history}</div>
      </nav>
      {conversationView}
    </div>
  );
}

function Bubble({ message, onRate, onOpen }: { message: AssistantMessage; onRate?: (message: AssistantMessage, value: 1 | -1) => void; onOpen?: () => void }) {
  const mine = message.role === "user";
  const rateable = !mine && onRate && !message.id.startsWith("local-") && message.id !== "streaming";
  return (
    <div className={`flex flex-col gap-1 ${mine ? "items-end" : "items-start"}`}>
      <p className={`max-w-[46rem] whitespace-pre-wrap wrap-anywhere rounded-lg px-3 py-2 text-sm ${mine ? "bg-foreground text-background" : "bg-surface"}`}>
        {mine ? message.content : <Linked text={message.content} onOpen={onOpen} />}
      </p>
      {(message.tools.length > 0 || rateable) && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          {message.tools.length > 0 && (
            <span>
              Used: {[...new Set(message.tools.map((t) => t.name.replaceAll("_", " ")))].join(", ")}
              {message.tools.some((t) => !t.ok) ? " (some answered with a problem)" : ""}
            </span>
          )}
          {rateable && (
            <span className="flex gap-1">
              <button
                type="button"
                aria-pressed={message.feedback === 1}
                aria-label="Good answer"
                title="Good answer"
                onClick={() => onRate(message, 1)}
                className={`rounded px-1.5 py-0.5 hover:bg-surface ${message.feedback === 1 ? "bg-surface text-foreground" : ""}`}
              >
                👍
              </button>
              <button
                type="button"
                aria-pressed={message.feedback === -1}
                aria-label="Not helpful"
                title="Not helpful"
                onClick={() => onRate(message, -1)}
                className={`rounded px-1.5 py-0.5 hover:bg-surface ${message.feedback === -1 ? "bg-surface text-foreground" : ""}`}
              >
                👎
              </button>
            </span>
          )}
        </div>
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
