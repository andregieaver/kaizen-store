import type { DomainsMessages } from "@/lib/admin-messages/domains.en";
import type { Signal } from "@/lib/admin-schemes";
import { formatMoney } from "@/lib/money";

import { ActionForm, SubmitButton } from "./action-form";
import type { DomainAction } from "./domain-types";
import { Card, Chip } from "./ui";


export type RegistrationRow = {
  apex: string;
  status: "active" | "expired" | "transferring_out" | "transferred_out";
  expiresAt: string | null;
  renew: boolean;
  contactVerified: boolean | null;
  /** What renewing a year costs now, when it could be priced. */
  renewal: { currency: string; amountMinor: number } | null;
};

export type PurchaseRow = {
  id: string;
  apex: string;
  kind: "register" | "renew" | "transfer";
  years: number;
  status: "quoted" | "invoiced" | "paid" | "registering" | "done" | "failed" | "refunded" | "void";
  currency: string;
  amountMinor: number;
  invoiceUrl: string | null;
  problem: string | null;
};

const PURCHASE_SIGNAL: Record<PurchaseRow["status"], Signal> = {
  quoted: "neutral",
  invoiced: "warning",
  paid: "insight",
  registering: "insight",
  done: "positive",
  failed: "danger",
  refunded: "neutral",
  void: "neutral",
};

/** The store's domains registered through Kaizena Flow (D315 9.1) and the purchases under way, with renewal for the owner. */
export function DomainRegistrationsCard({
  registrations,
  purchases,
  owner,
  words,
  locale,
  actions,
}: {
  registrations: RegistrationRow[];
  purchases: PurchaseRow[];
  owner: boolean;
  words: Pick<DomainsMessages, "registrations" | "purchases" | "get">;
  locale: string;
  actions: { renewal: DomainAction; renew: DomainAction };
}) {
  if (registrations.length === 0 && purchases.length === 0) return null;
  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "Europe/Oslo" }).format(new Date(iso));
  const r = words.registrations;
  const years = (n: number) => (n === 1 ? words.get.year.one : words.get.year.many.replace("{n}", String(n)));
  return (
    <>
      {registrations.length > 0 && (
        <Card title={r.title}>
          <ul className="flex flex-col divide-y divide-line">
            {registrations.map((reg) => (
              <li key={reg.apex} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-body-strong text-ink">{reg.apex}</span>
                  {reg.expiresAt && (
                    <span className="text-caption text-muted">
                      {reg.status === "expired"
                        ? r.expired.replace("{date}", date(reg.expiresAt))
                        : reg.renew
                          ? r.renews.replace("{date}", date(reg.expiresAt))
                          : r.stops.replace("{date}", date(reg.expiresAt))}
                    </span>
                  )}
                </div>
                {reg.contactVerified === false && <p className="text-body text-danger-text">{r.confirmEmail}</p>}
                {owner && (
                  <div className="flex flex-wrap gap-2">
                    <ActionForm action={actions.renewal}>
                      <input type="hidden" name="domain" value={reg.apex} />
                      {!reg.renew && <input type="hidden" name="renew" value="on" />}
                      <SubmitButton variant="secondary">{reg.renew ? r.renewOff : r.renewOn}</SubmitButton>
                    </ActionForm>
                    {reg.renewal && (
                      <ActionForm action={actions.renew}>
                        <input type="hidden" name="domain" value={reg.apex} />
                        <input type="hidden" name="agreed" value={`${reg.renewal.currency}:${reg.renewal.amountMinor}`} />
                        <SubmitButton variant="secondary">{r.renewNow.replace("{price}", formatMoney(reg.renewal.amountMinor, reg.renewal.currency, locale))}</SubmitButton>
                      </ActionForm>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {purchases.length > 0 && (
        <Card title={words.purchases.title}>
          <ul className="flex flex-col divide-y divide-line">
            {purchases.map((p) => (
              <li key={p.id} className="flex flex-col gap-1 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-body text-ink">
                    {(p.kind === "renew" ? words.purchases.renew : p.kind === "transfer" ? words.purchases.transfer : words.purchases.register).replace("{domain}", p.apex).replace("{n}", years(p.years))}
                  </span>
                  <Chip signal={PURCHASE_SIGNAL[p.status]} dot>
                    {words.purchases.status[p.status]}
                  </Chip>
                  <span className="text-caption text-muted">{formatMoney(p.amountMinor, p.currency, locale)}</span>
                  {p.status === "invoiced" && p.invoiceUrl && (
                    <a href={p.invoiceUrl} target="_blank" rel="noopener noreferrer" className="text-body underline">
                      {words.purchases.payInvoice}
                    </a>
                  )}
                </div>
                {p.problem && (p.status === "failed" || p.status === "refunded" || p.status === "quoted") && <p className="text-caption text-muted">{p.problem}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
