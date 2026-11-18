"use client";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { useAdminText } from "@/components/admin/admin-text";
import { PhoneRow } from "@/components/admin/phone-row";
import { fillWords } from "@/lib/admin-fill";
import { PRIVACY_KINDS } from "@/lib/privacy-request";

import { card, hint, input, label } from "./styles";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

/**
 * Logging a request that arrived by email, post or phone (wave 1, 1g, D162, `docs/wave-1g-gdpr.md` 2.3 item 4): the kind, the address the
 * person wrote from, the day it was received (the one-month clock runs from receipt, so an earlier day can be set) and a note.
 * The address is the one staff copy from the person's own message: the system never writes to an address typed by anyone else.
 */
export function LogRequestForm({ action, today }: { action: Action; today: string }) {
  const { forms: f, common: c, staff } = useAdminText("privacy");
  return (
    <section aria-labelledby="log-request" className={card}>
      {/* Round 50 (D765): on a phone the card's title is the page's, the fields keep their labels, and the deadline is one line with how it is
          counted a row under the button. */}
      <h2 id="log-request" className="text-title text-ink max-sm:sr-only">
        {f.logTitle}
      </h2>
      <ActionForm action={action} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={label}>
            {f.whatAsked}
            <select name="kind" required defaultValue="export" className={input}>
              {PRIVACY_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind === "export" ? f.exportOption : f.erasureOption}
                </option>
              ))}
            </select>
            <span className={`${hint} max-sm:hidden`}>{fillWords(f.kindHint, { export: c.kinds.export, erasure: c.kinds.erasure.toLowerCase() })}</span>
          </label>
          <label className={label}>
            {f.email}
            <input name="email" type="email" required autoComplete="off" maxLength={254} className={input} />
            <span className={`${hint} max-sm:hidden`}>{f.emailHint}</span>
          </label>
          <label className={label}>
            {f.received}
            <input name="receivedOn" type="date" required defaultValue={today} max={today} className={input} />
            <span className={`${hint} max-sm:hidden`}>{staff.receivedHelp}</span>
          </label>
          <label className={label}>
            {c.note} <span className={hint}>{f.staffNote}</span>
            <textarea name="note" rows={3} maxLength={1000} className={`${input} py-2`} />
          </label>
        </div>
        <p className="text-sm text-muted sm:hidden">{f.phone.due}</p>
        <p className="text-sm text-muted max-sm:hidden">{staff.clock}</p>
        <div>
          <SubmitButton>{f.logButton}</SubmitButton>
        </div>
        <div className="border-t border-line sm:hidden">
          <PhoneRow inset last title={f.phone.clock} sub={f.phone.clockSub} change={f.phone.open} done={f.phone.close}>
            <p className="text-sm text-muted">{staff.clock}</p>
          </PhoneRow>
        </div>
      </ActionForm>
    </section>
  );
}
