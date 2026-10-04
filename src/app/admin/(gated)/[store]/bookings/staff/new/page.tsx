import type { Metadata } from "next";
import Link from "next/link";

import { requirePermission } from "@/server/permissions";

import { saveStaffAction } from "../../actions";
import { StaffForm } from "../staff-form";

export const metadata: Metadata = { title: "Add staff" };

export default async function NewStaffPage({ params }: PageProps<"/admin/[store]/bookings/staff/new">) {
  const { store } = await requirePermission((await params).store, "bookings:read");
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/admin/${store.slug}/bookings/staff`} className="text-sm underline">
          Staff and hours
        </Link>
        <h1 className="text-2xl font-semibold">Add staff</h1>
      </div>
      <StaffForm staff={null} action={saveStaffAction.bind(null, store.slug, null)} />
    </div>
  );
}
