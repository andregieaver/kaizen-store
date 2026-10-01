import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { requireMember } from "@/server/auth";
import { hostChoices } from "@/server/hosts";
import { getResource } from "@/server/bookings";

import { removeUnitAction, saveUnitAction } from "../../actions";
import { ResourceCalendar } from "../../resource-calendar";
import { storeCalendarActions } from "../../store-calendar-actions";
import { UnitForm } from "../unit-form";

export const metadata: Metadata = { title: "Room or item" };

export default async function UnitPage({ params }: PageProps<"/admin/[store]/bookings/units/[unitId]">) {
  const { store: slug, unitId } = await params;
  const { store } = await requireMember(slug);
  if (!z.uuid().safeParse(unitId).success) notFound();
  const unit = await getResource(store.id, unitId);
  if (!unit || unit.kind === "staff") notFound();
  const kind = unit.kind;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/admin/${store.slug}/bookings/units`} className="text-sm underline">
          Rooms and rental items
        </Link>
        <h1 className="text-2xl font-semibold">{unit.name}</h1>
      </div>
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
