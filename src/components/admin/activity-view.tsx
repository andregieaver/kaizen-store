import Link from "next/link";

import { Avatar } from "@/components/avatar";
import { AUDIT_AREA_LABELS, actionLabel, activityQuery, changeLine } from "@/lib/activity-text";
import type { AuditArea } from "@/lib/audit";
import { avatarFor } from "@/server/avatars";
import type { ActivityEntry } from "@/server/activity";
import { CARD_CLASS } from "@/components/admin/ui";
import { PhoneRow } from "@/components/admin/phone-row";
import { PhoneMore } from "@/components/admin/phone-more";
import { PHONE_MORE_HIDDEN } from "@/components/admin/phone-more-class";
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
export function entrySentence(entry: ActivityEntry, words?: StaffMessages): string {
  const sentence = words?.activity.sentences[entry.action];
  const named = entry.target?.label?.trim();
  // An id is never shown to a person (round 14, D641): a target without a name is left out, "it" in a written sentence.
  if (!words || !sentence) return entry.target && !named ? actionLabel(entry.action) : entry.summary;
  // An account without a name in the entry is the person the sentence is about: their name, else "it".
  const person = entry.target?.type === "account" ? (entry.name ?? entry.email) : null;
  return fillWords(sentence, { label: named || person || words.activity.it });
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
const time = (iso: string, zone: string, locale = "en-GB") => new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone: zone }).format(new Date(iso));
const dayKey = (iso: string, zone: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

/** The most minutes between two changes for them to be one run (round 32, D706). */
const RUN_GAP_MS = 10 * 60_000;

/**
 * Round 32 (D706): the entries of one day as runs: changes one after another by the same person, in the same way (themselves, the AI manager,
 * the autopilot), in the same area and no more than ten minutes apart. A run of one is an entry as before.
 */
export function activityRuns(entries: readonly ActivityEntry[]): ActivityEntry[][] {
  const runs: ActivityEntry[][] = [];
  for (const entry of entries) {
    const run = runs.at(-1);
    const last = run?.at(-1);
    const same =
      last &&
      (last.accountId ?? last.email) === (entry.accountId ?? entry.email) &&
      last.actedBy === entry.actedBy &&
      last.area === entry.area &&
      Math.abs(Date.parse(last.at) - Date.parse(entry.at)) <= RUN_GAP_MS;
    if (same) run!.push(entry);
    else runs.push([entry]);
  }
  return runs;
}

/** An action's name without its target, for a run's line: the account's sentence with the name left out, else the log's words. */
const kindName = (action: string, words?: StaffMessages) => {
  const sentence = words?.activity.sentences[action];
  return sentence ? fillWords(sentence, { label: "" }).replace(/\s+([,.:;])/g, "$1").replace(/\s+/g, " ").trim() : actionLabel(action);
};

/** A run's line: its kinds of change in order, with how many where more than one, the first two named. */
export function runTitle(run: readonly ActivityEntry[], words?: StaffMessages): string {
  const w = (words ?? staffEn).activity;
  const kinds: { action: string; n: number }[] = [];
  for (const entry of run) {
    const kind = kinds.find((k) => k.action === entry.action);
    if (kind) kind.n += 1;
    else kinds.push({ action: entry.action, n: 1 });
  }
  const named = kinds.slice(0, 2).map((k) => (k.n > 1 ? `${kindName(k.action, words)} (${k.n})` : kindName(k.action, words)));
  const rest = kinds.length - named.length;
  return rest > 0 ? `${named.join(", ")} ${fillWords(w.phone.andMore, { n: rest })}` : named.join(", ");
}

/** How many runs a phone shows before its Show more (round 32, D706). */
const PHONE_FIRST = 20;

/**
 * The entries, newest first: a sentence made by code, who did it, where it belongs and when; the changed fields as from and to behind
 * "Details". A page of 50 with a link to the older ones. On a phone (round 32, D706) a run of changes by one person is one row that opens to
 * each, and the first 20 rows show before a Show more.
 */
export function ActivityList({
  entries,
  zone,
  older,
  empty,
  words,
  locale = "en-GB",
  now,
}: {
  /** The time the page was drawn, for Today and Yesterday (round 14, D641); without it each day is named by its date. */
  now?: number;
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
  // By day (round 14, D641): Today, Yesterday, then the date; each row says only its time.
  const today = now === undefined ? null : dayKey(new Date(now).toISOString(), zone);
  const yesterday = now === undefined ? null : dayKey(new Date(now - 86_400_000).toISOString(), zone);
  const days: { key: string; entries: ActivityEntry[] }[] = [];
  for (const entry of entries) {
    const key = dayKey(entry.at, zone);
    if (days.at(-1)?.key !== key) days.push({ key, entries: [] });
    days.at(-1)!.entries.push(entry);
  }
  const dayName = (key: string) =>
    key === today
      ? w.today
      : key === yesterday
        ? w.yesterday
        : new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));
  const who = (entry: ActivityEntry) => `${entry.name ?? entry.email ?? w.platform}${entry.actedBy !== "person" ? ` ${w.actedBy[entry.actedBy]}` : ""}`;
  const row = (entry: ActivityEntry, className = "") => {
    const lines = entry.changes ? Object.entries(entry.changes).map(([key, change]) => changeLine(key, change, values)) : [];
    return (
      <li key={entry.id} className={`flex gap-3 py-3 text-sm max-sm:py-2 ${className}`}>
        {/* Round 29 (D702): on a phone one line of what and one of who, where and when; the face waits for wider screens. */}
        <span className="shrink-0 max-sm:hidden">
          <Avatar avatar={avatarFor({ email: entry.email ?? "", name: entry.name, avatarPath: entry.avatarPath })} size={32} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium break-words">{entrySentence(entry, words)}</p>
          <p className="text-muted">
            {who(entry)} · {areaName(entry.area, words)} · <time dateTime={entry.at}>{time(entry.at, zone, locale)}</time>
          </p>
          {lines.length > 0 && (
            <details className="mt-2 max-sm:mt-0.5">
              <summary className="cursor-pointer text-muted max-sm:text-xs">{w.details}</summary>
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
  };
  // Each run numbered across the days, so the phone can keep back all after the first 20.
  let counted = 0;
  const drawn = days.map((day) => ({ ...day, runs: activityRuns(day.entries).map((run) => ({ run, n: counted++ })) }));
  const kept = Math.max(0, counted - PHONE_FIRST);
  const later = (n: number) => (n >= PHONE_FIRST ? PHONE_MORE_HIDDEN : "");
  return (
    <PhoneMore hidden={kept} label={fillWords(w.phone.more, { n: Math.min(kept, PHONE_FIRST) })} className="flex flex-col gap-4">
      {drawn.map((day) => (
        <section key={day.key} aria-label={dayName(day.key)} className={`px-4 pt-3 ${CARD_CLASS} ${later(day.runs[0].n)}`}>
          <h2 className="pb-1 text-eyebrow text-ink-2">{dayName(day.key)}</h2>
          <ol className="divide-y divide-line">
            {day.runs.map(({ run, n }) =>
              run.length === 1 ? (
                row(run[0], later(n))
              ) : (
                <li key={run[0].id} className={later(n)}>
                  <PhoneRow
                    inset
                    last
                    title={runTitle(run, words)}
                    sub={
                      <>
                        {who(run[0])} · <time dateTime={run[0].at}>{time(run[0].at, zone, locale)}</time> · {fillWords(w.phone.changes, { n: run.length })}
                      </>
                    }
                    change={w.phone.show}
                    done={w.phone.hide}
                  >
                    <ol className="divide-y divide-line max-sm:border-l-2 max-sm:border-line max-sm:pl-3">{run.map((entry) => row(entry))}</ol>
                  </PhoneRow>
                </li>
              ),
            )}
          </ol>
        </section>
      ))}
      {older && (
        <p className={kept > 0 ? PHONE_MORE_HIDDEN : ""}>
          <Link href={older} className="inline-flex min-h-10 items-center rounded-pill border border-edge bg-card px-4 text-sm font-medium hover:bg-sunken">
            {w.older}
          </Link>
        </p>
      )}
    </PhoneMore>
  );
}

/** The filters a request's query holds, read as plain strings (an array or a missing value is empty). */
export function valuesFromQuery(query: Record<string, string | string[] | undefined>): ActivityValues {
  const one = (name: string) => (typeof query[name] === "string" ? (query[name] as string) : "");
  return { person: one("person"), area: one("area"), action: one("action"), from: one("from"), to: one("to") };
}

export { activityQuery };
