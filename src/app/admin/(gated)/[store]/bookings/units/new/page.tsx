import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { requirePermission } from "@/server/permissions";
import { hostChoices } from "@/server/hosts";
import { PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

import { saveUnitAction } from "../../actions";
import { UnitForm } from "../unit-form";

export const metadata: Metadata = { title: "Add a room or item" };

export default async function NewUnitPage({ params, searchParams }: PageProps<"/admin/[store]/bookings/units/new">) {
  const current = await requirePermission((await params).store, "bookings:read");
  const off = requireFeature(current, "bookings");
  if (off) return off;
  const { store } = current;
  const kind = (await searchParams).kind === "item" ? "item" : "unit";
  const t = adminText(adminLangOf(current.account.adminLocale), "bookings");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: `/admin/${store.slug}/bookings/units`, label: t.units.title }}
        title={kind === "unit" ? t.units.addRoom : t.units.addItem}
      />
      <UnitForm kind={kind} unit={null} words={t.unitForm} hosts={await hostChoices(store.id)} action={saveUnitAction.bind(null, store.slug, kind, null)} />
    </div>
  );
}
