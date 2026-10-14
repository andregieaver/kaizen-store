import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { requirePermission } from "@/server/permissions";
import { PageHeader } from "@/components/admin/ui";

import { saveStaffAction } from "../../actions";
import { StaffForm } from "../staff-form";

export const metadata: Metadata = { title: "Add staff" };

export default async function NewStaffPage({ params }: PageProps<"/admin/[store]/bookings/staff/new">) {
  const current = await requirePermission((await params).store, "bookings:read");
  const off = requireFeature(current, "appointments");
  if (off) return off;
  const { store } = current;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: `/admin/${store.slug}/bookings/staff`, label: "Staff and hours" }} title="Add staff" />
      <StaffForm staff={null} action={saveStaffAction.bind(null, store.slug, null)} />
    </div>
  );
}
