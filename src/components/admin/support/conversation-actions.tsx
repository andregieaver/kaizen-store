"use client";

import { useRef, useState } from "react";

import { fillWords } from "@/lib/admin-fill";
import {
  supportEn,
  type SupportMessages,
} from "@/lib/admin-messages/support.en";
import { topicWords } from "@/lib/support-inbox-text";
import {
  insertReply,
  matchReplies,
  slashQuery,
  type SavedReply,
} from "@/lib/support-replies";
import { MESSAGE_MAX } from "@/lib/support-rules";
import {
  FOLLOW_UP_MAX,
  OUTCOMES,
  SUMMARY_TEXT_MAX,
  SUMMARY_TITLE_MAX,
  topicsFor,
} from "@/lib/support-summary";
import { isEnglish, languageName } from "@/lib/support-translate";
import type { ConversationFeed } from "@/server/support-inbox";

import { useAdminText } from "../admin-text";

import type { ActResult } from "./desk-context";

/** What may be done with a conversation now, for the person looking (D216, 2.4), from its state and the desk's mode. Pure, for the tests. */
export function availableActs(
  c: Pick<
    ConversationFeed,
    | "status"
    | "handler"
    | "assignee"
    | "me"
    | "canWrite"
    | "mode"
    | "store"
    | "signedIn"
    | "source"
  >,
  words: SupportMessages["actions"]["why"] = supportEn.actions.why,
): {
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
  const none = {
    claim: false,
    handBack: false,
    transfer: false,
    end: false,
    askSignIn: false,
    reply: false,
    note: false,
    brief: false,
    editSummary: false,
  };
  if (!c.canWrite) return { ...none, why: words.readOnly };
  if (c.status !== "open")
    return { ...none, note: true, editSummary: true, why: words.ended };
  if (c.mode === "off") return { ...none, note: true, why: words.off };
  const mine = c.handler === "human" && c.assignee?.id === c.me;
  // A form's message is answered by people only (D382): no brief by AI, and never given to the AI.
  const form = c.source === "form";
  return {
    brief: !form,
    editSummary: false,
    claim: c.handler === "ai" || c.handler === "queue",
    handBack: mine && c.mode === "ai_first" && !form,
    transfer: mine,
    end: mine,
    askSignIn: mine && c.store !== null && c.source === "site" && !c.signedIn,
    reply: mine,
    note: true,
    why:
      c.handler === "human" && !mine
        ? fillWords(words.someoneHas, {
            name: c.assignee?.name ?? words.someoneElse,
          })
        : null,
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
  const t = useAdminText("support");
  const w = t.actions;
  const acts = availableActs(conversation, w.why);
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
  const [slash, setSlash] = useState<{ query: string; start: number } | null>(
    null,
  );
  const [active, setActive] = useState(0);
  const loadingReplies = useRef(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  // Wherever the person could take the conversation over, the box answers the customer (sending takes it over first); a note is a
  // deliberate choice. Before, only a note could be written until Take over was pressed, and an answer typed there never left.
  const answerable = acts.reply || acts.claim;
  const takesOver = answerable && !acts.reply;
  const writingNote = asNote || !answerable;
  const translated = original !== null && !writingNote;
  const matches =
    slash && replies
      ? matchReplies(replies, slash.query, conversation.locale)
      : [];
  const picking = slash !== null && matches.length > 0;
  const canTranslate =
    conversation.translate &&
    acts.reply &&
    !writingNote &&
    !isEnglish(conversation.locale);

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
      setProblem(w.translateFailed);
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
      setProblem(w.failed);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const body = draft.trim();
    if (!body || busy) return;
    if (!writingNote && takesOver) {
      // Taken over first, so the reply is the person's own: the customer sees them join, then their words.
      setBusy(true);
      setProblem(null);
      const claimed = await act({ kind: "claim" }).catch(() => null);
      setBusy(false);
      if (!claimed?.ok) {
        setProblem(claimed && !claimed.ok ? claimed.problem : w.failed);
        return;
      }
    }
    void run(
      writingNote
        ? { kind: "note", body }
        : {
            kind: "reply",
            body,
            ...(translated ? { translated: true } : {}),
            ...(fromDraft ? { partnerDraft: true } : {}),
          },
      () => {
        setDraft("");
        setOriginal(null);
        setFromDraft(false);
      },
    );
  }

  const button =
    "rounded-md border border-edge px-3 py-1.5 text-sm hover:bg-sunken disabled:opacity-50";
  return (
    <div
      className="flex flex-col gap-2 border-t border-line p-3"
      aria-busy={busy || undefined}
    >
      <div className="flex flex-wrap items-center gap-2">
        {acts.claim && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run({ kind: "claim" })}
            className="rounded-pill bg-brand px-3 py-1.5 text-sm text-brand-ink disabled:opacity-50"
          >
            {w.takeOver}
          </button>
        )}
        {acts.handBack && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run({ kind: "hand_back" })}
            className={button}
          >
            {w.handBack}
          </button>
        )}
        {acts.transfer && (
          <span className="flex items-center gap-1">
            <select
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              aria-label={w.transferTo}
              className="rounded-md border border-line bg-card px-2 py-1.5 text-sm"
            >
              <option value="">{w.backToQueue}</option>
              {conversation.agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                  {agent.online ? "" : w.away}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run({ kind: "transfer", target: target || null })
              }
              className={button}
            >
              {w.transfer}
            </button>
          </span>
        )}
        {acts.askSignIn && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run({ kind: "ask_sign_in" })}
            className={button}
          >
            {w.askSignIn}
          </button>
        )}
        {acts.end && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run({ kind: "end" })}
            className={button}
          >
            {w.end}
          </button>
        )}
        {acts.brief && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run({ kind: "brief" })}
            className={button}
          >
            {w.brief}
          </button>
        )}
        {acts.editSummary && !editing && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setEditing(true)}
            className={button}
          >
            {conversation.summary ? w.editSummary : w.writeSummary}
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
          onSave={(summary) =>
            void run({ kind: "summary", summary }, () => setEditing(false))
          }
        />
      )}
      {(answerable || acts.note) && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
          className="flex flex-col gap-2"
        >
          {answerable && (
            <div
              role="radiogroup"
              aria-label={w.write}
              className="flex gap-1 text-sm"
            >
              <button
                type="button"
                role="radio"
                aria-checked={!asNote}
                onClick={() => setAsNote(false)}
                className={`rounded-pill px-2 py-1 ${!asNote ? "bg-sunken font-medium" : ""}`}
              >
                {w.reply}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={asNote}
                onClick={() => setAsNote(true)}
                className={`rounded-pill px-2 py-1 ${asNote ? "bg-sunken font-medium" : ""}`}
              >
                {w.note}
              </button>
            </div>
          )}
          {customerTyping && (
            <p className="text-sm text-muted" role="status">
              {w.typing}
            </p>
          )}
          <textarea
            ref={textarea}
            value={draft}
            onChange={(event) => {
              typed(
                event.target.value,
                event.target.selectionStart ?? event.target.value.length,
              );
              // The customer sees "typing…" (never the words), at most every 2 seconds.
              if (event.target.value && !writingNote) onTyping?.();
            }}
            onKeyDown={(event) => {
              if (picking) {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setActive(
                    (n) =>
                      (n +
                        (event.key === "ArrowDown" ? 1 : matches.length - 1)) %
                      matches.length,
                  );
                  return;
                }
                if (
                  (event.key === "Enter" && !event.metaKey && !event.ctrlKey) ||
                  event.key === "Tab"
                ) {
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
                void send();
              }
            }}
            rows={3}
            maxLength={writingNote ? MESSAGE_MAX.note : MESSAGE_MAX.agent}
            aria-label={writingNote ? w.noteLabel : w.replyLabel}
            aria-autocomplete="list"
            aria-controls={picking ? "saved-replies" : undefined}
            aria-activedescendant={
              picking
                ? `saved-reply-${matches[Math.min(active, matches.length - 1)].id}`
                : undefined
            }
            placeholder={writingNote ? w.notePlaceholder : w.replyPlaceholder}
            className={`w-full resize-y rounded-md border border-line bg-card px-3 py-2 text-sm ${writingNote ? "border-dashed" : ""}`}
          />
          {picking && (
            <ul
              id="saved-replies"
              role="listbox"
              aria-label={w.savedReplies}
              className="flex max-h-60 flex-col overflow-y-auto rounded-md border border-line bg-card text-sm"
            >
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
                    <span className="font-mono text-xs text-muted">
                      /{reply.shortcut}
                    </span>{" "}
                    {reply.title}
                    {reply.locale ? (
                      <span className="text-xs text-muted">
                        {" "}
                        · {languageName(reply.locale)}
                      </span>
                    ) : null}
                  </span>
                  <span className="line-clamp-1 text-xs text-muted">
                    {reply.body}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {slash && replies && matches.length === 0 && (
            <p className="text-xs text-muted">
              {fillWords(w.noReplyStarts, { query: slash.query })}
            </p>
          )}
          {translated && (
            <p
              className="flex flex-wrap items-center gap-2 text-xs text-muted"
              role="status"
            >
              {fillWords(w.translatedInto, {
                language: languageName(conversation.locale),
              })}
              <button
                type="button"
                onClick={() => {
                  setDraft(original ?? "");
                  setOriginal(null);
                }}
                className="underline"
              >
                {w.backToMine}
              </button>
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-3 text-xs text-muted">
              {w.sendKeys}
              {canTranslate && !translated && (
                <button
                  type="button"
                  disabled={busy || !draft.trim()}
                  onClick={() => void translateDraft()}
                  className="rounded-pill border border-edge px-2 py-1 text-ink hover:bg-sunken disabled:opacity-50"
                >
                  {fillWords(w.translateTo, {
                    language: languageName(conversation.locale),
                  })}
                </button>
              )}
            </span>
            {!writingNote && takesOver && <span className="text-xs text-muted">{w.sendTakesOver}</span>}
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className="rounded-pill bg-brand px-3 py-1.5 text-sm text-brand-ink disabled:opacity-50"
            >
              {writingNote ? w.addNote : w.send}
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
  onSave: (summary: {
    title: string;
    text: string;
    outcome: string;
    topics: string[];
    followUp: string | null;
  }) => void;
}) {
  const t = useAdminText("support");
  const w = t.summaryEditor;
  const current = conversation.summary;
  const topics = topicsFor(conversation.store === null);
  const field =
    "w-full rounded-md border border-line bg-card px-2 py-1.5 text-sm";
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
        {w.title}
        <input
          name="title"
          required
          maxLength={SUMMARY_TITLE_MAX}
          defaultValue={current?.title ?? ""}
          className={field}
        />
      </label>
      <label className="flex flex-col gap-1">
        {w.text}
        <textarea
          name="text"
          required
          maxLength={SUMMARY_TEXT_MAX}
          rows={3}
          defaultValue={current?.text ?? ""}
          className={field}
        />
      </label>
      <label className="flex flex-col gap-1">
        {w.outcome}
        <select
          name="outcome"
          defaultValue={current?.outcome ?? "resolved"}
          className={field}
        >
          {OUTCOMES.map((outcome) => (
            <option key={outcome} value={outcome}>
              {t.lib.outcomes[outcome]}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="flex flex-wrap gap-x-3 gap-y-1">
        <legend className="mb-1">{w.topics}</legend>
        {topics.map((topic) => (
          <label key={topic} className="flex items-center gap-1">
            <input
              type="checkbox"
              name="topics"
              value={topic}
              defaultChecked={current?.topics.includes(topic) ?? false}
              className="size-4"
            />
            {topicWords(topic, t.lib)}
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1">
        {w.followUp}
        <input
          name="followUp"
          maxLength={FOLLOW_UP_MAX}
          defaultValue={current?.followUp ?? ""}
          className={field}
        />
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-pill bg-brand px-3 py-1.5 text-sm text-brand-ink disabled:opacity-50"
        >
          {w.save}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-pill border border-edge px-3 py-1.5 text-sm hover:bg-sunken"
        >
          {w.cancel}
        </button>
      </div>
    </form>
  );
}
