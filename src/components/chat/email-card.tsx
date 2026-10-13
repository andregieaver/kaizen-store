"use client";

import { useState } from "react";

import type { ConversationRef, VisitorReply } from "@/lib/support-visitor";

/** The email card's words (D216, 2.3); `sent` holds `{email}`. */
export type EmailCardLabels = { intro: string; name: string; email: string; send: string; sent: string; use: string; change: string; invalid: string };

const isReply = (body: unknown): body is VisitorReply => Boolean(body && typeof body === "object" && Array.isArray((body as VisitorReply).messages) && (body as VisitorReply).state);

/**
 * The email card's form (D216, 2.3): a name if the visitor gives one and the email answers go to, through `/api/chat/email`. Drawn
 * while the conversation waits and nobody can answer, and under the AI's answer when it asked for an email (`ask_for_email`, step 9).
 */
export function EmailForm({
  labels,
  sorry,
  site,
  conversation,
  after,
  onReply,
}: {
  labels: EmailCardLabels;
  sorry: string;
  site: { store?: string; market?: string };
  conversation: ConversationRef;
  after: number;
  onReply: (reply: VisitorReply) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function leave(form: FormData) {
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetch("/api/chat/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...site, conversation, after, name: String(form.get("name") ?? ""), email: String(form.get("email") ?? "") }),
      });
      const body = (await response.json().catch(() => ({}))) as unknown;
      if (response.ok && isReply(body)) onReply(body);
      else setProblem(response.status === 400 ? labels.invalid : ((body as { error?: string }).error ?? sorry));
    } catch {
      setProblem(sorry);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void leave(new FormData(event.currentTarget));
      }}
      className="flex flex-col gap-2"
      aria-busy={busy || undefined}
    >
      <p>{labels.intro}</p>
      <label className="flex flex-col gap-1">
        <span>{labels.name}</span>
        <input name="name" autoComplete="name" maxLength={120} className="rounded-lg border border-border bg-background px-3 py-2 text-base" />
      </label>
      <label className="flex flex-col gap-1">
        <span>{labels.email}</span>
        <input name="email" type="email" required autoComplete="email" maxLength={254} className="rounded-lg border border-border bg-background px-3 py-2 text-base" />
      </label>
      {problem && <p role="alert">{problem}</p>}
      <button type="submit" disabled={busy} className="button-primary self-start rounded-button px-3 py-1.5 disabled:opacity-50">
        {labels.send}
      </button>
      <p className="text-xs text-muted">{labels.use}</p>
    </form>
  );
}
