"use client";

import { fillWords } from "@/lib/admin-fill";
import type { NotificationsMessages } from "@/lib/admin-messages/notifications.en";
import type { SendingStatus } from "@/lib/sending-domains";

import { ActionForm, SubmitButton, type FormState } from "./action-form";
import { Card } from "./ui";

/** The sending domain as the card shows it (D727): no Resend id, nothing but what the owner reads. */
export type SendingDomainView = {
  domain: string;
  fromLocal: string;
  from: string;
  status: SendingStatus;
  /** Each record as a DNS provider's form asks for it, its name worked out on the server (`sendingDomainView()`), so this card loads no DNS code. */
  records: { type: string; name: string; value: string; priority?: number; seen: boolean }[];
  recordsWritten: boolean;
  checkedAt: string | null;
};

const FIELD = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";

/**
 * *Send from your own address* (D727, step M1.1 of the email plan): one field and one button for Homer (the domain is filled in from the
 * store's own when it has one); while waiting, the records to add, or the note that Kaizena Flow added them; once verified, the address
 * the emails go from. The part before the @ and stopping are one step away. `action` is null for someone who may only read.
 */
export function SendingDomainCard({
  domain,
  suggested,
  words: w,
  action,
  display,
}: {
  domain: SendingDomainView | null;
  /** The store's own domain, filled in for a new one. */
  suggested: string | null;
  words: NotificationsMessages["sendingDomain"];
  action: ((state: FormState, form: FormData) => Promise<FormState>) | null;
  /** The person's language tag, for the date. */
  display: string;
}) {
  if (!domain) {
    return (
      <Card title={w.title} description={w.leadShared}>
        {action ? (
          <ActionForm action={action} successMessage={w.done.added} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex w-28 flex-col gap-1 text-sm">
                {w.localLabel}
                <input name="fromLocal" defaultValue="news" className={FIELD} autoComplete="off" spellCheck={false} />
              </label>
              <span className="pb-2.5 text-sm text-muted" aria-hidden>
                @
              </span>
              <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm">
                {w.domainLabel}
                <input name="domain" required defaultValue={suggested ?? ""} placeholder={w.domainPlaceholder} className={FIELD} autoComplete="off" spellCheck={false} />
              </label>
            </div>
            <p className="text-sm text-muted">{w.domainHint}</p>
            <div>
              <SubmitButton name="intent" value="add">
                {w.add}
              </SubmitButton>
            </div>
          </ActionForm>
        ) : (
          <p className="text-sm text-muted">{w.readOnly}</p>
        )}
      </Card>
    );
  }

  const title =
    domain.status === "verified" ? fillWords(w.verified, { from: domain.from }) : fillWords(domain.status === "failed" ? w.failed : w.pending, { domain: domain.domain });
  const lead = domain.status === "verified" ? w.verifiedLead : domain.status === "failed" ? w.failedLead : domain.recordsWritten ? w.pendingWritten : w.pendingCopy;
  const checked = domain.checkedAt ? fillWords(w.checkedAt, { at: new Date(domain.checkedAt).toLocaleString(display, { dateStyle: "medium", timeStyle: "short" }) }) : null;
  const showRecords = domain.status !== "verified" && domain.records.length > 0;
  return (
    <Card title={title} description={lead}>
      <div className="flex flex-col gap-4">
        {showRecords && (
          <>
            {/* On a phone each record is a block of its own, so a long value wraps on the card's width rather than a column's. */}
            <ul className="flex flex-col gap-2 sm:hidden" aria-label={w.records}>
              {domain.records.map((r) => (
                <li key={`${r.type}-${r.name}-${r.value}`} className="flex flex-col gap-1 rounded-md border border-line p-3 text-sm">
                  <span className="flex flex-wrap justify-between gap-2">
                    <span>
                      {r.type} <span className="font-mono text-xs select-all">{r.name}</span>
                      {r.priority !== undefined && ` · ${w.columns.priority} ${r.priority}`}
                    </span>
                    <span className="text-muted">
                      {w.columns.seen}: {r.seen ? w.seen : w.notSeen}
                    </span>
                  </span>
                  <span className="font-mono text-xs break-all select-all">{r.value}</span>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto rounded-md border border-line sm:block">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">{w.records}</caption>
                <thead className="text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">{w.columns.type}</th>
                    <th className="px-3 py-2 font-medium">{w.columns.host}</th>
                    <th className="px-3 py-2 font-medium">{w.columns.value}</th>
                    <th className="px-3 py-2 font-medium">{w.columns.priority}</th>
                    <th className="px-3 py-2 font-medium">{w.columns.seen}</th>
                  </tr>
                </thead>
                <tbody>
                  {domain.records.map((r) => (
                    <tr key={`${r.type}-${r.name}-${r.value}`} className="border-t border-line align-top">
                      <td className="px-3 py-2">{r.type}</td>
                      <td className="px-3 py-2 font-mono text-xs break-all select-all">{r.name}</td>
                      <td className="max-w-80 px-3 py-2 font-mono text-xs break-all select-all">{r.value}</td>
                      <td className="px-3 py-2">{r.priority ?? ""}</td>
                      <td className="px-3 py-2">{r.seen ? w.seen : w.notSeen}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {checked && <p className="text-sm text-muted">{checked}</p>}
        {action ? (
          <>
            {domain.status !== "verified" && (
              <ActionForm action={action} successMessage={w.done.checked}>
                <SubmitButton name="intent" value="check">
                  {w.check}
                </SubmitButton>
              </ActionForm>
            )}
            <details className="text-sm">
              <summary className="cursor-pointer font-medium">{w.changeAddress}</summary>
              <div className="mt-3 flex flex-col gap-4">
                <ActionForm action={action} successMessage={w.done.saved} className="flex flex-wrap items-end gap-2">
                  <label className="flex w-36 flex-col gap-1">
                    {w.localLabel}
                    <input name="fromLocal" required defaultValue={domain.fromLocal} className={FIELD} autoComplete="off" spellCheck={false} />
                  </label>
                  <span className="pb-2.5 text-muted">@{domain.domain}</span>
                  <SubmitButton name="intent" value="address" variant="secondary">
                    {w.saveAddress}
                  </SubmitButton>
                </ActionForm>
                <ActionForm action={action} successMessage={w.done.removed} className="flex flex-col gap-2">
                  <p className="text-muted">{w.removeQuestion}</p>
                  <div>
                    <SubmitButton name="intent" value="remove" variant="secondary">
                      {w.remove}
                    </SubmitButton>
                  </div>
                </ActionForm>
              </div>
            </details>
          </>
        ) : (
          <p className="text-sm text-muted">{w.readOnly}</p>
        )}
      </div>
    </Card>
  );
}
