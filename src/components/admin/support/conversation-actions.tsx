"use client";

import { useState } from "react";

import { MESSAGE_MAX } from "@/lib/support-rules";
import type { ConversationFeed } from "@/server/support-inbox";

import type { ActResult } from "./desk-context";

/** What may be done with a conversation now, for the person looking (D216, 2.4), from its state and the desk's mode. Pure, for the tests. */
export function availableActs(c: Pick<ConversationFeed, "status" | "handler" | "assignee" | "me" | "canWrite" | "mode" | "store" | "signedIn" | "source">): {
  claim: boolean;
  handBack: boolean;
  transfer: boolean;
  end: boolean;
  askSignIn: boolean;
  reply: boolean;
  note: boolean;
  /** Why nothing can be done, when nothing can. */
  why: string | null;
} {
  const none = { claim: false, handBack: false, transfer: false, end: false, askSignIn: false, reply: false, note: false };
  if (!c.canWrite) return { ...none, why: "You can read this desk's conversations but not answer them." };
  if (c.status !== "open") return { ...none, note: true, why: "This conversation has ended." };
  if (c.mode === "off") return { ...none, note: true, why: "Support is switched off for this desk: the chat assistant answers alone, and nobody takes over." };
  const mine = c.handler === "human" && c.assignee?.id === c.me;
  return {
    claim: c.handler === "ai" || c.handler === "queue",
    handBack: mine && c.mode === "ai_first",
    transfer: mine,
    end: mine,
    askSignIn: mine && c.store !== null && c.source === "site" && !c.signedIn,
    reply: mine,
    note: true,
    why: c.handler === "human" && !mine ? `${c.assignee?.name ?? "Someone else"} has this conversation.` : null,
  };
}

/**
 * The buttons and the composer of an open conversation (D216, 2.4, step 4): Take over, Hand back to the AI, Transfer, Ask to sign in,
 * End; a reply (to the customer, only once it is yours) or an internal note (never sent). Ctrl or Cmd and Enter sends.
 */
export function ConversationActions({ conversation, act, onDone }: { conversation: ConversationFeed; act: (input: unknown) => Promise<ActResult>; onDone: () => void }) {
  const acts = availableActs(conversation);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [asNote, setAsNote] = useState(false);
  const [target, setTarget] = useState("");
  const writingNote = asNote || !acts.reply;

  async function run(input: unknown, after?: () => void) {
    setBusy(true);
    setProblem(null);
    try {
      const result = await act(input);
      if (!result.ok) setProblem(result.problem);
      else {
        after?.();
        onDone();
      }
    } catch {
      setProblem("That did not work just now. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function send() {
    const body = draft.trim();
    if (!body || busy) return;
    void run({ kind: writingNote ? "note" : "reply", body }, () => setDraft(""));
  }

  const button = "rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface disabled:opacity-50";
  return (
    <div className="flex flex-col gap-2 border-t border-border p-3" aria-busy={busy || undefined}>
      <div className="flex flex-wrap items-center gap-2">
        {acts.claim && (
          <button type="button" disabled={busy} onClick={() => void run({ kind: "claim" })} className="rounded-md bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-50">
            Take over
          </button>
        )}
        {acts.handBack && (
          <button type="button" disabled={busy} onClick={() => void run({ kind: "hand_back" })} className={button}>
            Hand back to the AI
          </button>
        )}
        {acts.transfer && (
          <span className="flex items-center gap-1">
            <select value={target} onChange={(event) => setTarget(event.target.value)} aria-label="Transfer to" className="rounded-md border border-border bg-background px-2 py-1.5 text-sm">
              <option value="">Back to the queue</option>
              {conversation.agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                  {agent.online ? "" : " (away)"}
                </option>
              ))}
            </select>
            <button type="button" disabled={busy} onClick={() => void run({ kind: "transfer", target: target || null })} className={button}>
              Transfer
            </button>
          </span>
        )}
        {acts.askSignIn && (
          <button type="button" disabled={busy} onClick={() => void run({ kind: "ask_sign_in" })} className={button}>
            Ask to sign in
          </button>
        )}
        {acts.end && (
          <button type="button" disabled={busy} onClick={() => void run({ kind: "end" })} className={button}>
            End
          </button>
        )}
        {acts.why && <p className="text-sm text-muted">{acts.why}</p>}
      </div>
      {problem && (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {problem}
        </p>
      )}
      {(acts.reply || acts.note) && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
          className="flex flex-col gap-2"
        >
          {acts.reply && (
            <div role="radiogroup" aria-label="Write" className="flex gap-1 text-sm">
              <button type="button" role="radio" aria-checked={!asNote} onClick={() => setAsNote(false)} className={`rounded-md px-2 py-1 ${!asNote ? "bg-surface font-medium" : ""}`}>
                Reply
              </button>
              <button type="button" role="radio" aria-checked={asNote} onClick={() => setAsNote(true)} className={`rounded-md px-2 py-1 ${asNote ? "bg-surface font-medium" : ""}`}>
                Internal note
              </button>
            </div>
          )}
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                send();
              }
            }}
            rows={3}
            maxLength={writingNote ? MESSAGE_MAX.note : MESSAGE_MAX.agent}
            aria-label={writingNote ? "Internal note (only your team sees it)" : "Reply to the customer"}
            placeholder={writingNote ? "An internal note: only your team sees it" : "Write to the customer"}
            className={`w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm ${writingNote ? "border-dashed" : ""}`}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted">Ctrl or ⌘ and Enter sends</span>
            <button type="submit" disabled={busy || !draft.trim()} className="rounded-md bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-50">
              {writingNote ? "Add note" : "Send"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
