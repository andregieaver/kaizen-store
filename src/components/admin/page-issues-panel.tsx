"use client";

import { useEffect, useRef } from "react";

import { groupIssues, type PageIssue } from "@/lib/page-a11y";

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
  return (
    <section aria-labelledby="page-checks" className="flex flex-col gap-3">
      <h3 id="page-checks" className="text-sm font-medium">
        Checks
      </h3>
      <p role="status" aria-live="polite" className="text-sm">
        {issues.length === 0
          ? "No problems found."
          : `${blocking > 0 ? `${blocking} to fix before publishing` : "Nothing blocks publishing"}${warnings > 0 ? `${blocking > 0 ? ", " : ": "}${warnings} to look at` : ""}.`}
      </p>
      {groups.map((group) => (
        <div key={group.rule} className="flex flex-col gap-1">
          <h4 className="text-xs font-medium tracking-wide text-muted uppercase">
            {group.title} <span className="normal-case">({group.severity === "blocking" ? "blocks publishing" : "worth a look"})</span>
          </h4>
          <ul className="flex flex-col gap-1">
            {group.issues.map((issue, index) => (
              <li key={`${issue.blockId ?? issue.rowId ?? "page"}-${index}`} className="flex flex-col gap-1 rounded-md border border-border bg-background p-2 text-sm">
                <span>
                  <span className="font-medium">{issue.where}.</span> {issue.message}
                </span>
                {(issue.blockId ?? issue.columnId ?? issue.rowId) && (
                  <button
                    type="button"
                    onClick={() => onShow(issue)}
                    aria-label={`Show the ${issue.where.toLowerCase()} on the page: ${group.title.toLowerCase()}`}
                    className="min-h-9 w-fit rounded-md border border-border px-3 text-xs font-medium hover:bg-surface"
                  >
                    Show it
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="text-xs text-muted">Pictures behind text are not checked. A check like this finds only part of the problems: it does not replace looking at the page with a keyboard and a screen reader.</p>
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
  return (
    <dialog
      ref={ref}
      aria-labelledby="publish-issues-title"
      onCancel={(event) => {
        event.preventDefault();
        onFixFirst();
      }}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-border bg-background p-5 text-foreground backdrop:bg-black/40"
    >
      <h2 id="publish-issues-title" className="mb-2 text-lg font-semibold">
        This page has {issues.length === 1 ? "a problem" : `${issues.length} problems`} to look at
      </h2>
      <p className="mb-3 text-sm text-muted">Fix {issues.length === 1 ? "it" : "them"} first, or publish anyway. Publishing anyway is written down in the activity log.</p>
      <ul className="mb-4 flex max-h-64 flex-col gap-1 overflow-y-auto text-sm">
        {groups.map((group) => (
          <li key={group.rule}>
            <span className="font-medium">{group.title}</span>: {group.issues.length === 1 ? group.issues[0].message : `${group.issues.length} places`}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onFixFirst} className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background">
          Fix first
        </button>
        <button type="button" onClick={onPublishAnyway} disabled={busy} className="min-h-10 rounded-md border border-border bg-background px-4 text-sm font-medium disabled:opacity-50">
          Publish anyway
        </button>
      </div>
    </dialog>
  );
}
