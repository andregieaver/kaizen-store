"use client";

import { useRef, useState } from "react";

import { OUTCOME_WORDS, topicWords } from "@/lib/support-inbox-text";
import { insertReply, matchReplies, slashQuery, type SavedReply } from "@/lib/support-replies";
import { MESSAGE_MAX } from "@/lib/support-rules";
import { FOLLOW_UP_MAX, OUTCOMES, SUMMARY_TEXT_MAX, SUMMARY_TITLE_MAX, topicsFor } from "@/lib/support-summary";
import { isEnglish, languageName } from "@/lib/support-translate";
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
  /** Ask the AI for a brief of the conversation so far (step 7). */
  brief: boolean;
  /** Correct an ended conversation's summary (step 7). */
  editSummary: boolean;
  /** Why nothing can be done, when nothing can. */
  why: string | null;
} {
  const none = { claim: false, handBack: false, transfer: false, end: false, askSignIn: false, reply: false, note: false, brief: false, editSummary: false };
  if (!c.canWrite) return { ...none, why: "You can read this desk's conversations but not answer them." };
  if (c.status !== "open") return { ...none, note: true, editSummary: true, why: "This conversation has ended." };
  if (c.mode === "off") return { ...none, note: true, why: "Support is switched off for this desk: the chat assistant answers alone, and nobody takes over." };
  const mine = c.handler === "human" && c.assignee?.id === c.me;
  return {
    brief: true,
    editSummary: false,
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
 * End; a reply (to the customer, only once it is yours) or an internal note (never sent). Ctrl or Cmd and Enter sends. `/` at the
 * start of a line opens the desk's saved replies, filled in for the conversation, and a reply can be translated into the
 * conversation's language first (step 13): the translation only fills the composer, and Send sends it marked *Translated by AI*.
 */
export function ConversationActions({
  conversation,
  act,
  onDone,
  initialDraft,
  onTyping,
  customerTyping = false,
}: {
  conversation: ConversationFeed;
  act: (input: unknown) => Promise<ActResult>;
  onDone: () => void;
  /** A partner's draft put here by *Use* (step 8): it fills the composer, and nothing is sent. */
  initialDraft?: string;
  /** Typing an answer (not a note): the customer is told someone is typing (realtime, step 12). */
  onTyping?: () => void;
  /** The customer is typing now (realtime, step 12). */
  customerTyping?: boolean;
}) {
  const acts = availableActs(conversation);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [draft, setDraft] = useState(initialDraft ?? "");
  const [asNote, setAsNote] = useState(false);
  const [target, setTarget] = useState("");
  const [editing, setEditing] = useState(false);
  /** The person's own words before a translation, while the composer holds the AI's translation of them. */
  const [original, setOriginal] = useState<string | null>(null);
  /** The composer was filled from the partner's draft (*Use*), and has not been emptied since: counted for the desk (step 14). */
  const [fromDraft, setFromDraft] = useState(Boolean(initialDraft));
  const [replies, setReplies] = useState<SavedReply[] | null>(null);
  const [slash, setSlash] = useState<{ query: string; start: number } | null>(null);
  const [active, setActive] = useState(0);
  const loadingReplies = useRef(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const writingNote = asNote || !acts.reply;
  const translated = original !== null && !writingNote;
  const matches = slash && replies ? matchReplies(replies, slash.query, conversation.locale) : [];
  const picking = slash !== null && matches.length > 0;
  const canTranslate = conversation.translate && acts.reply && !writingNote && !isEnglish(conversation.locale);

  /** The desk's saved replies, filled in for this conversation, asked for the first time `/` is typed. */
  async function loadReplies() {
    if (replies || loadingReplies.current) return;
    loadingReplies.current = true;
    try {
      const result = await act({ kind: "replies" });
      setReplies(result.ok ? (result.replies ?? []) : []);
    } catch {
      setReplies([]);
    } finally {
      loadingReplies.current = false;
    }
  }

  function typed(text: string, cursor: number) {
    setDraft(text);
    if (!text) {
      setOriginal(null);
      setFromDraft(false);
    }
    const found = slashQuery(text, cursor);
    setSlash(found);
    setActive(0);
    if (found) void loadReplies();
  }

  function pick(reply: SavedReply) {
    if (!slash) return;
    const next = insertReply(draft, slash, reply.body);
    setDraft(next.text);
    setSlash(null);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(next.cursor, next.cursor);
    });
  }

  async function translateDraft() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await act({ kind: "translate_reply", text });
      if (!result.ok) setProblem(result.problem);
      else if (result.text) {
        setOriginal(text);
        setDraft(result.text);
      }
    } catch {
      setProblem("The reply could not be translated just now. Try again.");
    } finally {
      setBusy(false);
    }
  }

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
    void run(writingNote ? { kind: "note", body } : { kind: "reply", body, ...(translated ? { translated: true } : {}), ...(fromDraft ? { partnerDraft: true } : {}) }, () => {
      setDraft("");
      setOriginal(null);
      setFromDraft(false);
    });
  }

  const button = "rounded-md border border-edge px-3 py-1.5 text-sm hover:bg-sunken disabled:opacity-50";
  return (
    <div className="flex flex-col gap-2 border-t border-line p-3" aria-busy={busy || undefined}>
      <div className="flex flex-wrap items-center gap-2">
        {acts.claim && (
          <button type="button" disabled={busy} onClick={() => void run({ kind: "claim" })} className="rounded-pill bg-brand px-3 py-1.5 text-sm text-brand-ink disabled:opacity-50">
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
            <select value={target} onChange={(event) => setTarget(event.target.value)} aria-label="Transfer to" className="rounded-md border border-line bg-card px-2 py-1.5 text-sm">
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
        {acts.brief && (
          <button type="button" disabled={busy} onClick={() => void run({ kind: "brief" })} className={button}>
            Brief me
          </button>
        )}
        {acts.editSummary && !editing && (
          <button type="button" disabled={busy} onClick={() => setEditing(true)} className={button}>
            {conversation.summary ? "Edit summary" : "Write a summary"}
          </button>
        )}
        {acts.why && <p className="text-sm text-muted">{acts.why}</p>}
      </div>
      {problem && (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {problem}
        </p>
      )}
      {editing && (
        <SummaryEditor
          conversation={conversation}
          busy={busy}
          onCancel={() => setEditing(false)}
          onSave={(summary) => void run({ kind: "summary", summary }, () => setEditing(false))}
        />
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
              <button type="button" role="radio" aria-checked={!asNote} onClick={() => setAsNote(false)} className={`rounded-md px-2 py-1 ${!asNote ? "bg-sunken font-medium" : ""}`}>
                Reply
              </button>
              <button type="button" role="radio" aria-checked={asNote} onClick={() => setAsNote(true)} className={`rounded-md px-2 py-1 ${asNote ? "bg-sunken font-medium" : ""}`}>
                Internal note
              </button>
            </div>
          )}
          {customerTyping && (
            <p className="text-sm text-muted" role="status">
              The customer is typing…
            </p>
          )}
          <textarea
            ref={textarea}
            value={draft}
            onChange={(event) => {
              typed(event.target.value, event.target.selectionStart ?? event.target.value.length);
              // The customer sees "typing…" (never the words), at most every 2 seconds.
              if (event.target.value && !writingNote) onTyping?.();
            }}
            onKeyDown={(event) => {
              if (picking) {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setActive((n) => (n + (event.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
                  return;
                }
                if ((event.key === "Enter" && !event.metaKey && !event.ctrlKey) || event.key === "Tab") {
                  event.preventDefault();
                  pick(matches[Math.min(active, matches.length - 1)]);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setSlash(null);
                  return;
                }
              }
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                send();
              }
            }}
            rows={3}
            maxLength={writingNote ? MESSAGE_MAX.note : MESSAGE_MAX.agent}
            aria-label={writingNote ? "Internal note (only your team sees it)" : "Reply to the customer"}
            aria-autocomplete="list"
            aria-controls={picking ? "saved-replies" : undefined}
            aria-activedescendant={picking ? `saved-reply-${matches[Math.min(active, matches.length - 1)].id}` : undefined}
            placeholder={writingNote ? "An internal note: only your team sees it" : "Write to the customer, or / for a saved reply"}
            className={`w-full resize-y rounded-md border border-line bg-card px-3 py-2 text-sm ${writingNote ? "border-dashed" : ""}`}
          />
          {picking && (
            <ul id="saved-replies" role="listbox" aria-label="Saved replies" className="flex max-h-60 flex-col overflow-y-auto rounded-md border border-line bg-card text-sm">
              {matches.map((reply, index) => (
                <li
                  key={reply.id}
                  id={`saved-reply-${reply.id}`}
                  role="option"
                  aria-selected={index === active}
                  onMouseDown={(event) => {
                    // Keeps the focus in the composer.
                    event.preventDefault();
                    pick(reply);
                  }}
                  className={`flex cursor-pointer flex-col px-3 py-1.5 ${index === active ? "bg-sunken" : ""}`}
                >
                  <span>
                    <span className="font-mono text-xs text-muted">/{reply.shortcut}</span> {reply.title}
                    {reply.locale ? <span className="text-xs text-muted"> · {languageName(reply.locale)}</span> : null}
                  </span>
                  <span className="line-clamp-1 text-xs text-muted">{reply.body}</span>
                </li>
              ))}
            </ul>
          )}
          {slash && replies && matches.length === 0 && <p className="text-xs text-muted">No saved reply starts with /{slash.query}.</p>}
          {translated && (
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted" role="status">
              Translated by AI into {languageName(conversation.locale)}: read it before you send. The customer sees it marked as translated.
              <button type="button" onClick={() => { setDraft(original ?? ""); setOriginal(null); }} className="underline">
                Back to my words
              </button>
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-3 text-xs text-muted">
              Ctrl or ⌘ and Enter sends
              {canTranslate && !translated && (
                <button type="button" disabled={busy || !draft.trim()} onClick={() => void translateDraft()} className="rounded-md border border-edge px-2 py-1 text-ink hover:bg-sunken disabled:opacity-50">
                  Translate to {languageName(conversation.locale)}
                </button>
              )}
            </span>
            <button type="submit" disabled={busy || !draft.trim()} className="rounded-pill bg-brand px-3 py-1.5 text-sm text-brand-ink disabled:opacity-50">
              {writingNote ? "Add note" : "Send"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Correcting a summary (2.7): the title, the text, the outcome, one to three topics of the desk's list and a follow-up. */
function SummaryEditor({
  conversation,
  busy,
  onCancel,
  onSave,
}: {
  conversation: ConversationFeed;
  busy: boolean;
  onCancel: () => void;
  onSave: (summary: { title: string; text: string; outcome: string; topics: string[]; followUp: string | null }) => void;
}) {
  const current = conversation.summary;
  const topics = topicsFor(conversation.store === null);
  const field = "w-full rounded-md border border-line bg-card px-2 py-1.5 text-sm";
  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-line p-3 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        onSave({
          title: String(form.get("title") ?? ""),
          text: String(form.get("text") ?? ""),
          outcome: String(form.get("outcome") ?? ""),
          topics: form.getAll("topics").map(String),
          followUp: String(form.get("followUp") ?? "") || null,
        });
      }}
    >
      <label className="flex flex-col gap-1">
        Title
        <input name="title" required maxLength={SUMMARY_TITLE_MAX} defaultValue={current?.title ?? ""} className={field} />
      </label>
      <label className="flex flex-col gap-1">
        What happened
        <textarea name="text" required maxLength={SUMMARY_TEXT_MAX} rows={3} defaultValue={current?.text ?? ""} className={field} />
      </label>
      <label className="flex flex-col gap-1">
        Outcome
        <select name="outcome" defaultValue={current?.outcome ?? "resolved"} className={field}>
          {OUTCOMES.map((outcome) => (
            <option key={outcome} value={outcome}>
              {OUTCOME_WORDS[outcome]}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="flex flex-wrap gap-x-3 gap-y-1">
        <legend className="mb-1">Topics (one to three)</legend>
        {topics.map((topic) => (
          <label key={topic} className="flex items-center gap-1">
            <input type="checkbox" name="topics" value={topic} defaultChecked={current?.topics.includes(topic) ?? false} className="size-4" />
            {topicWords(topic)}
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1">
        Still to do (optional)
        <input name="followUp" maxLength={FOLLOW_UP_MAX} defaultValue={current?.followUp ?? ""} className={field} />
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="rounded-pill bg-brand px-3 py-1.5 text-sm text-brand-ink disabled:opacity-50">
          Save summary
        </button>
        <button type="button" onClick={onCancel} className="rounded-md border border-edge px-3 py-1.5 text-sm hover:bg-sunken">
          Cancel
        </button>
      </div>
    </form>
  );
}
