import type { Metadata } from "next";
import Link from "next/link";

import { requireFeature } from "@/components/admin/feature-off";
import { requirePermission } from "@/server/permissions";
import { listResources, type BookingResource } from "@/server/bookings";
import { PageHeader } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";


export const metadata: Metadata = { title: "Rooms and rental items" };

/** What is booked by the night or the day (D67): rooms and homes for stays, items for rentals. */
export default async function UnitsPage({ params }: PageProps<"/admin/[store]/bookings/units">) {
  const current = await requirePermission((await params).store, "bookings:read");
  const off = requireFeature(current, "bookings");
  if (off) return off;
  const { store } = current;
  const w = adminText(adminLangOf(current.account.adminLocale), "bookings").units;
  const all = await listResources(store.id, ["unit", "item"]);
  const base = `/admin/${store.slug}/bookings/units`;
  const button = "min-h-10 rounded-pill border border-edge px-4 py-2 text-sm font-medium";

  const list = (items: BookingResource[], empty: string) =>
    items.length === 0 ? (
      <p className="rounded-md border border-dashed border-line p-6 text-center text-sm text-muted">{empty}</p>
    ) : (
      <ul className="divide-y divide-line rounded-panel border border-line bg-card">
        {items.map((u) => (
          <li key={u.id} className="flex flex-wrap items-start justify-between gap-3 p-4 text-sm">
            <div className="min-w-0">
              <Link href={`${base}/${u.id}`} className="font-medium underline-offset-2 hover:underline">
                {u.name}
              </Link>
              {!u.active && <span className="ml-2 rounded bg-sunken px-1.5 py-0.5 text-xs">{w.notTaking}</span>}
              <span className="block text-xs text-muted">
                {countWords(u.services, w.inProducts)} · {fillWords(w.ahead, { n: u.upcoming })}
                {u.capacity > 1 && ` · ${fillWords(w.atOnce, { n: u.capacity })}`}
              </span>
            </div>
            <Link href={`${base}/${u.id}`} className="min-h-10 rounded-pill px-3 py-2 hover:bg-sunken">
              {w.edit} <span className="sr-only">{u.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.title}
        description={w.description}
      />
      <section aria-labelledby="units-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="units-heading" className="text-title text-ink">
            {w.rooms}
          </h2>
          <Link href={`${base}/new?kind=unit`} className={button}>
            {w.addRoom}
          </Link>
        </div>
        {list(
          all.filter((u) => u.kind === "unit"),
          w.noRooms,
        )}
      </section>
      <section aria-labelledby="items-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="items-heading" className="text-title text-ink">
            {w.items}
          </h2>
          <Link href={`${base}/new?kind=item`} className={button}>
            {w.addItem}
          </Link>
        </div>
        {list(
          all.filter((u) => u.kind === "item"),
          w.noItems,
        )}
      </section>
    </div>
  );
}
