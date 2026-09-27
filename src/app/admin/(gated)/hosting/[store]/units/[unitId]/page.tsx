import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { getResource } from "@/server/bookings";
import { requireHost } from "@/server/hosts";

import { ResourceCalendar, type CalendarActions } from "../../../../[store]/bookings/resource-calendar";
import {
  hostAddBlockAction,
  hostAddFeedAction,
  hostRemoveBlockAction,
  hostRemoveFeedAction,
  hostResetCalendarAction,
  hostSyncFeedAction,
} from "../../actions";

export const metadata: Metadata = { title: "Calendar" };

/** A host's room or item (D71): its blocked dates and calendar sync, as the store has them. */
export default async function HostUnitPage({ params }: PageProps<"/admin/hosting/[store]/units/[unitId]">) {
  const { store: slug, unitId } = await params;
  const { store, host } = await requireHost(slug);
  if (!z.uuid().safeParse(unitId).success) notFound();
  const unit = await getResource(store.id, unitId);
  if (!unit || unit.hostId !== host.id || unit.kind === "staff") notFound();
  const actions: CalendarActions = {
    addBlock: hostAddBlockAction.bind(null, store.slug, unit.id),
    removeBlock: hostRemoveBlockAction.bind(null, store.slug),
    resetCalendar: hostResetCalendarAction.bind(null, store.slug, unit.id),
    addFeed: hostAddFeedAction.bind(null, store.slug, unit.id),
    syncFeed: hostSyncFeedAction.bind(null, store.slug),
    removeFeed: hostRemoveFeedAction.bind(null, store.slug),
  };
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
      <div>
        <Link href={`/admin/hosting/${store.slug}`} className="text-sm underline">
          {host.name}
        </Link>
        <h1 className="text-2xl font-semibold">{unit.name}</h1>
      </div>
      <ResourceCalendar storeId={store.id} timeZone={store.timeZone} resource={unit} actions={actions} />
    </main>
  );
}
