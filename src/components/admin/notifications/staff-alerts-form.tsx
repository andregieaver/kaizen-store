"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { CARD_CLASS } from "@/components/admin/ui";
import { ALERT_AREA_WORDS, ALERT_LABELS, STAFF_ALERT_EVENTS, WEEKDAYS, type StaffAlertEvent, type SummaryKind } from "@/lib/staff-alerts";
import type { StaffAlertsView } from "@/server/staff-alerts";

export type StaffAlertsInput = {
  recipients: { accountId: string; events: StaffAlertEvent[] }[];
  contactEvents: StaffAlertEvent[];
  summary: SummaryKind;
  summaryWeekday: number;
  summaryHour: number;
};

type Said = { ok: boolean; message: string };

const pill = "min-h-10 rounded-pill border border-edge bg-card px-4 text-sm disabled:opacity-45";
const mainPill = "min-h-10 rounded-pill bg-brand px-5 text-sm font-medium text-brand-ink disabled:opacity-45";
const select = "min-h-10 rounded-md border border-line bg-card px-3 text-sm";

const toggle = (list: StaffAlertEvent[], event: StaffAlertEvent, on: boolean) => (on ? [...new Set([...list, event])] : list.filter((e) => e !== event));

/**
 * The staff alerts page's form (wave 3, D238, `docs/wave-3-notifications.md` 2.4): a table of the store's members and its contact address with a box per
 * alert event, offered only where the member's role may read what the email shows (else *Needs {area} access*); the summary's choice; a test per event to
 * the owner's own address. Saved as a whole, and only by an owner (the page and the action ask, and `saveStaffAlerts()` asks again). No address is ever
 * typed here: recipients are members or the store's own contact address.
 */
export function StaffAlertsForm({ view, save, test }: { view: StaffAlertsView; save: (input: StaffAlertsInput) => Promise<Said>; test: (event: StaffAlertEvent) => Promise<Said> }) {
  const router = useRouter();
  const uid = useId();
  const [members, setMembers] = useState(() => Object.fromEntries(view.members.map((m) => [m.accountId, m.events])) as Record<string, StaffAlertEvent[]>);
  const [contact, setContact] = useState<StaffAlertEvent[]>(view.contact?.events ?? []);
  const [summary, setSummary] = useState<SummaryKind>(view.summary);
  const [weekday, setWeekday] = useState(view.summaryWeekday);
  const [hour, setHour] = useState(view.summaryHour);
  const [message, setMessage] = useState<Said | null>(null);
  const [busy, start] = useTransition();

  const submit = () =>
    start(async () => {
      const answer = await save({
        recipients: view.members.map((m) => ({ accountId: m.accountId, events: (members[m.accountId] ?? []).filter((e) => m.may[e]) })),
        contactEvents: view.contact ? contact : [],
        summary,
        summaryWeekday: weekday,
        summaryHour: hour,
      });
      setMessage(answer);
      if (answer.ok) router.refresh();
    });

  const sendTest = (event: StaffAlertEvent) =>
    start(async () => {
      setMessage(await test(event));
    });

  return (
    <div className="flex flex-col gap-6">
      {!view.configured && (
        <p role="note" className="rounded-md border border-line bg-sunken p-3 text-sm">
          These are the defaults, as nobody has saved this page yet: owners get new orders, return requests and low stock; overdue refunds go to the store&apos;s
          contact address (to the owners when there is none); nobody gets the summary or the automation emails. Saving makes your choice the store&apos;s.
        </p>
      )}

      <section aria-labelledby={`${uid}-who`} className={`flex flex-col gap-3 p-5 ${CARD_CLASS}`}>
        <h2 id={`${uid}-who`} className="text-title text-ink">
          Who is emailed
        </h2>
        <p className="text-sm text-muted">
          Staff emails name the order or return, what was bought and a link to it. They never carry the customer&apos;s name, email address, phone number or
          address. A box is offered only where the person&apos;s role may read what the email shows; a change to someone&apos;s role takes effect at once.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <caption className="sr-only">Recipients of each staff alert</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="py-2 pr-3 font-medium">
                  Recipient
                </th>
                {STAFF_ALERT_EVENTS.map((e) => (
                  <th key={e} scope="col" className="px-2 py-2 font-medium">
                    {ALERT_LABELS[e]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.members.map((m) => (
                <tr key={m.accountId} className="border-b border-line">
                  <th scope="row" className="py-2 pr-3 font-normal">
                    <span className="block">{m.name ?? m.email}</span>
                    <span className="block text-xs text-muted">
                      {m.name ? `${m.email} · ` : ""}
                      {m.owner ? "Owner" : "Staff"}
                    </span>
                  </th>
                  {STAFF_ALERT_EVENTS.map((e) => (
                    <td key={e} className="px-2 py-2">
                      {m.may[e] ? (
                        <input
                          type="checkbox"
                          className="size-4"
                          aria-label={`${ALERT_LABELS[e]} emails to ${m.name ?? m.email}`}
                          checked={(members[m.accountId] ?? []).includes(e)}
                          onChange={(ev) => setMembers((all) => ({ ...all, [m.accountId]: toggle(all[m.accountId] ?? [], e, ev.target.checked) }))}
                        />
                      ) : (
                        <span className="text-xs text-muted">Needs {ALERT_AREA_WORDS[e]} access</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <th scope="row" className="py-2 pr-3 font-normal">
                  <span className="block">The store&apos;s contact address</span>
                  <span className="block text-xs text-muted">{view.contact ? view.contact.email : "None set: add one under Company"}</span>
                </th>
                {STAFF_ALERT_EVENTS.map((e) => (
                  <td key={e} className="px-2 py-2">
                    <input
                      type="checkbox"
                      className="size-4"
                      disabled={!view.contact}
                      aria-label={`${ALERT_LABELS[e]} emails to the store's contact address`}
                      checked={contact.includes(e)}
                      onChange={(ev) => setContact((list) => toggle(list, e, ev.target.checked))}
                    />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby={`${uid}-summary`} className={`flex flex-col gap-3 p-5 ${CARD_CLASS}`}>
        <h2 id={`${uid}-summary`} className="text-title text-ink">
          Summary
        </h2>
        <p className="text-sm text-muted">
          Paid orders, net sales without VAT, refunds, returns, orders to send, low stock and support conversations waiting, sent to the people ticked under
          Summary. The hour is the store&apos;s own time.
        </p>
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-sm font-medium">
            How often
            <select value={summary} onChange={(e) => setSummary(e.target.value as SummaryKind)} className={select}>
              <option value="off">Off</option>
              <option value="daily">Daily (yesterday)</option>
              <option value="weekly">Weekly (the last seven days)</option>
            </select>
          </label>
          {summary === "weekly" && (
            <label className="flex flex-col gap-1 text-sm font-medium">
              Day
              <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} className={select}>
                {WEEKDAYS.map((day, i) => (
                  <option key={day} value={i + 1}>
                    {day}
                  </option>
                ))}
              </select>
            </label>
          )}
          {summary !== "off" && (
            <label className="flex flex-col gap-1 text-sm font-medium">
              Hour
              <select value={hour} onChange={(e) => setHour(Number(e.target.value))} className={select}>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={submit} disabled={busy} className={mainPill}>
          {busy ? "Working …" : "Save"}
        </button>
      </div>

      <section aria-labelledby={`${uid}-test`} className={`flex flex-col gap-3 p-5 ${CARD_CLASS}`}>
        <h2 id={`${uid}-test`} className="text-title text-ink">
          Send a test
        </h2>
        <p className="text-sm text-muted">Each test goes to your own address with made-up figures, at most ten an hour.</p>
        <div className="flex flex-wrap gap-2">
          {(["new_order", "return_requested", "summary"] as const).map((e) => (
            <button key={e} type="button" onClick={() => sendTest(e)} disabled={busy} className={pill}>
              Test: {ALERT_LABELS[e]}
            </button>
          ))}
        </div>
      </section>

      <p role="status" aria-live="polite" className={`text-sm empty:hidden ${message && !message.ok ? "text-danger-text" : ""}`}>
        {message?.message}
      </p>
    </div>
  );
}
