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

export const metadata: Metadata = { title: "Work settings" };

const card = "rounded-lg border border-border bg-background p-5";

/**
 * Work's settings (D122, docs/work.md 5.2): who is selling and how to pay,
 * defaults, numbering, and what is still missing before the first invoice.
 * Owners change them; admins see them.
 */
export default async function WorkSettingsPage({ params }: PageProps<"/admin/account/work/s/[store]/settings">) {
  const viewer = await requirePermission((await params).store, "settings:read");
  const { store } = viewer;
  if (!store.workOn) return <WorkOff storeSlug={store.slug} title="Work settings" />;
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
      <div>
        <h1 className="text-2xl font-semibold">Work settings</h1>
        <p className="text-sm text-muted">
          What your invoices say about you, how clients pay, and how invoices are numbered.{" "}
          <Link href={workBase(store.slug)} className="underline">
            Back to Work
          </Link>
        </p>
      </div>

      <section aria-labelledby="ready-heading" className={card}>
        <h2 id="ready-heading" className="mb-1 font-medium">
          {readiness.problems.length === 0
            ? "You can issue invoices"
            : "What is still missing before you can issue an invoice"}
        </h2>
        {readiness.problems.length === 0 ? (
          <p className="text-sm text-muted">
            Your details are complete. Each invoice is checked again when you issue it: the client&apos;s address and
            country, and the VAT that fits them.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {readiness.problems.map((problem) => (
              <li key={problem.code} className="flex flex-wrap items-baseline gap-x-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${problem.severity === "error" ? "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200" : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"}`}
                >
                  {problem.severity === "error" ? "Needed" : "Check"}
                </span>
                <span>{problem.message}</span>
                <Link href={where(problem.where)} className="underline">
                  {problem.where === "company" ? "Open the Company page" : "Fix it below"}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="seller-heading" className={card}>
        <h2 id="seller-heading" className="mb-1 font-medium">
          Who is selling
        </h2>
        <p className="mb-3 text-sm text-muted">
          Your business as it is printed on invoices. It is the same as on the Company page, where it is changed.
        </p>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-muted">Legal name</dt>
          <dd>{seller.legalName ?? <span className="text-muted">Not set</span>}</dd>
          <dt className="text-muted">Organisation number</dt>
          <dd>{seller.organisationNumber ?? <span className="text-muted">Not set</span>}</dd>
          <dt className="text-muted">Address</dt>
          <dd>{seller.postalAddress ?? <span className="text-muted">Not set</span>}</dd>
          <dt className="text-muted">Country</dt>
          <dd>{seller.country ?? <span className="text-muted">Not set</span>}</dd>
        </dl>
        <p className="mt-3 text-sm">
          <Link href={`${base}/settings/company`} className="underline">
            Change on the Company page
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
        <h2 id="numbering-heading" className="mb-1 font-medium">
          Numbering
        </h2>
        <p className="mb-4 text-sm text-muted">
          Invoices and credit notes are numbered one after the other with no gaps, and the number is taken when you
          issue, never on a draft. Continuing from another system? Set the number here before you issue your first one.
          After that, numbers are fixed.
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
        <h2 id="differs-heading" className="mb-1 font-medium">
          How this differs from Kaizen Life
        </h2>
        <p className="mb-2 text-sm text-muted">
          If you used Work in Kaizen Life, a few things work differently here, because invoices are legal documents.
        </p>
        <ul className="list-disc pl-5 text-sm">
          <li>
            An assignment has one invoice draft at a time. Time you log goes on it, and once it is issued the next draft
            starts.
          </li>
          <li>An issued invoice never changes. To correct one, you issue a credit note and then a new invoice.</li>
          <li>The number is taken when you issue, so deleting a draft never leaves a gap.</li>
          <li>
            Repeating invoices are made as drafts for you to check and issue, unless you switch auto-issue on for that
            one.
          </li>
          <li>
            Invoices carry your business details, VAT and bank account, so they can be issued once these are complete.
          </li>
        </ul>
      </section>
    </div>
  );
}
