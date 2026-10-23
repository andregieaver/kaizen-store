import type { Metadata } from "next";
import Link from "next/link";

import { requireFeature } from "@/components/admin/feature-off";
import { weekSummary } from "@/lib/opening-hours";
import { requirePermission } from "@/server/permissions";
import { listResources } from "@/server/bookings";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

export const metadata: Metadata = { title: "Staff and hours" };

/** Who takes appointments, and when (D65). */
export default async function StaffPage({ params }: PageProps<"/admin/[store]/bookings/staff">) {
  const current = await requirePermission((await params).store, "bookings:read");
  const off = requireFeature(current, "appointments");
  if (off) return off;
  const { store } = current;
  const lang = adminLangOf(current.account.adminLocale);
  const w = adminText(lang, "bookings").staff;
  const hw = adminText(lang, "settings").hours;
  const staff = await listResources(store.id);
  const base = `/admin/${store.slug}/bookings/staff`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title={w.title} description={w.description} />
        <Link href={`${base}/new`} className="min-h-10 rounded-pill bg-brand px-4 py-2 text-sm font-medium text-brand-ink">
          {w.add}
        </Link>
      </div>
      {staff.length === 0 ? (
        <p className="rounded-md border border-dashed border-line p-6 text-center text-sm text-muted">
          {w.none}
        </p>
      ) : (
        <ul className={`divide-y divide-line ${CARD_CLASS}`}>
          {staff.map((s) => (
            <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 p-4 text-sm">
              <div className="min-w-0">
                <Link href={`${base}/${s.id}`} className="font-medium underline-offset-2 hover:underline">
                  {s.name}
                </Link>
                {!s.active && <span className="ml-2 rounded bg-sunken px-1.5 py-0.5 text-xs">{w.notTaking}</span>}
                <span className="block text-muted">{weekSummary(s.hours.week, hw) || w.noHours}</span>
                <span className="block text-xs text-muted">
                  {countWords(s.services, w.appointments)} · {fillWords(w.ahead, { n: s.upcoming })}
                  {s.capacity > 1 && ` · ${fillWords(w.atOnce, { n: s.capacity })}`}
                </span>
              </div>
              <Link href={`${base}/${s.id}`} className="min-h-10 rounded-pill px-3 py-2 hover:bg-sunken">
                {w.edit} <span className="sr-only">{s.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
