"use client";

import { useState } from "react";

import { PARTNER_QUESTION_MAX } from "@/lib/support-rules";
import type { ConversationFeed } from "@/server/support-inbox";

import { fillWords } from "@/lib/admin-fill";

import { useAdminText } from "../admin-text";

import type { ActResult } from "./desk-context";

/** A partner message's data as the server keeps it (step 8). */
type PartnerData = {
  facts?: { text: string; tool: string }[];
  recommendation?: string | null;
  draft?: string | null;
  answer?: string | null;
  question?: string | null;
};

/**
 * The silent partner's tab (D216, `docs/support.md` 2.5, step 8): the brief, then the partner's cards newest first (facts with where
 * each came from, a recommendation, a draft with *Use*, an answer to a question), *Ask the partner*, and *Pause the partner here* for
 * the person who has the conversation. Marked as staff only throughout; *Use* only fills the composer, it sends nothing.
 */
export function PartnerPanel({
  conversation,
  act,
  onDone,
  onUse,
  working,
}: {
  conversation: ConversationFeed;
  act: (input: unknown) => Promise<ActResult>;
  onDone: () => void;
  onUse: (text: string) => void;
  /** The partner is looking after a customer message. */
  working: boolean;
}) {
  const t = useAdminText("support");
  const w = t.partner;
  const toolWords = w.tools as Record<string, string>;
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const cards = conversation.messages
    .filter((m) => m.author === "partner")
    .slice()
    .reverse();
  const mine =
    conversation.status === "open" &&
    conversation.handler === "human" &&
    conversation.assignee?.id === conversation.me;

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

  if (!conversation.partner.available) {
    return <p className="p-4 text-sm text-muted">{w.off}</p>;
  }

  return (
    <div
      className="flex flex-col gap-3 p-4 text-sm"
      aria-busy={busy || working || undefined}
    >
      <p className="text-xs font-medium">{t.lib.author.partner}</p>
      {!conversation.signedIn && conversation.store && (
        <p className="rounded-md border border-dashed border-line p-2 text-xs">
          {w.notSignedIn}
        </p>
      )}
      {conversation.brief && (
        <section className="rounded-md border border-dashed border-line p-2">
          <p className="text-xs text-muted">{w.soFar}</p>
          <p>{conversation.brief.text}</p>
        </section>
      )}
      {!conversation.partner.mine && (
        <p className="text-xs text-muted">{w.yoursOff}</p>
      )}
      {mine && (
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={conversation.partnerPaused}
            disabled={busy}
            onChange={(event) =>
              void run({ kind: "pause_partner", paused: event.target.checked })
            }
            className="size-4"
          />
          {w.pause}
        </label>
      )}
      {working && (
        <p role="status" className="text-xs text-muted">
          {w.looking}
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const text = question.trim();
          if (text)
            void run({ kind: "ask_partner", question: text }, () =>
              setQuestion(""),
            );
        }}
        className="flex flex-col gap-1"
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs">{w.ask}</span>
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            rows={2}
            maxLength={PARTNER_QUESTION_MAX}
            placeholder={w.askPlaceholder}
            className="rounded-md border border-dashed border-line bg-card px-2 py-1.5"
          />
        </label>
        <button
          type="submit"
          disabled={busy || !question.trim() || conversation.status !== "open"}
          className="self-end rounded-pill border border-edge px-2 py-1 text-xs hover:bg-sunken disabled:opacity-50"
        >
          {w.askButton}
        </button>
      </form>
      {problem && (
        <p role="alert" className="text-xs">
          {problem}
        </p>
      )}
      {cards.length === 0 && !working && (
        <p className="text-xs text-muted">{w.nothing}</p>
      )}
      <ol className="flex flex-col gap-3">
        {cards.map((card) => {
          const data = (card.data ?? {}) as PartnerData;
          return (
            <li
              key={card.seq}
              className="flex flex-col gap-2 rounded-md border border-dashed border-line p-2"
              data-author="partner"
            >
              {data.question && (
                <p className="text-xs text-muted">
                  {fillWords(w.youAsked, { question: data.question })}
                </p>
              )}
              {data.answer && <p>{data.answer}</p>}
              {data.facts && data.facts.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {data.facts.map((fact, i) => (
                    <li key={i}>
                      {fact.text}{" "}
                      <span className="text-xs text-muted">
                        {fillWords(w.from, {
                          source: toolWords[fact.tool] ?? fact.tool,
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {data.recommendation && (
                <p>
                  <span className="font-medium">{w.next} </span>
                  {data.recommendation}
                </p>
              )}
              {data.draft && (
                <div className="flex flex-col gap-1">
                  <p className="text-xs text-muted">{w.draft}</p>
                  <p className="whitespace-pre-line rounded bg-sunken p-2">
                    {data.draft}
                  </p>
                  {mine && (
                    <button
                      type="button"
                      onClick={() => onUse(data.draft!)}
                      className="self-start rounded-pill border border-edge px-2 py-1 text-xs hover:bg-sunken"
                    >
                      {w.use}
                    </button>
                  )}
                </div>
              )}
              <time dateTime={card.at} className="text-xs text-muted">
                {card.at.slice(11, 16)}
              </time>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
