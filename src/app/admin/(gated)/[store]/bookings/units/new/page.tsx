import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { requirePermission } from "@/server/permissions";
import { hostChoices } from "@/server/hosts";
import { PageHeader } from "@/components/admin/ui";

import { saveUnitAction } from "../../actions";
import { UnitForm } from "../unit-form";

export const metadata: Metadata = { title: "Add a room or item" };

export default async function NewUnitPage({ params, searchParams }: PageProps<"/admin/[store]/bookings/units/new">) {
  const current = await requirePermission((await params).store, "bookings:read");
  const off = requireFeature(current, "bookings");
  if (off) return off;
  const { store } = current;
  const kind = (await searchParams).kind === "item" ? "item" : "unit";
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: `/admin/${store.slug}/bookings/units`, label: "Rooms and rental items" }}
        title={<>{kind === "unit" ? "Add a room or home" : "Add a rental item"}</>}
      />
      <UnitForm kind={kind} unit={null} hosts={await hostChoices(store.id)} action={saveUnitAction.bind(null, store.slug, kind, null)} />
    </div>
  );
}
