import Link from "next/link";

import { Avatar } from "@/components/avatar";
import { AUDIT_AREA_LABELS, actionLabel, activityQuery, changeLine } from "@/lib/activity-text";
import type { AuditArea } from "@/lib/audit";
import { avatarFor } from "@/server/avatars";
import type { ActivityEntry } from "@/server/activity";
import { CARD_CLASS } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { staffEn, type StaffMessages } from "@/lib/admin-messages/staff.en";

/** An area's name: the account's words when given (D312 A8), else the log's English. */
const areaName = (area: AuditArea, words?: StaffMessages) => (words ? words.areas[area] : AUDIT_AREA_LABELS[area]);

/** An action's name in the filter: its sentence in the account's words where one is written, else the action's own words. */
const actionName = (action: string, words?: StaffMessages) => {
  const sentence = words?.activity.sentences[action];
  return sentence ? fillWords(sentence, { label: "…" }).trim() : actionLabel(action);
};

/** An entry's sentence in the account's words where its action has one; otherwise the sentence the server wrote. */
function entrySentence(entry: ActivityEntry, words?: StaffMessages): string {
  const sentence = words?.activity.sentences[entry.action];
  if (!words || !sentence) return entry.summary;
  const label = entry.target?.label?.trim() || (entry.target ? `${entry.target.type} ${entry.target.id}` : words.activity.it);
  return fillWords(sentence, { label });
}

const field = "min-h-10 rounded-md border border-line bg-card px-3 text-sm font-normal";

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
  words,
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
  /** The account's words (D312 A8); English unless given. */
  words?: StaffMessages;
}) {
  const w = (words ?? staffEn).activity;
  return (
    <div className="flex flex-col gap-4">
      <form method="get" action={action} className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <label className="flex flex-col gap-1 text-sm font-medium">
          {w.person}
          <select name="person" defaultValue={values.person} className={field}>
            <option value="">{w.everyone}</option>
            {people.map((p) => (
              <option key={p.accountId} value={p.accountId}>
                {p.label}
                {p.current === false ? w.past : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {w.area}
          <select name="area" defaultValue={values.area} className={field}>
            <option value="">{w.allAreas}</option>
            {areas.map((area) => (
              <option key={area} value={area}>
                {areaName(area, words)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {w.action}
          <select name="action" defaultValue={values.action} className={field}>
            <option value="">{w.anyAction}</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {actionName(a, words)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {w.from}
          <input type="date" name="from" defaultValue={values.from} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {w.to}
          <input type="date" name="to" defaultValue={values.to} className={field} />
        </label>
        <div className="flex gap-2">
          <button type="submit" className="min-h-10 rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink">
            {w.filter}
          </button>
          <Link href={action} className="inline-flex min-h-10 items-center rounded-pill border border-edge bg-card px-4 text-sm hover:bg-sunken">
            {w.clear}
          </Link>
        </div>
      </form>
      <p className="text-xs text-muted">{fillWords(w.zone, { zone: zoneName })}</p>
      {exportAction && (
        <form method="get" action={exportAction} className={`flex flex-wrap items-end gap-3 p-4 ${CARD_CLASS}`}>
          <input type="hidden" name="person" value={values.person} />
          <input type="hidden" name="area" value={values.area} />
          <input type="hidden" name="action" value={values.action} />
          <p className="basis-full text-sm font-medium">{w.download}</p>
          <label className="flex flex-col gap-1 text-sm">
            {w.firstDay}
            <input type="date" name="from" required defaultValue={values.from} className={field} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {w.lastDay}
            <input type="date" name="to" required defaultValue={values.to} className={field} />
          </label>
          <button type="submit" className="min-h-10 rounded-pill border border-edge bg-card px-4 text-sm font-medium hover:bg-sunken">
            {w.downloadCsv}
          </button>
          <p className="basis-full text-xs text-muted">{w.downloadNote}</p>
        </form>
      )}
    </div>
  );
}

/** One entry's time, with the date, in the viewer's zone. */
const when = (iso: string, zone: string, locale = "en-GB") => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: zone }).format(new Date(iso));

/**
 * The entries, newest first: a sentence made by code, who did it, where it belongs and when; the changed fields as from and to behind
 * "Details". A page of 50 with a link to the older ones.
 */
export function ActivityList({
  entries,
  zone,
  older,
  empty,
  words,
  locale,
}: {
  entries: readonly ActivityEntry[];
  zone: string;
  /** The address of the next, older page; none on the last. */
  older?: string | null;
  empty?: string;
  /** The account's words (D312 A8); English unless given. */
  words?: StaffMessages;
  /** How dates are written in them. */
  locale?: string;
}) {
  const w = (words ?? staffEn).activity;
  if (entries.length === 0) return <p className={`p-5 text-sm text-muted ${CARD_CLASS}`}>{empty ?? w.empty}</p>;
  const values = words ? { none: w.none, yes: w.yes, no: w.no } : undefined;
  return (
    <div className="flex flex-col gap-4">
      <ol className={`divide-y divide-line ${CARD_CLASS}`}>
        {entries.map((entry) => {
          const lines = entry.changes ? Object.entries(entry.changes).map(([key, change]) => changeLine(key, change, values)) : [];
          return (
            <li key={entry.id} className="flex gap-3 p-4 text-sm">
              <Avatar avatar={avatarFor({ email: entry.email ?? "", name: entry.name, avatarPath: entry.avatarPath })} size={32} />
              <div className="min-w-0 flex-1">
                <p className="font-medium break-words">{entrySentence(entry, words)}</p>
                <p className="text-muted">
                  {entry.name ?? entry.email ?? w.platform} · {areaName(entry.area, words)} · <time dateTime={entry.at}>{when(entry.at, zone, locale)}</time>
                </p>
                {lines.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-muted">{w.details}</summary>
                    <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[max-content_1fr]">
                      {lines.map((line) => (
                        <div key={line.label} className="contents">
                          <dt className="text-muted">{line.label}</dt>
                          <dd className="break-words">{line.from === null ? w.changed : `${line.from} → ${line.to}`}</dd>
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
          <Link href={older} className="inline-flex min-h-10 items-center rounded-pill border border-edge bg-card px-4 text-sm font-medium hover:bg-sunken">
            {w.older}
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
