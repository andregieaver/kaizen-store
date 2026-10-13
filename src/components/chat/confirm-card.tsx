"use client";

import { useState } from "react";

import type { ConversationRef, VisitorAction, VisitorReply } from "@/lib/support-visitor";

/** The words of the confirm card and of the lines after it (D216, 2.1, step 10); `{summary}`, `{reason}` and `{note}` are put in. */
export type ActionLabels = {
  confirm: string;
  noThanks: string;
  expired: string;
  done: string;
  failed: string;
  declined: string;
  requested: string;
  decidedDone: string;
  decidedDeclined: string;
  note: string;
  why: Record<string, string>;
};

const isReply = (body: unknown): body is VisitorReply => Boolean(body && typeof body === "object" && Array.isArray((body as VisitorReply).messages) && (body as VisitorReply).state);

/**
 * Something the assistant proposed (step 10): the summary written by the site, **Confirm** and **No thanks**. Nothing happens before
 * Confirm; the site checks it again then and answers with a line saying what happened. A staff request shows only that it was passed
 * on. An expired proposal says so.
 */
export function ConfirmCard({
  action,
  open,
  labels,
  sorry,
  site,
  conversation,
  after,
  onReply,
}: {
  action: VisitorAction;
  /** Whether it can still be answered here (no line after it settled it). */
  open: boolean;
  labels: ActionLabels;
  sorry: string;
  site: { store?: string; market?: string };
  conversation: ConversationRef;
  after: number;
  onReply: (reply: VisitorReply) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (action.confirmer === "staff") {
    return <p className="ml-9 rounded-lg border border-border px-3 py-2 text-sm">{labels.requested.replace("{summary}", action.summary)}</p>;
  }

  async function answer(confirm: boolean) {
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetch("/api/chat/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...site, conversation, after, action: action.id, confirm }),
      });
      const body = (await response.json().catch(() => ({}))) as unknown;
      if (response.ok && isReply(body)) onReply(body);
      else setProblem((body as { error?: string }).error ?? sorry);
    } catch {
      setProblem(sorry);
    } finally {
      setBusy(false);
    }
  }

  const live = open && action.status === "proposed";
  return (
    <div className="ml-9 flex flex-col gap-2 rounded-lg border border-border p-3 text-sm" aria-busy={busy || undefined}>
      <p>{action.summary}</p>
      {live ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void answer(true)} disabled={busy} className="button-primary rounded-button px-3 py-1.5 disabled:opacity-50">
            {labels.confirm}
          </button>
          <button type="button" onClick={() => void answer(false)} disabled={busy} className="rounded-button border border-border px-3 py-1.5 hover:bg-surface disabled:opacity-50">
            {labels.noThanks}
          </button>
        </div>
      ) : (
        action.status === "expired" && open && <p className="text-muted">{labels.expired}</p>
      )}
      {problem && <p role="alert">{problem}</p>}
    </div>
  );
}

/** The line after an action or a request was settled (`action_done`, `action_failed`, `action_declined`, `request_done`, `request_declined`), or null for another kind. */
export function actionLine(kind: string | undefined, data: unknown, labels: ActionLabels): string | null {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const summary = typeof d.summary === "string" ? d.summary : "";
  const note = typeof d.note === "string" && d.note ? d.note : null;
  const withNote = (text: string) => (note ? `${text} ${labels.note.replace("{note}", note)}` : text);
  switch (kind) {
    case "action_done":
      // The note of a done action is the site's own words (what is refunded), not a person's.
      return note ? `${labels.done.replace("{summary}", summary)} ${note}` : labels.done.replace("{summary}", summary);
    case "action_failed":
      return labels.failed.replace("{reason}", labels.why[typeof d.why === "string" ? d.why : "failed"] ?? labels.why.failed ?? "");
    case "action_declined":
      return labels.declined;
    case "request_done":
      return withNote(labels.decidedDone.replace("{summary}", summary));
    case "request_declined":
      return withNote(labels.decidedDeclined.replace("{summary}", summary));
    default:
      return null;
  }
}
