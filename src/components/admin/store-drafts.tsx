"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";

import { fillWords } from "@/lib/admin-fill";
import type { DraftView } from "@/server/store-drafts";

import { useAdminText } from "./admin-text";
import { Button, CARD_CLASS, Chip } from "./ui";

type Result = { ok: true; draft: DraftView | null; notes?: string[] } | { ok: false; problem: string };

export type DraftActions = {
  start(description: string, pages: string[]): Promise<Result>;
  state(): Promise<Result>;
  publish(id: string): Promise<Result>;
  discard(id: string): Promise<Result>;
};

/**
 * A store drafted from one description (D351): with no draft, *Start from a description* (a few sentences and, if wanted, more pages);
 * with one, *Your drafts*: each page as it is built, with a link to open it, the theme, and *Publish all* once every page is ready. Asks
 * again every ten seconds while a page is being built.
 */
export function StoreDraftPanel({ storeSlug, initial, canDraft, actions }: { storeSlug: string; initial: DraftView | null; canDraft: boolean; actions: DraftActions }) {
  const w = useAdminText("home").drafts;
  const router = useRouter();
  const id = useId();
  const [draft, setDraft] = useState(initial);
  const [description, setDescription] = useState("");
  const [pages, setPages] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [busy, startBusy] = useTransition();
  const building = draft !== null && !draft.ready;

  useEffect(() => {
    if (!building) return;
    const timer = window.setInterval(() => {
      void actions.state().then((result) => result.ok && setDraft(result.draft));
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [building, actions]);

  const run = (work: DraftActions["state"], after?: (result: Extract<Result, { ok: true }>) => void) =>
    startBusy(async () => {
      setProblem(null);
      const result = await work();
      if (!result.ok) return setProblem(result.problem);
      setDraft(result.draft);
      after?.(result);
    });

  if (!draft) {
    if (!canDraft) return null;
    return (
      <section className={`${CARD_CLASS} flex flex-col gap-3 p-6`} aria-labelledby={`${id}-title`} data-start-draft="">
        <h2 id={`${id}-title`} className="text-title text-ink">
          {w.title}
        </h2>
        <p className="text-sm text-ink-2">{w.intro}</p>
        {notes.length > 0 && (
          <p role="status" className="text-sm text-ink-2">
            {w.published} {notes.join(" ")}
          </p>
        )}
        <label className="flex flex-col gap-1 text-sm">
          {w.description}
          <textarea rows={4} maxLength={1500} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={w.placeholder} className="rounded-md border border-line bg-card px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {w.pages}
          <textarea rows={3} value={pages} onChange={(e) => setPages(e.target.value)} aria-describedby={`${id}-pages`} className="rounded-md border border-line bg-card px-3 py-2" />
          <span id={`${id}-pages`} className="text-caption text-muted">
            {w.pagesHint}
          </span>
        </label>
        {problem && (
          <p role="alert" className="text-sm text-danger-text">
            {problem}
          </p>
        )}
        <Button
          kind="main"
          disabled={busy || description.trim().length < 10}
          className="self-start"
          onClick={() => run(() => actions.start(description, pages.split("\n").map((line) => line.trim()).filter(Boolean)))}
        >
          {w.start}
        </Button>
      </section>
    );
  }

  return (
    <section className={`${CARD_CLASS} flex flex-col gap-3 p-6`} aria-labelledby={`${id}-drafts`} aria-busy={busy} data-your-drafts="">
      <h2 id={`${id}-drafts`} className="text-title text-ink">
        {w.yourDrafts}
      </h2>
      <p className="text-sm text-ink-2">{w.yourDraftsIntro}</p>
      <ul className="flex flex-col divide-y divide-line">
        {draft.pages.map((page) => (
          <li key={page.job} className="flex flex-wrap items-center gap-3 py-2.5" data-draft-page={page.status}>
            <span className="text-sm text-ink">{page.title}</span>
            <Chip signal={page.status === "built" ? "positive" : page.status === "failed" ? "danger" : "neutral"}>
              {page.status === "built" ? w.built : page.status === "failed" ? w.failed : w.building}
            </Chip>
            {page.problem && <span className="text-caption text-muted">{page.problem}</span>}
            {page.pageId && (
              <Link href={`/admin/${storeSlug}/pages/${page.pageId}`} className="ml-auto rounded-pill px-3 py-1 text-sm underline">
                {w.open}
              </Link>
            )}
          </li>
        ))}
      </ul>
      {draft.theme && <p className="text-sm text-ink-2">{fillWords(w.theme, { title: draft.theme.title })}</p>}
      {problem && (
        <p role="alert" className="text-sm text-danger-text">
          {problem}
        </p>
      )}
      <p className="text-caption text-muted">{draft.ready ? w.publishHint : w.waiting}</p>
      <div className="flex gap-2">
        <Button
          kind="main"
          disabled={busy || !draft.ready}
          onClick={() =>
            run(
              () => actions.publish(draft.id),
              (result) => {
                setNotes(result.notes ?? []);
                router.refresh();
              },
            )
          }
        >
          {w.publish}
        </Button>
        <Button
          kind="quiet"
          disabled={busy}
          onClick={() => {
            if (window.confirm(w.confirmDiscard)) run(() => actions.discard(draft.id));
          }}
        >
          {w.discard}
        </Button>
      </div>
    </section>
  );
}
