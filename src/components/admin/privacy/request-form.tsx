"use client";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { PRIVACY_KINDS, PRIVACY_KIND_LABELS } from "@/lib/privacy-request";
import { STAFF_TEXT } from "@/lib/privacy-text";

import { card, hint, input, label } from "./styles";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

/**
 * Logging a request that arrived by email, post or phone (wave 1, 1g, D162, `docs/wave-1g-gdpr.md` 2.3 item 4): the kind, the address the
 * person wrote from, the day it was received (the one-month clock runs from receipt, so an earlier day can be set) and a note.
 * The address is the one staff copy from the person's own message: the system never writes to an address typed by anyone else.
 */
export function LogRequestForm({ action, today }: { action: Action; today: string }) {
  return (
    <section aria-labelledby="log-request" className={card}>
      <h2 id="log-request" className="font-medium">
        Log a request
      </h2>
      <ActionForm action={action} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={label}>
            What the person asks for
            <select name="kind" required defaultValue="export" className={input}>
              {PRIVACY_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind === "export" ? "A copy of their data (export)" : "Their data erased"}
                </option>
              ))}
            </select>
            <span className={hint}>{PRIVACY_KIND_LABELS.export} or {PRIVACY_KIND_LABELS.erasure.toLowerCase()}.</span>
          </label>
          <label className={label}>
            Their email address
            <input name="email" type="email" required autoComplete="off" maxLength={254} className={input} />
            <span className={hint}>The address they wrote from.</span>
          </label>
          <label className={label}>
            Date received
            <input name="receivedOn" type="date" required defaultValue={today} max={today} className={input} />
            <span className={hint}>{STAFF_TEXT.receivedHelp}</span>
          </label>
          <label className={label}>
            Note <span className={hint}>(optional, for staff only)</span>
            <textarea name="note" rows={3} maxLength={1000} className={`${input} py-2`} />
          </label>
        </div>
        <p className="text-sm text-muted">{STAFF_TEXT.clock}</p>
        <div>
          <SubmitButton>Log the request</SubmitButton>
        </div>
      </ActionForm>
    </section>
  );
}
