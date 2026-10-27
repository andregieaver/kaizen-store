import type { Metadata } from "next";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { ButtonLink, Card, Chip, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import type { PlatformToolsMessages } from "@/lib/admin-messages/platform-tools.en";
import { adminText } from "@/lib/admin-text";
import { APPLIES_TO, percentOfBps } from "@/lib/duties";
import { formatMoney } from "@/lib/money";
import { PLATFORM_BASE } from "@/lib/platform-nav";
import { requirePlatformAdmin } from "@/server/auth";
import { listDutyRates, type DutyRateListed } from "@/server/duty-rates";

import { removeDutyRateAction, saveDutyRateAction, setDutyRateVerifiedAction } from "./actions";

export const metadata: Metadata = { title: "Duty rates" };

/**
 * The platform's duty rates (wave 7 unit I, D343, decision 2): every row of `commerce.duty_rates` with its source and whether a person verified it,
 * and one form to add or change a row. A change applies to carts and orders from then on; an order keeps the estimate it was placed with.
 */
export default async function PlatformDutyRatesPage({ searchParams }: PageProps<"/admin/platform/duty-rates">) {
  await connection();
  const account = await requirePlatformAdmin();
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "platformTools").dutyRates;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const rows = await listDutyRates();
  const query = await searchParams;
  const editing = rows.find((r) => r.id === (typeof query.edit === "string" ? query.edit : "")) ?? null;
  const here = `${PLATFORM_BASE}/duty-rates`;
  const amount = (minor: number | null, currency: string | null) => (minor === null || !currency ? "" : formatMoney(minor, currency, locale));
  const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={w.title} description={w.intro} />
      <Card title={w.tableTitle}>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">{w.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="duty-rates">
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="py-2 pr-3">
                      <span className="text-body-strong">{r.destination}</span> {r.hsPrefix === "" ? w.base : r.hsPrefix}
                      <span className="block text-muted">{r.origin ?? w.anyOrigin}</span>
                      <span className="block text-muted">{w.applies[r.appliesTo]}</span>
                    </td>
                    <td className="py-2 pr-3">
                      {r.dutyRateBps !== null && <span className="block">{percentOfBps(r.dutyRateBps)}</span>}
                      <Thresholds row={r} w={w} amount={amount} />
                      <span className="block text-muted">
                        {w.fields.importVat}: {r.importVatBps === null ? w.goodsRate : percentOfBps(r.importVatBps)}
                      </span>
                      {r.hsPrefix === "" && <span className="block text-muted">{r.shippingInValue ? w.shippingIn : w.shippingOut}</span>}
                    </td>
                    <td className="py-2 pr-3 text-muted">
                      {r.validFrom === null && r.validTo === null && w.always}
                      {r.validFrom && <span className="block">{fillWords(w.from, { day: day(r.validFrom) })}</span>}
                      {r.validTo && <span className="block">{fillWords(w.until, { day: day(r.validTo) })}</span>}
                    </td>
                    <td className="max-w-80 py-2 pr-3">
                      <a href={r.source} target="_blank" rel="noreferrer" className="break-all underline">
                        {r.source}
                      </a>
                      <span className="block text-muted">
                        {w.fields.checkedOn}: {day(r.checkedOn)}
                      </span>
                      {r.note && <span className="block text-muted">{r.note}</span>}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-col items-start gap-2">
                        <Chip signal={r.verified ? "positive" : "warning"}>{r.verified ? w.verified : w.unverified}</Chip>
                        <ActionForm action={setDutyRateVerifiedAction.bind(null, r.id, !r.verified)}>
                          <SubmitButton variant="secondary">{r.verified ? w.unverify : w.verify}</SubmitButton>
                        </ActionForm>
                        <ButtonLink size="dense" href={`${here}?edit=${r.id}#duty-rate-form`}>
                          {w.edit}
                        </ButtonLink>
                        <ActionForm action={removeDutyRateAction.bind(null, r.id)}>
                          <SubmitButton variant="secondary">{w.remove}</SubmitButton>
                        </ActionForm>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div id="duty-rate-form">
        <Card title={editing ? w.formEdit : w.formAdd} aside={editing ? <ButtonLink size="dense" href={here}>{w.cancel}</ButtonLink> : undefined}>
          <RowForm key={editing?.id ?? "new"} row={editing} w={w} />
        </Card>
      </div>
    </div>
  );
}

type Words = PlatformToolsMessages["dutyRates"];

function Thresholds({ row, w, amount }: { row: DutyRateListed; w: Words; amount: (minor: number | null, currency: string | null) => string }) {
  if (row.hsPrefix !== "") return null;
  const per = row.thresholdPer === "item" ? w.perItem : w.perConsignment;
  return (
    <>
      {row.thresholdMinor !== null && <span className="block">{`${fillWords(w.dutyAt, { amount: amount(row.thresholdMinor, row.thresholdCurrency) })} ${per}`}</span>}
      {row.perItemMinor !== null && <span className="block">{fillWords(w.fixed, { amount: amount(row.perItemMinor, row.thresholdCurrency) })}</span>}
      {row.vatThresholdMinor !== null && <span className="block">{`${fillWords(w.vatAt, { amount: amount(row.vatThresholdMinor, row.thresholdCurrency) })} ${per}`}</span>}
    </>
  );
}

const percentText = (bps: number | null) => (bps === null ? "" : percentOfBps(bps).replace(" %", ""));

function RowForm({ row, w }: { row: DutyRateListed | null; w: Words }) {
  const f = w.fields;
  const field = "flex flex-col gap-1 text-sm";
  return (
    <ActionForm action={saveDutyRateAction} className="grid gap-4 md:grid-cols-2">
      {row && <input type="hidden" name="id" value={row.id} />}
      <label className={field}>
        {f.destination}
        <input name="destination" required maxLength={2} defaultValue={row?.destination ?? ""} />
        <span className="text-muted">{f.destinationHelp}</span>
      </label>
      <label className={field}>
        {f.hsPrefix}
        <input name="hsPrefix" inputMode="numeric" maxLength={10} defaultValue={row?.hsPrefix ?? ""} />
        <span className="text-muted">{f.hsPrefixHelp}</span>
      </label>
      <label className={field}>
        {f.origin}
        <input name="origin" maxLength={2} defaultValue={row?.origin ?? ""} />
        <span className="text-muted">{f.originHelp}</span>
      </label>
      <label className={field}>
        {f.appliesTo}
        <select name="appliesTo" defaultValue={row?.appliesTo ?? "any"}>
          {APPLIES_TO.map((a) => (
            <option key={a} value={a}>
              {w.applies[a]}
            </option>
          ))}
        </select>
      </label>
      <label className={field}>
        {f.dutyRate}
        <input name="dutyRate" inputMode="decimal" defaultValue={percentText(row?.dutyRateBps ?? null)} />
      </label>
      <label className={field}>
        {f.importVat}
        <input name="importVat" inputMode="decimal" defaultValue={percentText(row?.importVatBps ?? null)} />
        <span className="text-muted">{f.importVatHelp}</span>
      </label>
      <label className={field}>
        {f.threshold}
        <input name="thresholdMinor" inputMode="numeric" defaultValue={row?.thresholdMinor ?? ""} />
        <span className="text-muted">{f.amountsHelp}</span>
      </label>
      <label className={field}>
        {f.vatThreshold}
        <input name="vatThresholdMinor" inputMode="numeric" defaultValue={row?.vatThresholdMinor ?? ""} />
      </label>
      <label className={field}>
        {f.perItem}
        <input name="perItemMinor" inputMode="numeric" defaultValue={row?.perItemMinor ?? ""} />
      </label>
      <label className={field}>
        {f.currency}
        <input name="thresholdCurrency" maxLength={3} defaultValue={row?.thresholdCurrency ?? ""} />
      </label>
      <label className={field}>
        {f.thresholdPer}
        <select name="thresholdPer" defaultValue={row?.thresholdPer ?? "consignment"}>
          <option value="consignment">{w.perConsignment}</option>
          <option value="item">{w.perItem}</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="shippingInValue" defaultChecked={row?.shippingInValue ?? true} />
        {f.shipping}
      </label>
      <label className={field}>
        {f.source}
        <input name="source" type="url" required defaultValue={row?.source ?? ""} />
      </label>
      <label className={field}>
        {f.checkedOn}
        <input name="checkedOn" type="date" required defaultValue={row?.checkedOn ?? ""} />
      </label>
      <label className={field}>
        {f.validFrom}
        <input name="validFrom" type="date" defaultValue={row?.validFrom ?? ""} />
      </label>
      <label className={field}>
        {f.validTo}
        <input name="validTo" type="date" defaultValue={row?.validTo ?? ""} />
      </label>
      <label className={`${field} md:col-span-2`}>
        {f.note}
        <textarea name="note" rows={3} maxLength={1000} defaultValue={row?.note ?? ""} />
      </label>
      <label className="flex items-center gap-2 text-sm md:col-span-2">
        <input type="checkbox" name="verified" defaultChecked={row?.verified ?? false} />
        {f.verified}
      </label>
      <div className="md:col-span-2">
        <SubmitButton>{w.save}</SubmitButton>
      </div>
    </ActionForm>
  );
}
