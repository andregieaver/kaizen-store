"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { browserText } from "@/lib/browser-text";
import {
  COMMENT_BODY_MAX,
  COMMENT_EMAIL_MAX,
  COMMENT_NAME_MAX,
  commentProblems,
  type CommentAnswer,
  type CommentDraft,
  type CommentProblems,
} from "@/lib/blog-comments";

const input = "min-h-11 w-full rounded-md border border-border bg-background px-3 text-base";
const labelClass = "flex flex-col gap-1 text-sm font-medium";

type State = { kind: "idle" | "sending" } | { kind: "done"; shown: boolean } | { kind: "failed"; text: string };

/**
 * The comment form under an article (D341): name, an optional email that is never shown, and the comment, sent to `/api/blog/comments`.
 * It sets no cookie and keeps nothing in the browser. A hidden field and the time taken tell robots apart; the server checks everything
 * again. A comment shown at once (`automatic`) brings the page again so it is there; one held for the store says so.
 */
export function BlogCommentForm({ store, market, article, lang }: { store: string; market: string; article: string; lang: string }) {
  const m = browserText(lang).blogComments;
  const router = useRouter();
  const id = useId();
  const [draft, setDraft] = useState<CommentDraft>({ name: "", email: "", body: "" });
  const [problems, setProblems] = useState<CommentProblems>({});
  const [state, setState] = useState<State>({ kind: "idle" });
  const shown = useRef(0);
  const website = useRef<HTMLInputElement>(null);
  const done = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    shown.current = Date.now();
  }, []);
  useEffect(() => {
    if (state.kind === "done") done.current?.focus();
  }, [state.kind]);

  const set = (key: keyof CommentDraft, value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setProblems((p) => {
      const next = { ...p };
      delete next[key];
      return next;
    });
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.kind === "sending") return;
    const found = commentProblems(draft);
    if (Object.keys(found).length > 0) {
      setProblems(found);
      const first = (["name", "email", "body"] as const).find((k) => found[k]);
      if (first) document.getElementById(`${id}-${first}`)?.focus();
      return;
    }
    setState({ kind: "sending" });
    try {
      const response = await fetch("/api/blog/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store, market, article, ...draft, website: website.current?.value ?? "", elapsed: Date.now() - shown.current }),
      });
      const answer = (await response.json().catch(() => ({ ok: false, error: "failed" }))) as CommentAnswer;
      if (answer.ok) {
        setState({ kind: "done", shown: answer.shown });
        if (answer.shown) router.refresh();
        return;
      }
      if (answer.problems) {
        setProblems(answer.problems);
        setState({ kind: "idle" });
        return;
      }
      setState({ kind: "failed", text: answer.error === "busy" ? m.busy : answer.error === "closed" ? m.closed : m.failed });
    } catch {
      setState({ kind: "failed", text: m.failed });
    }
  }

  if (state.kind === "done") {
    return (
      <p ref={done} tabIndex={-1} role="status" className="rounded-md bg-surface p-4 outline-none">
        {state.shown ? m.shown : m.waiting}
      </p>
    );
  }

  const problem = (key: keyof CommentDraft) => {
    const which = problems[key];
    return which ? m.problems[key][which] : null;
  };
  const sending = state.kind === "sending";
  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4" aria-labelledby={`${id}-heading`}>
      <h3 id={`${id}-heading`} className="text-lg font-heading">
        {m.write}
      </h3>
      {/* People never see this field; robots fill it in. */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Website
          <input ref={website} name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      <div className="grid gap-4 kzb-md-grid-cols-2">
        <label className={labelClass}>
          {m.name}
          <input
            id={`${id}-name`}
            value={draft.name}
            maxLength={COMMENT_NAME_MAX}
            autoComplete="name"
            required
            aria-invalid={Boolean(problems.name) || undefined}
            aria-describedby={problems.name ? `${id}-name-problem` : undefined}
            onChange={(e) => set("name", e.target.value)}
            className={input}
          />
          {problem("name") && (
            <span id={`${id}-name-problem`} className="text-sm text-red-700 dark:text-red-400">
              {problem("name")}
            </span>
          )}
        </label>
        <label className={labelClass}>
          {m.email}
          <input
            id={`${id}-email`}
            type="email"
            value={draft.email}
            maxLength={COMMENT_EMAIL_MAX}
            autoComplete="email"
            aria-invalid={Boolean(problems.email) || undefined}
            aria-describedby={`${id}-email-hint${problems.email ? ` ${id}-email-problem` : ""}`}
            onChange={(e) => set("email", e.target.value)}
            className={input}
          />
          <span id={`${id}-email-hint`} className="text-xs font-normal text-muted">
            {m.emailHint}
          </span>
          {problem("email") && (
            <span id={`${id}-email-problem`} className="text-sm text-red-700 dark:text-red-400">
              {problem("email")}
            </span>
          )}
        </label>
      </div>
      <label className={labelClass}>
        {m.body}
        <textarea
          id={`${id}-body`}
          value={draft.body}
          maxLength={COMMENT_BODY_MAX}
          rows={5}
          required
          aria-invalid={Boolean(problems.body) || undefined}
          aria-describedby={problems.body ? `${id}-body-problem` : undefined}
          onChange={(e) => set("body", e.target.value)}
          className={`${input} py-2`}
        />
        {problem("body") && (
          <span id={`${id}-body-problem`} className="text-sm text-red-700 dark:text-red-400">
            {problem("body")}
          </span>
        )}
      </label>
      <p className="text-xs text-muted">{m.privacy}</p>
      <div>
        <button type="submit" disabled={sending} className="button-primary rounded-button min-h-11 px-5 disabled:opacity-60">
          {sending ? m.sending : m.send}
        </button>
      </div>
      {state.kind === "failed" && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {state.text}
        </p>
      )}
    </form>
  );
}
