import type { Metadata } from "next";
import Link from "next/link";

import { WorkOff } from "@/components/admin/work/work-off";
import { SeriesForm, WorkSettingsForm } from "@/components/admin/work/settings-form";
import { mainCurrency } from "@/lib/markets";
import { OFFERABLE_CURRENCIES } from "@/lib/money";
import { workBase } from "@/lib/work-paths";
import { SERIES_TEXT, sellerReadiness } from "@/lib/work-settings";
import { getWorkSeries, getWorkSettings, sellerDetails } from "@/server/work-settings";

import { saveWorkSeriesAction, saveWorkSettingsAction } from "../settings-actions";
import { memberCan, requirePermission } from "@/server/permissions";
import { PageHeader } from "@/components/admin/ui";
import { workWords } from "@/server/work-words";
import { workText } from "@/lib/work-text";

export const metadata: Metadata = { title: "Work settings" };

const card = "rounded-lg border border-line bg-card p-5";

/**
 * Work's settings (D122, docs/work.md 5.2): who is selling and how to pay,
 * defaults, numbering, and what is still missing before the first invoice.
 * Owners change them; admins see them.
 */
export default async function WorkSettingsPage({ params }: PageProps<"/admin/account/work/s/[store]/settings">) {
  await workWords();
  const tw = workText().pageStoreSettingsPage;
  const viewer = await requirePermission((await params).store, "settings:read");
  const { store } = viewer;
  const off = (await workWords()).w.off;
  if (!store.workOn) return <WorkOff storeSlug={store.slug} title={off.titles.worksettings} words={off} />;
  const owner = memberCan(viewer, "owner");
  const [settings, series, seller] = await Promise.all([
    getWorkSettings(store.id),
    getWorkSeries(store.id),
    sellerDetails(store.id),
  ]);
  const readiness = sellerReadiness(seller);
  const base = `/admin/${store.slug}`;
  const where = (place: string) => (place === "company" ? `${base}/settings/company` : "#vat-heading");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tw.workSettings}
        description={<>{tw.whatInvoicesSay}{" "}<Link href={workBase(store.slug)} className="underline">{tw.backToWork}</Link></>}
      />

      <section aria-labelledby="ready-heading" className={card}>
        <h2 id="ready-heading" className="mb-1 text-title text-ink">
          {readiness.problems.length === 0
            ? tw.youCanIssueInvoices
            : tw.whatIsStillMissing}
        </h2>
        {readiness.problems.length === 0 ? (
          <p className="text-sm text-muted">
            {tw.yourDetailsAreComplete}
          </p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {readiness.problems.map((problem) => (
              <li key={problem.code} className="flex flex-wrap items-baseline gap-x-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${problem.severity === "error" ? "bg-danger-soft text-danger-text " : "bg-warning-soft text-warning-text "}`}
                >
                  {problem.severity === "error" ? "Needed" : "Check"}
                </span>
                <span>{problem.message}</span>
                <Link href={where(problem.where)} className="underline">
                  {problem.where === "company" ? tw.openTheCompanyPage : tw.fixItBelow}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="seller-heading" className={card}>
        <h2 id="seller-heading" className="mb-1 text-title text-ink">
          {tw.whoIsSelling}
        </h2>
        <p className="mb-3 text-sm text-muted">
          {tw.yourBusinessAsIt}
        </p>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-muted">{tw.legalName}</dt>
          <dd>{seller.legalName ?? <span className="text-muted">{tw.notSet}</span>}</dd>
          <dt className="text-muted">{tw.organisationNumber}</dt>
          <dd>{seller.organisationNumber ?? <span className="text-muted">{tw.notSet}</span>}</dd>
          <dt className="text-muted">{tw.address}</dt>
          <dd>{seller.postalAddress ?? <span className="text-muted">{tw.notSet}</span>}</dd>
          <dt className="text-muted">{tw.country}</dt>
          <dd>{seller.country ?? <span className="text-muted">{tw.notSet}</span>}</dd>
        </dl>
        <p className="mt-3 text-sm">
          <Link href={`${base}/settings/company`} className="underline">
            {tw.changeOnTheCompany}
          </Link>
        </p>
      </section>

      <WorkSettingsForm
        action={saveWorkSettingsAction.bind(null, store.slug)}
        settings={settings}
        currencies={[...OFFERABLE_CURRENCIES]}
        mainCurrency={mainCurrency(store)}
        canEdit={owner}
      />

      <section aria-labelledby="numbering-heading" className={card}>
        <h2 id="numbering-heading" className="mb-1 text-title text-ink">
          {tw.numbering}
        </h2>
        <p className="mb-4 text-sm text-muted">
          {tw.invoicesAndCreditNotes}
        </p>
        <div className="flex flex-col gap-6">
          {(["work_invoice", "work_credit_note"] as const).map((name) => (
            <SeriesForm
              key={name}
              action={saveWorkSeriesAction.bind(null, store.slug, name)}
              title={SERIES_TEXT[name].title}
              prefix={series[name].prefix}
              nextNumber={series[name].nextNumber}
              issued={series[name].issued}
              lastDocumentNumber={series[name].lastDocumentNumber}
              nextDocumentNumber={series[name].nextDocumentNumber}
              canEdit={owner}
            />
          ))}
        </div>
      </section>

      <section aria-labelledby="differs-heading" className={card}>
        <h2 id="differs-heading" className="mb-1 text-title text-ink">
          {tw.howThisDiffersFrom}
        </h2>
        <p className="mb-2 text-sm text-muted">
          {tw.ifYouUsedWork}
        </p>
        <ul className="list-disc pl-5 text-sm">
          <li>
            {tw.anAssignmentHasOne}
          </li>
          <li>{tw.anIssuedInvoiceNever}</li>
          <li>{tw.theNumberIsTaken}</li>
          <li>
            {tw.repeatingInvoicesAreMade}
          </li>
          <li>
            {tw.invoicesCarryYourBusiness}
          </li>
        </ul>
      </section>
    </div>
  );
}
