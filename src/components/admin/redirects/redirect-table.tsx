"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { hint, primary, secondary, tableShell, td, th } from "@/components/admin/data/ui";
import { REDIRECT_BULK_DELETE_MAX } from "@/lib/data-limits";
import { deleteSelectedWords, kindWords, madeByWords, usedWords } from "@/lib/redirect-admin";
import { redirectStatusWords, type RedirectKind, type RedirectStatus } from "@/lib/redirects";

import { RedirectForm, type RedirectFormActions } from "./redirect-form";

/** A row of the list as the page reads it (`ListedRedirect` of the service, as plain data). */
export type TableRow = {
  id: string;
  kind: RedirectKind | "page" | "article";
  source: string;
  target: string | null;
  origin: string;
  hits: number | null;
  lastHitAt: string | null;
  createdAt: string;
  createdBy: string | null;
  readOnly: boolean;
  status: RedirectStatus;
  more: number;
};

export type RedirectTableActions = RedirectFormActions & {
  remove: (ids: string[]) => Promise<{ ok: true; deleted: number } | { ok: false; problems: string[] }>;
};

const STATUS_STYLE: Record<RedirectStatus, string> = {
  active: "text-foreground",
  not_used: "text-muted",
  target_missing: "text-amber-700 dark:text-amber-400",
  chain: "text-amber-700 dark:text-amber-400",
};

/** The status of a row in words, never by colour alone. */
export function StatusText({ status, more }: { status: RedirectStatus; more: number }) {
  return <span className={STATUS_STYLE[status]}>{redirectStatusWords(status, more)}</span>;
}

/** The row's target: the current address of the thing for an automatic redirect, and what the shopper meets when it is not live. */
export function TargetCell({ row }: { row: Pick<TableRow, "kind" | "target" | "readOnly"> }) {
  if (row.target) return <code className="break-all text-xs">{row.target}</code>;
  return <span className={hint}>{row.kind === "manual" ? "" : "Not live now: shoppers get the not-found page"}</span>;
}

/**
 * The store's redirects as a table (2.2.1, 2.2.3): from, to, kind, use (at least, a lower bound), who made it and when, and a status in words. A member who
 * may change the website can edit a manual redirect (the form opens under the row), delete any redirect of the store (automatic ones too, after a
 * confirmation), and delete a selection (at most 200 a request; there is no "delete all"). Pages' and articles' redirects are the pages' own and read only.
 * The page asks the server for the rows; every change goes through the page's bound actions and refreshes the list.
 */
export function RedirectTable({ rows, timeZone, actions, canWrite }: { rows: TableRow[]; timeZone: string; actions: RedirectTableActions; canWrite: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [asking, setAsking] = useState<string[] | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const selectable = rows.filter((r) => !r.readOnly);
  const all = selectable.length > 0 && selectable.every((r) => selected.has(r.id));

  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const remove = (ids: string[]) =>
    start(async () => {
      setProblems([]);
      setNotice(null);
      const result = await actions.remove(ids);
      if (!result.ok) {
        setProblems(result.problems);
        return;
      }
      setAsking(null);
      setSelected(new Set());
      setNotice(`${result.deleted} redirect${result.deleted === 1 ? "" : "s"} deleted.`);
      router.refresh();
    });

  const columns = canWrite ? 8 : 7;
  return (
    <div className="flex flex-col gap-3" aria-busy={pending}>
      {canWrite && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-3 text-sm" role="group" aria-label="Selected redirects">
          {asking && asking.length > 1 ? (
            <>
              <span>Delete {asking.length} redirects? Browsers that have seen them may keep following them for a while.</span>
              <button type="button" disabled={pending} onClick={() => remove(asking)} className={primary}>
                {pending ? "Deleting …" : "Yes, delete"}
              </button>
              <button type="button" disabled={pending} onClick={() => setAsking(null)} className={secondary}>
                Not yet
              </button>
            </>
          ) : (
            <>
              <span>{selected.size} selected</span>
              <button type="button" disabled={selected.size > REDIRECT_BULK_DELETE_MAX} onClick={() => setAsking([...selected])} className={secondary}>
                {deleteSelectedWords(selected.size, REDIRECT_BULK_DELETE_MAX)}
              </button>
              <button type="button" onClick={() => setSelected(new Set())} className="underline underline-offset-2">
                Clear the selection
              </button>
            </>
          )}
        </div>
      )}
      <div role="status" aria-live="polite" className="flex flex-col gap-1 text-sm">
        {notice && <p>{notice}</p>}
        {problems.length > 0 && (
          <ul className="list-disc pl-5 text-red-700 dark:text-red-400">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </div>
      <div className={tableShell}>
        <table className="w-full text-sm">
          <caption className="sr-only">The store&apos;s redirects, newest first</caption>
          <thead>
            <tr className="border-b border-border">
              {canWrite && (
                <th scope="col" className={`${th} w-8`}>
                  <input
                    type="checkbox"
                    aria-label="Select every redirect on this page"
                    checked={all}
                    disabled={selectable.length === 0}
                    onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((r) => r.id)) : new Set())}
                    className="size-4"
                  />
                </th>
              )}
              <th scope="col" className={th}>
                From
              </th>
              <th scope="col" className={th}>
                To
              </th>
              <th scope="col" className={th}>
                Kind
              </th>
              <th scope="col" className={`${th} hidden lg:table-cell`}>
                Used
              </th>
              <th scope="col" className={`${th} hidden lg:table-cell`}>
                Made
              </th>
              <th scope="col" className={th}>
                Status
              </th>
              <th scope="col" className={th}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <RowGroup
                key={`${row.kind}-${row.id}`}
                row={row}
                timeZone={timeZone}
                canWrite={canWrite}
                columns={columns}
                selected={selected.has(row.id)}
                onSelect={(on) => toggle(row.id, on)}
                editing={editing === row.id}
                onEdit={(on) => setEditing(on ? row.id : null)}
                asking={asking?.length === 1 && asking[0] === row.id}
                onAsk={(on) => setAsking(on ? [row.id] : null)}
                onDelete={() => remove([row.id])}
                pending={pending}
                actions={actions}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowGroup({
  row,
  timeZone,
  canWrite,
  columns,
  selected,
  onSelect,
  editing,
  onEdit,
  asking,
  onAsk,
  onDelete,
  pending,
  actions,
}: {
  row: TableRow;
  timeZone: string;
  canWrite: boolean;
  columns: number;
  selected: boolean;
  onSelect: (on: boolean) => void;
  editing: boolean;
  onEdit: (on: boolean) => void;
  asking: boolean;
  onAsk: (on: boolean) => void;
  onDelete: () => void;
  pending: boolean;
  actions: RedirectTableActions;
}) {
  const manual = row.kind === "manual";
  return (
    <>
      <tr className="border-b border-border last:border-0">
        {canWrite && (
          <td className={td}>
            {!row.readOnly && <input type="checkbox" aria-label={`Select the redirect from ${row.source}`} checked={selected} onChange={(e) => onSelect(e.target.checked)} className="size-4" />}
          </td>
        )}
        <td className={td}>
          <code className="break-all text-xs">{row.source}</code>
        </td>
        <td className={td}>
          <TargetCell row={row} />
        </td>
        <td className={td}>{kindWords(row.kind)}</td>
        <td className={`${td} hidden lg:table-cell`}>{usedWords(row.hits, row.lastHitAt, timeZone)}</td>
        <td className={`${td} hidden lg:table-cell`}>{madeByWords(row)}</td>
        <td className={td}>
          <StatusText status={row.status} more={row.more} />
        </td>
        <td className={`${td} text-right`}>
          {canWrite && !row.readOnly && (
            <span className="flex flex-wrap justify-end gap-2">
              {asking ? (
                <>
                  <span className="text-xs">Delete it?</span>
                  <button type="button" disabled={pending} onClick={onDelete} className="underline underline-offset-2">
                    Yes, delete
                  </button>
                  <button type="button" disabled={pending} onClick={() => onAsk(false)} className="underline underline-offset-2">
                    Keep
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => onEdit(!editing)} className="underline underline-offset-2" aria-label={`${manual ? "Edit" : "Replace"} the redirect from ${row.source}`}>
                    {manual ? "Edit" : "Replace"}
                  </button>
                  <button type="button" onClick={() => onAsk(true)} className="underline underline-offset-2" aria-label={`Delete the redirect from ${row.source}`}>
                    Delete
                  </button>
                </>
              )}
            </span>
          )}
        </td>
      </tr>
      {editing && (
        <tr className="border-b border-border bg-background">
          <td colSpan={columns} className="p-3">
            {manual ? (
              <RedirectForm actions={actions} initial={{ from: row.source, to: row.target ?? "" }} editing={{ id: row.id, source: row.source }} onDone={() => onEdit(false)} onCancel={() => onEdit(false)} />
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-sm">Kaizen made this redirect when an address changed, so it cannot be edited. Make a redirect of your own from the same address to replace it.</p>
                <RedirectForm actions={actions} initial={{ from: row.source, to: "" }} onDone={() => onEdit(false)} onCancel={() => onEdit(false)} submitLabel="Replace it with this redirect" />
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
