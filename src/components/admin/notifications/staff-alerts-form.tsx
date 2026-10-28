"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { useAdminText } from "@/components/admin/admin-text";
import { CARD_CLASS } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { STAFF_ALERT_EVENTS, type StaffAlertEvent, type SummaryKind } from "@/lib/staff-alerts";
import type { StaffAlertsView } from "@/server/staff-alerts";

export type StaffAlertsInput = {
  recipients: { accountId: string; events: StaffAlertEvent[] }[];
  contactEvents: StaffAlertEvent[];
  summary: SummaryKind;
  summaryWeekday: number;
  summaryHour: number;
  alertFloor: "urgent" | "warning" | "info";
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
  const all = useAdminText("notifications");
  const w = all.staff;
  const [members, setMembers] = useState(() => Object.fromEntries(view.members.map((m) => [m.accountId, m.events])) as Record<string, StaffAlertEvent[]>);
  const [contact, setContact] = useState<StaffAlertEvent[]>(view.contact?.events ?? []);
  const [summary, setSummary] = useState<SummaryKind>(view.summary);
  const [weekday, setWeekday] = useState(view.summaryWeekday);
  const [hour, setHour] = useState(view.summaryHour);
  const [floor, setFloor] = useState(view.alertFloor);
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
        alertFloor: floor,
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
          {w.defaults}
        </p>
      )}

      <section aria-labelledby={`${uid}-who`} className={`flex flex-col gap-3 p-5 ${CARD_CLASS}`}>
        <h2 id={`${uid}-who`} className="text-title text-ink">
          {w.who}
        </h2>
        <p className="text-sm text-muted">{w.whoHint}</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <caption className="sr-only">{w.caption}</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="py-2 pr-3 font-medium">
                  {w.recipient}
                </th>
                {STAFF_ALERT_EVENTS.map((e) => (
                  <th key={e} scope="col" className="px-2 py-2 font-medium">
                    {w.alerts[e]}
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
                      {m.owner ? w.owner : w.member}
                    </span>
                  </th>
                  {STAFF_ALERT_EVENTS.map((e) => (
                    <td key={e} className="px-2 py-2">
                      {m.may[e] ? (
                        <input
                          type="checkbox"
                          className="size-4"
                          aria-label={fillWords(w.checkbox, { alert: w.alerts[e], who: m.name ?? m.email })}
                          checked={(members[m.accountId] ?? []).includes(e)}
                          onChange={(ev) => setMembers((all) => ({ ...all, [m.accountId]: toggle(all[m.accountId] ?? [], e, ev.target.checked) }))}
                        />
                      ) : (
                        <span className="text-xs text-muted">{fillWords(w.needs, { area: w.areas[e] })}</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <th scope="row" className="py-2 pr-3 font-normal">
                  <span className="block">{w.contact}</span>
                  <span className="block text-xs text-muted">{view.contact ? view.contact.email : w.contactNone}</span>
                </th>
                {STAFF_ALERT_EVENTS.map((e) => (
                  <td key={e} className="px-2 py-2">
                    <input
                      type="checkbox"
                      className="size-4"
                      disabled={!view.contact}
                      aria-label={fillWords(w.contactCheckbox, { alert: w.alerts[e] })}
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
          {w.summary}
        </h2>
        <p className="text-sm text-muted">{w.summaryHint}</p>
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-sm font-medium">
            {w.howOften}
            <select value={summary} onChange={(e) => setSummary(e.target.value as SummaryKind)} className={select}>
              <option value="off">{w.offChoice}</option>
              <option value="daily">{w.daily}</option>
              <option value="weekly">{w.weekly}</option>
            </select>
          </label>
          {summary === "weekly" && (
            <label className="flex flex-col gap-1 text-sm font-medium">
              {w.day}
              <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} className={select}>
                {w.weekdays.map((day, i) => (
                  <option key={day} value={i + 1}>
                    {day}
                  </option>
                ))}
              </select>
            </label>
          )}
          {summary !== "off" && (
            <label className="flex flex-col gap-1 text-sm font-medium">
              {w.hour}
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

      <section aria-labelledby={`${uid}-floor`} className={`flex flex-col gap-3 p-5 ${CARD_CLASS}`}>
        <h2 id={`${uid}-floor`} className="text-title text-ink">
          {w.alertFloor}
        </h2>
        <p className="text-sm text-muted">{w.alertFloorHint}</p>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {w.howOften}
          <select value={floor} onChange={(e) => setFloor(e.target.value as typeof floor)} className={`${select} max-w-sm`}>
            {(["urgent", "warning", "info"] as const).map((f) => (
              <option key={f} value={f}>
                {w.floors[f]}
              </option>
            ))}
          </select>
        </label>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={submit} disabled={busy} className={mainPill}>
          {busy ? all.common.working : all.common.save}
        </button>
      </div>

      <section aria-labelledby={`${uid}-test`} className={`flex flex-col gap-3 p-5 ${CARD_CLASS}`}>
        <h2 id={`${uid}-test`} className="text-title text-ink">
          {w.test}
        </h2>
        <p className="text-sm text-muted">{w.testHint}</p>
        <div className="flex flex-wrap gap-2">
          {(["new_order", "return_requested", "summary", "analytics"] as const).map((e) => (
            <button key={e} type="button" onClick={() => sendTest(e)} disabled={busy} className={pill}>
              {fillWords(w.testOne, { alert: w.alerts[e] })}
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
