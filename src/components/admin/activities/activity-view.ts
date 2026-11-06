import { activityWhen, dueFields, type ActivityKind } from "@/lib/activities";
import { fillWords } from "@/lib/admin-fill";
import type { DealsMessages } from "@/lib/admin-messages/deals.en";
import { zonedDate } from "@/lib/booking-slots";
import type { Activity } from "@/server/activities";

/**
 * Activities as the admin draws them (S3, D468): every text made by the page in the viewer's words and the store's time zone, so the
 * cards and the home's *Today* only lay them out.
 */

/** What an activity's form starts from: the fields as typed, and what it is about as hidden fields. */
export type ActivityFormValues = {
  kind: ActivityKind;
  title: string;
  note: string;
  dueOn: string;
  dueTime: string;
  duration: string;
  assigneeId: string;
  customerId: string;
  companyId: string;
  dealId: string;
};

export type ActivityView = {
  id: string;
  kind: ActivityKind;
  title: string;
  note: string | null;
  /** When it is due ("Mon 9 Nov at 10:00 · 60 min"), or, on *Today*, only the time of one due today. */
  when: string;
  late: boolean;
  /** "Done 6 Nov", once done. */
  done: string | null;
  /** "for Kari", when it is someone else's. */
  forWhom: string | null;
  /** What else it is about, linked: the deal on a person's page, the deal or person on Today. */
  about: { label: string; href: string } | null;
  values: ActivityFormValues;
};

/** Where the activities are drawn: on a deal's, a person's or a company's page, or on the store's home. */
export type ActivityPlace = "deal" | "customer" | "company" | "today";

type Options = { now: Date; timeZone: string; locale: string; words: DealsMessages["activities"]; base: string; me: string };

/** When it is due, in the store's zone: on *Today* (`relative`) a time alone for today's, a date for the others. */
export function whenText(a: { dueAt: string; timed: boolean; durationMinutes: number | null }, o: Omit<Options, "base" | "me">, relative = false): string {
  const today = zonedDate(o.now.getTime(), o.timeZone);
  const day = zonedDate(Date.parse(a.dueAt), o.timeZone);
  const time = a.timed ? dueFields(a.dueAt, true, o.timeZone).dueTime : "";
  const date = new Date(a.dueAt).toLocaleDateString(o.locale, { weekday: "short", day: "numeric", month: "short", timeZone: o.timeZone });
  const at = relative && day === today ? time : time ? fillWords(o.words.at, { date, time }) : date;
  return [at, a.durationMinutes ? fillWords(o.words.minutes, { n: a.durationMinutes }) : null].filter(Boolean).join(" · ");
}

function aboutOf(a: Activity, place: ActivityPlace, base: string): ActivityView["about"] {
  const deal = a.deal ? { label: a.deal.title, href: `${base}/deals/${a.deal.id}` } : null;
  const person = a.customer ? { label: a.customer.name, href: `${base}/customers/${a.customer.id}` } : null;
  const company = a.company ? { label: a.company.name, href: `${base}/companies/${a.company.id}` } : null;
  if (place === "deal") return null;
  if (place === "customer") return deal;
  if (place === "company") return deal ?? person;
  return deal ?? person ?? company;
}

export function activityViews(list: readonly Activity[], place: ActivityPlace, o: Options): ActivityView[] {
  return list.map((a) => {
    const due = dueFields(a.dueAt, a.timed, o.timeZone);
    return {
      id: a.id,
      kind: a.kind,
      title: a.title,
      note: a.note,
      when: whenText(a, o, place === "today"),
      late: activityWhen(a, o.now, o.timeZone) === "late",
      done: a.doneAt ? fillWords(o.words.doneOn, { date: new Date(a.doneAt).toLocaleDateString(o.locale, { day: "numeric", month: "short", timeZone: o.timeZone }) }) : null,
      forWhom: a.assignee && a.assignee.id !== o.me ? fillWords(o.words.by, { name: a.assignee.name }) : null,
      about: aboutOf(a, place, o.base),
      values: {
        kind: a.kind,
        title: a.title,
        note: a.note ?? "",
        dueOn: due.dueOn,
        dueTime: due.dueTime,
        duration: a.durationMinutes === null ? "" : String(a.durationMinutes),
        assigneeId: a.assignee?.id ?? "",
        customerId: a.customer?.id ?? "",
        companyId: a.company?.id ?? "",
        dealId: a.deal?.id ?? "",
      },
    };
  });
}

/** A new activity's form: a call for the viewer today, about what the page is about. */
export function newActivityValues(about: { customerId?: string | null; companyId?: string | null; dealId?: string | null }, me: string, now: Date, timeZone: string): ActivityFormValues {
  return {
    kind: "call",
    title: "",
    note: "",
    dueOn: zonedDate(now.getTime(), timeZone),
    dueTime: "",
    duration: "",
    assigneeId: me,
    customerId: about.customerId ?? "",
    companyId: about.companyId ?? "",
    dealId: about.dealId ?? "",
  };
}
