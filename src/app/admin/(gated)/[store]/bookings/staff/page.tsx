import type { Metadata } from "next";
import Link from "next/link";

import { weekSummary } from "@/lib/opening-hours";
import { requireMember } from "@/server/auth";
import { listResources } from "@/server/bookings";

export const metadata: Metadata = { title: "Staff and hours" };

/** Who takes appointments, and when (D65). */
export default async function StaffPage({ params }: PageProps<"/admin/[store]/bookings/staff">) {
  const { store } = await requireMember((await params).store);
  const staff = await listResources(store.id);
  const base = `/admin/${store.slug}/bookings/staff`;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Staff and hours</h1>
          <p className="text-sm text-muted">Who takes appointments, and when. Choose who does each appointment in the product.</p>
        </div>
        <Link href={`${base}/new`} className="min-h-10 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background">
          Add staff
        </Link>
      </div>
      {!store.bookingsOn && (
        <p className="rounded-md border border-border p-3 text-sm">
          Appointments are switched off.{" "}
          <Link href={`/admin/${store.slug}/settings/features`} className="underline">
            Switch them on under Features
          </Link>{" "}
          to take bookings.
        </p>
      )}
      {staff.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted">
          No one yet. Add the people who take appointments, with their working hours.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-background">
          {staff.map((s) => (
            <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 p-4 text-sm">
              <div className="min-w-0">
                <Link href={`${base}/${s.id}`} className="font-medium underline-offset-2 hover:underline">
                  {s.name}
                </Link>
                {!s.active && <span className="ml-2 rounded bg-surface px-1.5 py-0.5 text-xs">Not taking bookings</span>}
                <span className="block text-muted">{weekSummary(s.hours.week) || "No working hours"}</span>
                <span className="block text-xs text-muted">
                  {s.services === 1 ? "1 appointment" : `${s.services} appointments`} · {s.upcoming} booked ahead
                  {s.capacity > 1 && ` · ${s.capacity} at once`}
                </span>
              </div>
              <Link href={`${base}/${s.id}`} className="min-h-10 rounded-md px-3 py-2 hover:bg-surface">
                Edit <span className="sr-only">{s.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
