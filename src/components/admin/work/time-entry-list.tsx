"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { deleteTimeEntryAction, setEntryNoteAction } from "@/app/admin/(gated)/[store]/work/actions";
import { formatDay } from "@/lib/work-dates";
import { formatDuration } from "@/lib/work-time";
import { entryAccess } from "@/lib/work-ui";
import type { TimeEntryItem } from "@/server/work-time";

import { Badge, Problems, dangerLink, smallControl } from "./work-parts";

function EntryRow({
  storeSlug,
  base,
  entry,
  viewer,
  showAssignment,
  showPerson,
  locale,
}: {
  storeSlug: string;
  base: string;
  entry: TimeEntryItem;
  viewer: { accountId: string; owner: boolean };
  showAssignment: boolean;
  showPerson: boolean;
  locale: string;
}) {
  const access = entryAccess(entry, viewer);
  const [note, setNote] = useState(entry.note ?? "");
  const [seen, setSeen] = useState(entry.note);
  if (entry.note !== seen) {
    // The server's note changed (after a save, or someone else's edit): show it.
    setSeen(entry.note);
    setNote(entry.note ?? "");
  }
  const [pending, start] = useTransition();
  const [problems, setProblems] = useState<string[]>([]);

  const commitNote = () => {
    if (note.trim() === (entry.note ?? "").trim()) return;
    start(async () => {
      try {
        const result = await setEntryNoteAction(storeSlug, entry.id, { note });
        if (!result.ok) {
          setProblems(result.problems);
          setNote(entry.note ?? "");
        } else setProblems([]);
      } catch {
        setProblems(["The note could not be saved. Check your connection and try again."]);
      }
    });
  };

  const remove = () => {
    if (!window.confirm(`Delete ${formatDuration(entry.minutes)} logged on ${formatDay(entry.workDate, locale)}?`))
      return;
    start(async () => {
      try {
        const result = await deleteTimeEntryAction(storeSlug, entry.id);
        setProblems(result.ok ? [] : result.problems);
      } catch {
        setProblems(["The time could not be deleted. Check your connection and try again."]);
      }
    });
  };

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span className="font-medium tabular-nums">{formatDay(entry.workDate, locale)}</span>
        <span className="tabular-nums">{formatDuration(entry.minutes)}</span>
        {!entry.billable && <Badge>Not billable</Badge>}
        {entry.invoiceStatus === "draft" && <Badge tone="warn">On a draft invoice</Badge>}
        {entry.locked && <Badge tone="good">Invoiced{entry.invoiceNumber ? ` ${entry.invoiceNumber}` : ""}</Badge>}
        {entry.taskTitle && <span className="min-w-0 text-muted [overflow-wrap:anywhere]">{entry.taskTitle}</span>}
        {showPerson && <span className="text-muted">{entry.accountName}</span>}
      </div>
      {showAssignment && (
        <p className="text-sm [overflow-wrap:anywhere]">
          <Link href={`${base}/assignments/${entry.assignmentId}`} className="underline">
            {entry.assignmentName}
          </Link>{" "}
          <span className="text-muted">
            for{" "}
            <Link href={`${base}/clients/${entry.clientId}`} className="underline">
              {entry.clientName}
            </Link>
          </span>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {access.note ? (
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onBlur={commitNote}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
              if (event.key === "Escape") setNote(entry.note ?? "");
            }}
            maxLength={500}
            placeholder="Add a note"
            aria-label={`Note for ${formatDuration(entry.minutes)} on ${formatDay(entry.workDate, locale)}`}
            disabled={pending}
            className={`${smallControl} min-w-0 flex-1`}
          />
        ) : (
          <p className="min-w-0 flex-1 text-sm text-muted [overflow-wrap:anywhere]">{entry.note ?? "No note"}</p>
        )}
        {access.delete ? (
          <button type="button" onClick={remove} disabled={pending} className={dangerLink}>
            Delete
            <span className="sr-only">
              {" "}
              {formatDuration(entry.minutes)} on {formatDay(entry.workDate, locale)}
            </span>
          </button>
        ) : (
          access.why && <span className="text-xs text-muted">{access.why}</span>
        )}
      </div>
      <Problems messages={problems} />
    </li>
  );
}

/**
 * Logged time, newest first: the day, how long, on what and by whom, a note
 * that is always there to type in (saved when you leave it or press Enter),
 * and Delete. What may be changed follows the rules: owners change any entry,
 * others their own, and time on an issued invoice not at all (it says why).
 */
export function TimeEntryList({
  storeSlug,
  entries,
  viewer,
  showAssignment = true,
  showPerson = true,
  locale,
  empty = "No time logged.",
}: {
  storeSlug: string;
  entries: TimeEntryItem[];
  viewer: { accountId: string; owner: boolean };
  showAssignment?: boolean;
  showPerson?: boolean;
  locale: string;
  empty?: string;
}) {
  const base = `/admin/${storeSlug}/work`;
  if (entries.length === 0) {
    return <p className="rounded-lg border border-border bg-background p-4 text-sm text-muted">{empty}</p>;
  }
  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-background">
      {entries.map((entry) => (
        <EntryRow
          key={entry.id}
          storeSlug={storeSlug}
          base={base}
          entry={entry}
          viewer={viewer}
          showAssignment={showAssignment}
          showPerson={showPerson}
          locale={locale}
        />
      ))}
    </ul>
  );
}
