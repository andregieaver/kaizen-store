"use client";

import { useId, useState } from "react";

import { fillWords } from "@/lib/admin-fill";
import { DOCS_FEEDBACK_MAX } from "@/lib/docs-feedback";

export type DocsFeedbackWords = {
  question: string;
  yes: string;
  no: string;
  more: string;
  hint: string;
  send: string;
  thanks: string;
  thanksMore: string;
  tooLong: string;
  failed: string;
};

type Stage = { kind: "ask" } | { kind: "more"; id: string } | { kind: "done"; said: boolean };

async function post(body: unknown): Promise<Response> {
  return fetch("/api/docs/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

/**
 * *Was this page helpful?* (D442): a yes or a no is kept at once (`/api/docs/feedback`, on whichever host serves the page), then an
 * optional sentence can be added to it. Nothing about the reader is sent or kept: the page, its language, the answer and the sentence.
 */
export function DocsFeedback({ path, lang, words }: { path: string; lang: string; words: DocsFeedbackWords }) {
  const [stage, setStage] = useState<Stage>({ kind: "ask" });
  const [comment, setComment] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const question = useId();
  const field = useId();
  const hint = useId();

  const vote = async (helpful: boolean) => {
    setBusy(true);
    setProblem(null);
    try {
      const answer = await post({ path, lang, helpful });
      const body = (await answer.json().catch(() => null)) as { id?: string } | null;
      if (!answer.ok || !body?.id) throw new Error("not kept");
      setStage({ kind: "more", id: body.id });
    } catch {
      setProblem(words.failed);
    } finally {
      setBusy(false);
    }
  };

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (stage.kind !== "more") return;
    if (comment.trim() === "") {
      setStage({ kind: "done", said: false });
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const answer = await post({ id: stage.id, comment });
      const body = (await answer.json().catch(() => null)) as { over?: number } | null;
      if (answer.status === 422 && typeof body?.over === "number") {
        setProblem(fillWords(words.tooLong, { over: body.over }));
        return;
      }
      if (!answer.ok) throw new Error("not kept");
      setStage({ kind: "done", said: true });
    } catch {
      setProblem(words.failed);
    } finally {
      setBusy(false);
    }
  };

  const button = "inline-flex min-h-11 min-w-16 items-center justify-center rounded-full border border-border px-4 text-sm font-medium hover:bg-surface disabled:opacity-60";
  return (
    <section aria-labelledby={question} className="mt-12 rounded-lg border border-border p-4 print:hidden" data-docs-feedback="">
      <p id={question} className="font-semibold">
        {words.question}
      </p>
      {stage.kind === "ask" && (
        <div className="mt-3 flex gap-2">
          <button type="button" className={button} disabled={busy} onClick={() => vote(true)}>
            {words.yes}
          </button>
          <button type="button" className={button} disabled={busy} onClick={() => vote(false)}>
            {words.no}
          </button>
        </div>
      )}
      {stage.kind === "more" && (
        <form onSubmit={send} className="mt-3 flex flex-col gap-2">
          <p role="status" className="text-sm">
            {words.thanks}
          </p>
          <label htmlFor={field} className="text-sm font-medium">
            {words.more}
          </label>
          <textarea
            id={field}
            name="comment"
            rows={3}
            maxLength={DOCS_FEEDBACK_MAX}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            aria-describedby={hint}
            className="w-full rounded-md border border-border bg-background p-2 text-base"
          />
          <p id={hint} className="text-sm text-muted">
            {words.hint}
          </p>
          <div>
            <button type="submit" className={button} disabled={busy}>
              {words.send}
            </button>
          </div>
        </form>
      )}
      {stage.kind === "done" && (
        <p role="status" className="mt-3 text-sm">
          {stage.said ? words.thanksMore : words.thanks}
        </p>
      )}
      {problem && (
        <p role="alert" className="mt-3 text-sm">
          {problem}
        </p>
      )}
    </section>
  );
}
