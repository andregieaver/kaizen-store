import Link from "next/link";

import { Avatar } from "@/components/avatar";
import { AUDIT_AREA_LABELS, actionLabel, activityQuery, changeLine } from "@/lib/activity-text";
import type { AuditArea } from "@/lib/audit";
import { avatarFor } from "@/server/avatars";
import type { ActivityEntry } from "@/server/activity";

const field = "min-h-10 rounded-md border border-border bg-background px-3 text-sm font-normal";

/** The filters as the page holds them (`?person=&area=&action=&from=&to=`). */
export type ActivityValues = { person: string; area: string; action: string; from: string; to: string };

/**
 * The activity log's filters (wave 1, 1f, docs/wave-1-trust.md 2.9): person, area, action and period, as a plain GET form so a filtered log is
 * a link. Owners also get the CSV: the same period, asked for by a form of its own that needs both days.
 */
export function ActivityFilters({
  action,
  values,
  people,
  areas,
  actions,
  exportAction,
  zoneName,
}: {
  /** Where the form goes: the log's own address. */
  action: string;
  values: ActivityValues;
  people: readonly { accountId: string; label: string; current?: boolean }[];
  areas: readonly AuditArea[];
  actions: readonly string[];
  /** The CSV's address; none where the viewer is not an owner. */
  exportAction?: string;
  /** The time zone the days are in, said under the period. */
  zoneName: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <form method="get" action={action} className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Person
          <select name="person" defaultValue={values.person} className={field}>
            <option value="">Everyone</option>
            {people.map((p) => (
              <option key={p.accountId} value={p.accountId}>
                {p.label}
                {p.current === false ? " (past)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Area
          <select name="area" defaultValue={values.area} className={field}>
            <option value="">All areas</option>
            {areas.map((area) => (
              <option key={area} value={area}>
                {AUDIT_AREA_LABELS[area]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Action
          <select name="action" defaultValue={values.action} className={field}>
            <option value="">Any action</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {actionLabel(a)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          From
          <input type="date" name="from" defaultValue={values.from} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          To
          <input type="date" name="to" defaultValue={values.to} className={field} />
        </label>
        <div className="flex gap-2">
          <button type="submit" className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background">
            Filter
          </button>
          <Link href={action} className="inline-flex min-h-10 items-center rounded-md border border-border bg-background px-4 text-sm hover:bg-surface">
            Clear
          </Link>
        </div>
      </form>
      <p className="text-xs text-muted">Days are in {zoneName}. Entries are kept for 24 months.</p>
      {exportAction && (
        <form method="get" action={exportAction} className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-background p-4">
          <input type="hidden" name="person" value={values.person} />
          <input type="hidden" name="area" value={values.area} />
          <input type="hidden" name="action" value={values.action} />
          <p className="basis-full text-sm font-medium">Download as a spreadsheet (CSV)</p>
          <label className="flex flex-col gap-1 text-sm">
            First day
            <input type="date" name="from" required defaultValue={values.from} className={field} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Last day
            <input type="date" name="to" required defaultValue={values.to} className={field} />
          </label>
          <button type="submit" className="min-h-10 rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-surface">
            Download CSV
          </button>
          <p className="basis-full text-xs text-muted">Owners only. Up to 50,000 entries; choose a shorter period for more. Respects the filters above.</p>
        </form>
      )}
    </div>
  );
}

/** One entry's time, with the date, in the viewer's zone. */
const when = (iso: string, zone: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: zone }).format(new Date(iso));

/**
 * The entries, newest first: a sentence made by code, who did it, where it belongs and when; the changed fields as from and to behind
 * "Details". A page of 50 with a link to the older ones.
 */
export function ActivityList({
  entries,
  zone,
  older,
  empty = "Nothing has been logged for these filters yet.",
}: {
  entries: readonly ActivityEntry[];
  zone: string;
  /** The address of the next, older page; none on the last. */
  older?: string | null;
  empty?: string;
}) {
  if (entries.length === 0) return <p className="rounded-lg border border-border bg-background p-5 text-sm text-muted">{empty}</p>;
  return (
    <div className="flex flex-col gap-4">
      <ol className="divide-y divide-border rounded-lg border border-border bg-background">
        {entries.map((entry) => {
          const lines = entry.changes ? Object.entries(entry.changes).map(([key, change]) => changeLine(key, change)) : [];
          return (
            <li key={entry.id} className="flex gap-3 p-4 text-sm">
              <Avatar avatar={avatarFor({ email: entry.email ?? "", name: entry.name, avatarPath: entry.avatarPath })} size={32} />
              <div className="min-w-0 flex-1">
                <p className="font-medium break-words">{entry.summary}</p>
                <p className="text-muted">
                  {entry.name ?? entry.email ?? "The platform"} · {AUDIT_AREA_LABELS[entry.area]} · <time dateTime={entry.at}>{when(entry.at, zone)}</time>
                </p>
                {lines.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-muted">Details</summary>
                    <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[max-content_1fr]">
                      {lines.map((line) => (
                        <div key={line.label} className="contents">
                          <dt className="text-muted">{line.label}</dt>
                          <dd className="break-words">{line.from === null ? "changed" : `${line.from} → ${line.to}`}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {older && (
        <p>
          <Link href={older} className="inline-flex min-h-10 items-center rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-surface">
            Older entries
          </Link>
        </p>
      )}
    </div>
  );
}

/** The filters a request's query holds, read as plain strings (an array or a missing value is empty). */
export function valuesFromQuery(query: Record<string, string | string[] | undefined>): ActivityValues {
  const one = (name: string) => (typeof query[name] === "string" ? (query[name] as string) : "");
  return { person: one("person"), area: one("area"), action: one("action"), from: one("from"), to: one("to") };
}

export { activityQuery };
