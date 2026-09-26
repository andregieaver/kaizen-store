import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { requireMember } from "@/server/auth";
import { getResource } from "@/server/bookings";

import { removeStaffAction, saveStaffAction } from "../../actions";
import { StaffForm } from "../staff-form";

export const metadata: Metadata = { title: "Staff" };

export default async function StaffMemberPage({ params }: PageProps<"/admin/[store]/bookings/staff/[staffId]">) {
  const { store: slug, staffId } = await params;
  const { store } = await requireMember(slug);
  if (!z.uuid().safeParse(staffId).success) notFound();
  const staff = await getResource(store.id, staffId);
  if (!staff) notFound();

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <Link href={`/admin/${store.slug}/bookings/staff`} className="text-sm underline">
          Staff and hours
        </Link>
        <h1 className="text-2xl font-semibold">{staff.name}</h1>
      </div>
      <StaffForm staff={staff} action={saveStaffAction.bind(null, store.slug, staff.id)} />
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
