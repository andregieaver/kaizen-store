import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { getResource } from "@/server/bookings";
import { getUnitProperty } from "@/server/dac7";
import { requireHost } from "@/server/hosts";

import { ResourceCalendar, type CalendarActions } from "../../../../[store]/bookings/resource-calendar";
import {
  hostAddBlockAction,
  hostAddFeedAction,
  hostRemoveBlockAction,
  hostRemoveFeedAction,
  hostResetCalendarAction,
  hostSavePropertyAction,
  hostSyncFeedAction,
} from "../../actions";

const field = "flex flex-col gap-1 text-sm font-medium";
const control = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";

export const metadata: Metadata = { title: "Calendar" };

/** A host's room or item (D71): its blocked dates and calendar sync, as the store has them. */
export default async function HostUnitPage({ params }: PageProps<"/admin/hosting/[store]/units/[unitId]">) {
  const { store: slug, unitId } = await params;
  const { store, host } = await requireHost(slug);
  if (!z.uuid().safeParse(unitId).success) notFound();
  const unit = await getResource(store.id, unitId);
  if (!unit || unit.hostId !== host.id || unit.kind === "staff") notFound();
  const property = unit.kind === "unit" ? await getUnitProperty(store.id, unit.id) : null;
  const actions: CalendarActions = {
    addBlock: hostAddBlockAction.bind(null, store.slug, unit.id),
    removeBlock: hostRemoveBlockAction.bind(null, store.slug),
    resetCalendar: hostResetCalendarAction.bind(null, store.slug, unit.id),
    addFeed: hostAddFeedAction.bind(null, store.slug, unit.id),
    syncFeed: hostSyncFeedAction.bind(null, store.slug),
    removeFeed: hostRemoveFeedAction.bind(null, store.slug),
  };
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <Link href={`/admin/hosting/${store.slug}`} className="text-sm underline">
          {host.name}
        </Link>
        <h1 className="text-2xl font-semibold">{unit.name}</h1>
      </div>
      <ResourceCalendar storeId={store.id} timeZone={store.timeZone} resource={unit} actions={actions} />
      {property && (
        <section aria-labelledby="property-heading" className="flex flex-col gap-3 rounded-lg border border-border bg-background p-5">
          <div>
            <h2 id="property-heading" className="font-medium">
              Where it is
            </h2>
            <p className="text-sm text-muted">
              The store reports each rented home&apos;s address to the tax authority once a year (DAC7). Guests do not see it here.
            </p>
          </div>
          <ActionForm action={hostSavePropertyAction.bind(null, store.slug, unit.id)} className="flex flex-col gap-3">
            <label className={field}>
              Address
              <textarea name="address" required rows={2} maxLength={400} defaultValue={property.address} className={`${control} py-2`} />
            </label>
            <label className={field}>
              <span>
                Land registry number <span className="font-normal text-muted">(if it has one, e.g. gnr./bnr.)</span>
              </span>
              <input name="landRegistryNumber" maxLength={80} defaultValue={property.landRegistryNumber} className={control} />
            </label>
            <div>
              <SubmitButton>Save address</SubmitButton>
            </div>
          </ActionForm>
        </section>
      )}
    </div>
  );
}
