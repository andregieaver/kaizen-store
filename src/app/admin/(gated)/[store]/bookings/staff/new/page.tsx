import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { requirePermission } from "@/server/permissions";
import { PageHeader } from "@/components/admin/ui";
import { AdminTextScope } from "@/components/admin/admin-text";
import { adminLangOf } from "@/lib/admin-lang";
import { areaTexts } from "@/lib/admin-area";
import { BOOKINGS_WORDS } from "@/lib/admin-words/bookings";
import { SETTINGS_HOURS_WORDS } from "@/lib/admin-words/settings-hours";

import { saveStaffAction } from "../../actions";
import { StaffForm } from "../staff-form";

export const metadata: Metadata = { title: "Add staff" };

export default async function NewStaffPage({ params }: PageProps<"/admin/[store]/bookings/staff/new">) {
  const current = await requirePermission((await params).store, "bookings:read");
  const off = requireFeature(current, "appointments");
  if (off) return off;
  const { store } = current;
  const lang = adminLangOf(current.account.adminLocale);
  const t = BOOKINGS_WORDS[lang];
  return (
    <AdminTextScope texts={areaTexts(lang, { settingsHours: SETTINGS_HOURS_WORDS })}>
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: `/admin/${store.slug}/bookings/staff`, label: t.staff.title }} title={t.staff.add} />
      <StaffForm staff={null} words={t.staffForm} action={saveStaffAction.bind(null, store.slug, null)} />
    </div>
    </AdminTextScope>
  );
}
