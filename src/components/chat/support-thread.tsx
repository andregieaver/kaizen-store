"use client";

import { useEffect, useRef, useState } from "react";

import { lastSeqOf, mergeMessages, pollDelay, type ConversationRef, type VisitorMessage, type VisitorReply, type VisitorState } from "@/lib/support-visitor";

/** The thread's words, in the conversation's language. */
export type SupportThreadLabels = {
  you: string;
  aiAssistant: string;
  placeholder: string;
  send: string;
  sorry: string;
  ended: string;
  lines: { ended: string; reopened: string; queued: string; joined: string; left: string; assistantBack: string };
};

const isReply = (body: unknown): body is VisitorReply => Boolean(body && typeof body === "object" && Array.isArray((body as VisitorReply).messages) && (body as VisitorReply).state);

/**
 * A support conversation opened from its answer email (D216, `docs/support.md` 2.3, step 5): the messages the customer may see, and a
 * box to answer in, through the chat's own routes with the email's token. It asks for what is new every few seconds while the page is
 * open. It keeps nothing in the browser: the token is in the address only.
 */
export function SupportThread({
  site,
  conversation: initialRef,
  initial,
  initialState,
  labels,
}: {
  site: { store?: string; market?: string };
  conversation: ConversationRef;
  initial: VisitorMessage[];
  initialState: Pick<VisitorState, "status" | "handler">;
  labels: SupportThreadLabels;
}) {
  const [ref, setRef] = useState(initialRef);
  const [messages, setMessages] = useState(initial);
  const [state, setState] = useState(initialState);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const lastSeq = useRef(lastSeqOf(initial));
  const listRef = useRef<HTMLOListElement>(null);

  const take = (reply: VisitorReply) => {
    setState(reply.state);
    if (reply.conversation?.token) {
      // The conversation had ended long ago and a new one started: it continues with the new conversation's token.
      setRef({ id: reply.conversation.id, token: reply.conversation.token });
      setMessages(reply.messages);
      lastSeq.current = lastSeqOf(reply.messages);
      return;
    }
    setMessages((current) => {
      const merged = mergeMessages(current, reply.messages);
      lastSeq.current = lastSeqOf(merged, lastSeq.current);
      return merged;
    });
  };

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const response = await fetch("/api/chat/feed", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...site, conversation: ref, after: lastSeq.current }),
        });
        const body = (await response.json().catch(() => ({}))) as unknown;
        if (!stopped && response.ok && isReply(body)) take(body);
      } catch {
        // The next time asks again.
      }
      const delay = pollDelay({ status: "open", handler: state.handler }, document.visibilityState === "hidden");
      if (!stopped && delay !== null) timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, 3000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [site, ref, state.handler]);

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: "end" });
  }, [messages]);

  async function send() {
    const message = draft.trim();
    if (!message || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...site, conversation: ref, after: lastSeq.current, message }),
      });
      const body = (await response.json().catch(() => ({}))) as unknown;
      if (response.ok && isReply(body)) {
        take(body);
        setDraft("");
        if (body.error) setProblem(body.error);
      } else setProblem((body as { error?: string }).error ?? labels.sorry);
    } catch {
      setProblem(labels.sorry);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ol ref={listRef} role="log" aria-live="polite" className="flex flex-col gap-3 rounded-lg border border-border p-4">
        {messages.map((message) => (
          <Line key={message.seq} message={message} labels={labels} />
        ))}
      </ol>
      {state.status === "ended" && <p className="text-sm text-muted">{labels.ended}</p>}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
        className="flex flex-col gap-2"
        aria-busy={busy || undefined}
      >
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={3}
          maxLength={1000}
          placeholder={labels.placeholder}
          aria-label={labels.placeholder}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-base"
        />
        {problem && (
          <p role="alert" className="text-sm">
            {problem}
          </p>
        )}
        <button type="submit" disabled={busy || !draft.trim()} className="button-primary self-end rounded-button px-4 py-2 disabled:opacity-50">
          {labels.send}
        </button>
      </form>
    </div>
  );
}

function Line({ message, labels }: { message: VisitorMessage; labels: SupportThreadLabels }) {
  if (message.author === "system") {
    const name = (message.data as { name?: unknown } | undefined)?.name;
    const who = typeof name === "string" ? name : "";
    const words: Record<string, string> = {
      ended: labels.lines.ended,
      reopened: labels.lines.reopened,
      queued: labels.lines.queued,
      joined: labels.lines.joined.replace("{name}", who),
      left: labels.lines.left.replace("{name}", who),
      assistant_back: labels.lines.assistantBack,
    };
    const text = message.kind ? words[message.kind] : undefined;
    return text ? <li className="text-center text-xs text-muted">{text}</li> : null;
  }
  const mine = message.author === "customer";
  const name = mine ? labels.you : message.author === "ai" ? labels.aiAssistant : ((message.data as { name?: unknown } | undefined)?.name as string | undefined) ?? "";
  return (
    <li className={`flex flex-col gap-1 ${mine ? "items-end" : "items-start"}`}>
      <span className="text-xs text-muted">{name}</span>
      <p className={`max-w-[85%] rounded-2xl px-3 py-2 whitespace-pre-line ${mine ? "bg-foreground text-background" : "bg-surface"}`}>{message.body}</p>
    </li>
  );
}
