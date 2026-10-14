"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import type { VisitorMessage, VisitorState } from "@/lib/support-visitor";
import type { RequesterRow } from "@/server/support-kaizen";

type Answer = { conversation: { id: string }; state: VisitorState; messages: VisitorMessage[]; error?: string };

const isAnswer = (body: unknown): body is Answer => Boolean(body && typeof body === "object" && Array.isArray((body as Answer).messages) && (body as Answer).state);

/** A system line in the account's own words (the admin is in English). */
function lineWords(message: VisitorMessage): string | null {
  const name = (message.data as { name?: unknown } | undefined)?.name;
  const who = typeof name === "string" && name ? name : "Someone from Kaizen";
  switch (message.kind) {
    case "queued":
      return "Waiting for a person from Kaizen.";
    case "joined":
      return `${who} joined the conversation.`;
    case "left":
      return `${who} left the conversation.`;
    case "assistant_back":
      return "Kaizen's assistant is back.";
    case "ended":
      return "The conversation has ended.";
    case "reopened":
      return "The conversation was opened again.";
    default:
      return null;
  }
}

/**
 * *Your requests to Kaizen* (D216, 2.8, step 11): the account's conversations with Kaizen's support on the left, the open one on the
 * right with a box to write in, asked for again every 3 seconds while it is open. A new request may name the store it is about.
 */
export function KaizenRequests({ initial, stores, initialOpen }: { initial: RequesterRow[]; stores: { slug: string; name: string }[]; initialOpen: string | null }) {
  const [rows, setRows] = useState(initial);
  const [open, setOpen] = useState<string | null>(initialOpen);
  const [messages, setMessages] = useState<VisitorMessage[]>([]);
  const [state, setState] = useState<VisitorState | null>(null);
  const [draft, setDraft] = useState("");
  const [about, setAbout] = useState(stores.length === 1 ? stores[0].slug : "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const last = useRef(0);
  const listRef = useRef<HTMLOListElement>(null);

  const take = useCallback((answer: Answer, replace = false) => {
    setState(answer.state);
    setMessages((current) => {
      const base = replace ? [] : current;
      const seen = new Set(base.map((m) => m.seq));
      const merged = [...base, ...answer.messages.filter((m) => !seen.has(m.seq))].sort((a, b) => a.seq - b.seq);
      last.current = merged.reduce((max, m) => Math.max(max, m.seq), 0);
      return merged;
    });
  }, []);

  // The open conversation: everything first, then what is new every 3 seconds while it is open.
  useEffect(() => {
    if (!open) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    last.current = 0;
    const tick = async (first: boolean) => {
      try {
        const response = await fetch(`/admin/account/kaizen-support/c/${open}?after=${first ? 0 : last.current}`, { cache: "no-store" });
        const body = (await response.json().catch(() => ({}))) as unknown;
        if (!stopped && response.ok && isAnswer(body)) take(body, first);
        if (!stopped && isAnswer(body) && body.state.status !== "open") return;
      } catch {
        // The next time asks again.
      }
      if (!stopped) timer = setTimeout(() => void tick(false), 3000);
    };
    void tick(true);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [open, take]);

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: "end" });
  }, [messages]);

  async function send() {
    const message = draft.trim();
    if (!message || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetch("/admin/account/kaizen-support/turn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversation: open, after: open ? last.current : 0, message, aboutStore: open ? null : about || null, path: window.location.pathname }),
      });
      const body = (await response.json().catch(() => ({}))) as unknown;
      if (!response.ok || !isAnswer(body)) {
        setProblem((body as { error?: string }).error ?? "The message could not be sent. Try again.");
        return;
      }
      setDraft("");
      if (body.error) setProblem(body.error);
      if (body.conversation.id !== open) {
        setRows((current) => [
          { id: body.conversation.id, status: "open", handler: body.state.handler, title: null, aboutStore: stores.find((s) => s.slug === about)?.name ?? null, lastMessage: message, lastMessageAt: new Date().toISOString(), createdAt: new Date().toISOString() },
          ...current.filter((row) => row.id !== body.conversation.id),
        ]);
        setOpen(body.conversation.id);
        take(body, true);
      } else take(body);
    } catch {
      setProblem("The message could not be sent. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function end() {
    if (!open) return;
    await fetch(`/admin/account/kaizen-support/c/${open}/end`, { method: "POST" }).catch(() => undefined);
    setRows((current) => current.map((row) => (row.id === open ? { ...row, status: "ended" } : row)));
    const response = await fetch(`/admin/account/kaizen-support/c/${open}?after=${last.current}`, { cache: "no-store" }).catch(() => null);
    const body = response ? ((await response.json().catch(() => ({}))) as unknown) : null;
    if (isAnswer(body)) take(body);
  }

  const person = state?.status === "open" && state.handler === "human" ? state.agent : null;
  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
      <aside className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(null);
            setMessages([]);
            setState(null);
            setProblem(null);
          }}
          className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-ink"
        >
          New request
        </button>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">You have not asked Kaizen anything yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => setOpen(row.id)}
                  aria-current={row.id === open ? "true" : undefined}
                  className={`flex w-full flex-col items-start gap-0.5 rounded-lg border border-edge px-3 py-2 text-left text-sm ${row.id === open ? "bg-sunken" : "hover:bg-sunken"}`}
                >
                  <span className="line-clamp-1 font-medium">{row.title ?? row.lastMessage ?? "Request"}</span>
                  <span className="text-xs text-muted">
                    {row.status === "ended" ? "Ended" : row.handler === "human" ? "With Kaizen" : row.handler === "queue" ? "Waiting for Kaizen" : "With the assistant"}
                    {row.aboutStore ? ` · ${row.aboutStore}` : ""} · {new Date(row.lastMessageAt).toLocaleDateString("en-GB", { dateStyle: "medium" })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section aria-label="Conversation with Kaizen" className="flex min-h-[28rem] flex-col rounded-lg border border-line bg-sunken">
        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3 text-sm">
          <span className="font-medium">{person ? person.name : open ? "Kaizen support" : "A new request"}</span>
          {open && state?.status === "open" && (
            <button type="button" onClick={() => void end()} className="text-muted underline">
              End the conversation
            </button>
          )}
        </header>
        <ol ref={listRef} role="log" aria-live="polite" aria-label="Messages" className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
          {!open && <li className="text-sm text-muted">Write what you need help with. Kaizen&apos;s assistant (an AI) answers first; ask for a person at any time.</li>}
          {messages.map((message) => {
            if (message.author === "system") {
              const words = lineWords(message);
              return words ? (
                <li key={message.seq} className="text-center text-xs text-muted">
                  {words}
                </li>
              ) : null;
            }
            const mine = message.author === "customer";
            const name = mine ? "You" : message.author === "ai" ? "Kaizen's assistant (AI)" : (((message.data as { name?: unknown } | undefined)?.name as string | undefined) ?? "Kaizen");
            return (
              <li key={message.seq} className={`flex flex-col gap-1 ${mine ? "items-end" : "items-start"}`}>
                <span className="text-xs text-muted">{name}</span>
                <p className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-line ${mine ? "bg-brand text-brand-ink" : "border border-line bg-card"}`}>{message.body}</p>
                {message.author === "agent" && message.data?.translated && <span className="text-xs text-muted">Translated by AI</span>}
                {message.data?.chips && message.data.chips.length > 0 && (
                  <ul className="flex flex-wrap gap-2">
                    {message.data.chips
                      .filter((chip) => /^\/admin(?:\/|$)/.test(chip.href))
                      .map((chip) => (
                        <li key={chip.href}>
                          <Link href={chip.href} className="rounded-lg border border-line px-3 py-1 text-sm hover:bg-card">
                            {chip.label} →
                          </Link>
                        </li>
                      ))}
                  </ul>
                )}
              </li>
            );
          })}
          {state?.status === "open" && state.handler === "queue" && (
            <li className="text-center text-xs text-muted">
              {state.queue ? `You are number ${state.queue.position} in line. ` : ""}
              {state.available ? "Someone from Kaizen answers here." : "Nobody from Kaizen is online now: you get the answer here and by email."}
            </li>
          )}
          {busy && <li className="text-sm text-muted">Writing …</li>}
        </ol>
        <form
          className="flex flex-col gap-2 border-t border-line p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          {!open && stores.length > 0 && (
            <label className="flex flex-wrap items-center gap-2 text-sm">
              About
              <select value={about} onChange={(event) => setAbout(event.target.value)} className="rounded-lg border border-line bg-card px-2 py-1">
                <option value="">My account, no store</option>
                {stores.map((store) => (
                  <option key={store.slug} value={store.slug}>
                    {store.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="sr-only" htmlFor="kaizen-message">
            Your message to Kaizen
          </label>
          <textarea
            id="kaizen-message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send();
            }}
            maxLength={1000}
            rows={3}
            placeholder="Your message to Kaizen"
            className="rounded-lg border border-line bg-card px-3 py-2 text-sm"
          />
          {problem && <p role="alert" className="text-sm">{problem}</p>}
          <button type="submit" disabled={busy || !draft.trim()} className="self-end rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-brand-ink disabled:opacity-50">
            Send
          </button>
        </form>
      </section>
    </div>
  );
}
