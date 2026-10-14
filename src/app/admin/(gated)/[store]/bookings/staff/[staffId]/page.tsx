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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: `/admin/${store.slug}/bookings/staff`, label: "Staff and hours" }} title={<>{staff.name}</>} />
      <StaffForm staff={staff} action={saveStaffAction.bind(null, store.slug, staff.id)} />
      <ResourceCalendar storeId={store.id} timeZone={store.timeZone} resource={staff} actions={storeCalendarActions(store.slug, staff.id)} />
      <DeleteDiscountButton
        action={removeStaffAction.bind(null, store.slug, staff.id)}
        code={staff.name}
        question={
          staff.upcoming > 0
            ? `Remove ${staff.name}? They stop taking bookings; their ${staff.upcoming} booked appointments stay, with them.`
            : `Remove ${staff.name}? They stop taking bookings.`
        }
        label={`Remove ${staff.name}`}
      />
    </div>
  );
}
