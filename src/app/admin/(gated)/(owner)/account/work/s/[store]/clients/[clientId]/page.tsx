import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  ArchiveClientButton,
  DeleteClientButton,
  EditClientButton,
  NewAssignmentButton,
} from "@/components/admin/work/client-actions";
import { ClientAssignments, ClientDetails, ClientFigures } from "@/components/admin/work/client-detail";
import { BillUnbilledTimeSlot, ClientInvoicesSlot } from "@/components/admin/work/invoice-slots";
import { RecurringPanel } from "@/components/admin/work/recurring-panel";
import { Badge } from "@/components/admin/work/work-parts";
import { WorkOff } from "@/components/admin/work/work-off";
import { OFFERABLE_CURRENCIES } from "@/lib/money";
import { listCountries } from "@/server/stores";
import { formDefaults, getClient, listAssignments } from "@/server/work";
import { sellerDetails } from "@/server/work-settings";
import { workBase } from "@/lib/work-paths";
import { memberCan, requirePermission } from "@/server/permissions";

export const metadata: Metadata = { title: "Client" };

/**
 * One client (D122): who they are and how they are billed, their assignments
 * with what is logged and not yet invoiced, and (later) their invoices. Any
 * member changes a client or archives it; only an owner deletes one, and only
 * one with no history.
 */
export default async function WorkClientPage({ params }: PageProps<"/admin/account/work/s/[store]/clients/[clientId]">) {
  const { store: slug, clientId } = await params;
  const viewer = await requirePermission(slug, "settings:read");
  const { store } = viewer;
  if (!store.workOn) return <WorkOff storeSlug={store.slug} title="Client" />;
  const client = await getClient(store.id, clientId);
  if (!client) notFound();

  const [assignments, defaults, countries, seller] = await Promise.all([
    listAssignments(store.id, { clientId, status: "all" }),
    formDefaults(store),
    listCountries(),
    sellerDetails(store.id),
  ]);
  const base = workBase(store.slug);
  const locale = store.markets[0]?.locale ?? "en";
  const archived = client.archivedAt !== null;
  const currencies = [...OFFERABLE_CURRENCIES];
  const subtitle = [client.contactName, client.billingEmail].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`${base}/clients`} className="text-sm underline">
          Clients
        </Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold [overflow-wrap:anywhere]">
              {client.name} {archived && <Badge>Archived</Badge>}
            </h1>
            {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
          </div>
          <div className="flex flex-wrap items-start gap-2">
            <EditClientButton
              storeSlug={store.slug}
              client={client}
              countries={countries.map(({ code, name }) => ({ code, name }))}
              currencies={currencies}
              defaults={defaults}
              sellerCountry={seller.country}
            />
            <ArchiveClientButton storeSlug={store.slug} clientId={client.id} archived={archived} />
          </div>
        </div>
      </div>

      <ClientFigures client={client} />
      <ClientDetails client={client} locale={locale} paymentDaysDefault={defaults.paymentDays} />

      <section aria-labelledby="assignments-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="assignments-heading" className="text-lg font-semibold">
            Assignments
          </h2>
          {archived ? (
            <p className="text-sm text-muted">Bring the client back to give it a new assignment.</p>
          ) : (
            <NewAssignmentButton
              storeSlug={store.slug}
              clientId={client.id}
              currency={client.currency}
              clientRateMinor={client.defaultHourlyRateMinor}
              locale={locale}
              estimateAlert={defaults.estimateAlert}
            />
          )}
        </div>
        <ClientAssignments base={base} assignments={assignments} locale={locale} />
      </section>

      <BillUnbilledTimeSlot
        storeSlug={store.slug}
        scope={{ clientId: client.id }}
        currency={client.currency}
        locale={locale}
        unbilledMinutes={client.unbilledMinutes}
        unbilledAmountMinor={assignments.reduce((sum, a) => sum + a.summary.unbilledAmountMinor, 0)}
      />
      <ClientInvoicesSlot
        storeSlug={store.slug}
        clientId={client.id}
        clientName={client.name}
        currency={client.currency}
        locale={locale}
        archived={archived}
        unbilledMinutes={client.unbilledMinutes}
      />
      <RecurringPanel
        storeSlug={store.slug}
        clientId={client.id}
        currency={client.currency}
        currencies={currencies}
        locale={locale}
        archived={archived}
      />

      {memberCan(viewer, "owner") && (
        <section aria-labelledby="delete-heading" className="flex flex-col gap-2 border-t border-border pt-4">
          <h2 id="delete-heading" className="text-sm font-medium">
            Delete this client
          </h2>
          <p className="text-sm text-muted">
            Only a client with no assignments and no invoices can be deleted. Otherwise archive it: nothing is lost, and
            it leaves the lists.
          </p>
          <DeleteClientButton storeSlug={store.slug} clientId={client.id} name={client.name} />
        </section>
      )}
    </div>
  );
}
