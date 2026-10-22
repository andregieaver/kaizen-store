"use client";

import { useEffect, useRef } from "react";

import { groupIssues, type PageIssue } from "@/lib/page-a11y";
import { CARD_CLASS } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";

import { useAdminText } from "./admin-text";

/**
 * Takes the person to a row, column or component on the builder's canvas: scrolls it into view and focuses it, so a keyboard user lands on
 * it and Enter opens its settings. The builder marks each of them with `data-builder-id`. Nothing happens when it is not on the canvas
 * (the page's own title has no block, and a translated view draws fewer).
 */
export function showOnCanvas(issue: Pick<PageIssue, "blockId" | "columnId" | "rowId">): boolean {
  const id = issue.blockId ?? issue.columnId ?? issue.rowId;
  if (!id) return false;
  const found = document.querySelector<HTMLElement>(`[data-builder-id="${CSS.escape(id)}"]`);
  if (!found) return false;
  found.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  found.focus({ preventScroll: true });
  return true;
}

/**
 * The page checker's findings for the page being edited (wave 1, 1e, docs/wave-1-trust.md 2.2): grouped by what is wrong, blocking ones first,
 * each with a button that takes the person to the component. It lists what a reader, a screen reader or the checkout's policy would meet;
 * it cannot see a picture behind text, and an automated check finds only part of the problems. Draft saves are never held back by it.
 */
export function PageIssuesPanel({ issues, onShow = showOnCanvas }: { issues: readonly PageIssue[]; onShow?: (issue: PageIssue) => void }) {
  const groups = groupIssues(issues);
  const blocking = issues.filter((i) => i.severity === "blocking").length;
  const warnings = issues.length - blocking;
  const w = useAdminText("builder").issues;
  return (
    <section aria-labelledby="page-checks" className="flex flex-col gap-3">
      <h3 id="page-checks" className="text-body-strong text-ink">
        {w.title}
      </h3>
      <p role="status" aria-live="polite" className="text-sm">
        {issues.length === 0
          ? w.noProblems
          : `${blocking > 0 ? fillWords(w.toFix, { n: blocking }) : w.nothingBlocks}${warnings > 0 ? `${blocking > 0 ? ", " : ": "}${fillWords(w.toLook, { n: warnings })}` : ""}.`}
      </p>
      {groups.map((group) => (
        <div key={group.rule} className="flex flex-col gap-1">
          <h4 className="text-eyebrow text-muted uppercase">
            {group.title} <span className="normal-case">({group.severity === "blocking" ? w.blocks : w.worthALook})</span>
          </h4>
          <ul className="flex flex-col gap-1">
            {group.issues.map((issue, index) => (
              <li key={`${issue.blockId ?? issue.rowId ?? "page"}-${index}`} className="flex flex-col gap-1 rounded-md border border-line bg-card p-2 text-sm">
                <span>
                  <span className="font-medium">{issue.where}.</span> {issue.message}
                </span>
                {(issue.blockId ?? issue.columnId ?? issue.rowId) && (
                  <button
                    type="button"
                    onClick={() => onShow(issue)}
                    aria-label={fillWords(w.showLabel, { where: issue.where.toLowerCase(), title: group.title.toLowerCase() })}
                    className="min-h-9 w-fit rounded-pill border border-edge px-3 text-xs font-medium hover:bg-sunken"
                  >
                    {w.show}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="text-xs text-muted">{w.limits}</p>
    </section>
  );
}

/**
 * The question before publishing with a blocking problem (wave 1, 1e): "Publish anyway" says the owner has seen them and is recorded in the
 * audit log; "Fix first" goes back. The server asks the same question again, so skipping this dialog skips nothing.
 */
export function PublishWithIssuesDialog({
  issues,
  busy,
  onPublishAnyway,
  onFixFirst,
}: {
  issues: readonly PageIssue[];
  busy: boolean;
  onPublishAnyway: () => void;
  onFixFirst: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  const groups = groupIssues(issues);
  const w = useAdminText("builder").issues;
  return (
    <dialog
      ref={ref}
      aria-labelledby="publish-issues-title"
      onCancel={(event) => {
        event.preventDefault();
        onFixFirst();
      }}
      className={`m-auto w-[min(32rem,calc(100vw-2rem))] p-5 text-ink backdrop:bg-black/40 ${CARD_CLASS}`}
    >
      <h2 id="publish-issues-title" className="mb-2 text-title text-ink">
        {countWords(issues.length, w.hasProblems)}
      </h2>
      <p className="mb-3 text-sm text-muted">{countWords(issues.length, w.fixOrPublish)}</p>
      <ul className="mb-4 flex max-h-64 flex-col gap-1 overflow-y-auto text-sm">
        {groups.map((group) => (
          <li key={group.rule}>
            <span className="font-medium">{group.title}</span>: {group.issues.length === 1 ? group.issues[0].message : fillWords(w.places, { n: group.issues.length })}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onFixFirst} className="min-h-10 rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink">
          {w.fixFirst}
        </button>
        <button type="button" onClick={onPublishAnyway} disabled={busy} className="min-h-10 rounded-pill border border-edge bg-card px-4 text-sm font-medium disabled:opacity-50">
          {w.publishAnyway}
        </button>
      </div>
    </dialog>
  );
}
