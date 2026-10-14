import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { requireFeature } from "@/components/admin/feature-off";
import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { requirePermission } from "@/server/permissions";
import { hostChoices } from "@/server/hosts";
import { getResource } from "@/server/bookings";
import { PageHeader } from "@/components/admin/ui";

import { removeUnitAction, saveUnitAction } from "../../actions";
import { ResourceCalendar } from "../../resource-calendar";
import { storeCalendarActions } from "../../store-calendar-actions";
import { UnitForm } from "../unit-form";

export const metadata: Metadata = { title: "Room or item" };

export default async function UnitPage({ params }: PageProps<"/admin/[store]/bookings/units/[unitId]">) {
  const { store: slug, unitId } = await params;
  const current = await requirePermission(slug, "bookings:read");
  const off = requireFeature(current, "bookings");
  if (off) return off;
  const { store } = current;
  if (!z.uuid().safeParse(unitId).success) notFound();
  const unit = await getResource(store.id, unitId);
  if (!unit || unit.kind === "staff") notFound();
  const kind = unit.kind;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: `/admin/${store.slug}/bookings/units`, label: "Rooms and rental items" }} title={<>{unit.name}</>} />
      <UnitForm kind={kind} unit={unit} hosts={await hostChoices(store.id)} action={saveUnitAction.bind(null, store.slug, kind, unit.id)} />
      <ResourceCalendar storeId={store.id} timeZone={store.timeZone} resource={unit} actions={storeCalendarActions(store.slug, unit.id)} />
      <DeleteDiscountButton
        action={removeUnitAction.bind(null, store.slug, unit.id)}
        code={unit.name}
        question={
          unit.upcoming > 0
            ? `Remove ${unit.name}? It stops taking bookings; its ${unit.upcoming} bookings ahead stay.`
            : `Remove ${unit.name}? It stops taking bookings.`
        }
        label={`Remove ${unit.name}`}
      />
    </div>
  );
}
