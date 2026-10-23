import { adminLangOf } from "@/lib/admin-lang";
import { AdminTextScope } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";
import { adminText, adminTexts } from "@/lib/admin-text";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { requireFeature } from "@/components/admin/feature-off";
import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { requirePermission } from "@/server/permissions";
import { getResource } from "@/server/bookings";
import { PageHeader } from "@/components/admin/ui";

import { removeStaffAction, saveStaffAction } from "../../actions";
import { ResourceCalendar } from "../../resource-calendar";
import { storeCalendarActions } from "../../store-calendar-actions";
import { StaffForm } from "../staff-form";

export const metadata: Metadata = { title: "Staff" };

export default async function StaffMemberPage({ params }: PageProps<"/admin/[store]/bookings/staff/[staffId]">) {
  const { store: slug, staffId } = await params;
  const current = await requirePermission(slug, "bookings:read");
  const off = requireFeature(current, "appointments");
  if (off) return off;
  const { store } = current;
  if (!z.uuid().safeParse(staffId).success) notFound();
  const staff = await getResource(store.id, staffId);
  if (!staff || staff.kind !== "staff") notFound();
  const lang = adminLangOf(current.account.adminLocale);
  const t = adminText(lang, "bookings");

  return (
    <AdminTextScope texts={adminTexts(lang, ["settings"])}>
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: `/admin/${store.slug}/bookings/staff`, label: t.staff.title }} title={<>{staff.name}</>} />
      <StaffForm staff={staff} words={t.staffForm} action={saveStaffAction.bind(null, store.slug, staff.id)} />
      <ResourceCalendar storeId={store.id} timeZone={store.timeZone} lang={lang} resource={staff} actions={storeCalendarActions(store.slug, staff.id)} />
      <DeleteDiscountButton
        action={removeStaffAction.bind(null, store.slug, staff.id)}
        code={staff.name}
        question={
          staff.upcoming > 0
            ? fillWords(t.staff.removeAhead, { name: staff.name, n: staff.upcoming })
            : fillWords(t.staff.removeAsk, { name: staff.name })
        }
        label={fillWords(t.staff.remove, { name: staff.name })}
      />
    </div>
    </AdminTextScope>
  );
}
