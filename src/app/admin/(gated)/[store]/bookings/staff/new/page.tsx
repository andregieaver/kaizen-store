import type { Metadata } from "next";
import Link from "next/link";

import { requireMember } from "@/server/auth";

import { saveStaffAction } from "../../actions";
import { StaffForm } from "../staff-form";

export const metadata: Metadata = { title: "Add staff" };

export default async function NewStaffPage({ params }: PageProps<"/admin/[store]/bookings/staff/new">) {
  const { store } = await requireMember((await params).store);
  return (
    <div className="flex max-w-3xl flex-col gap-6">
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
