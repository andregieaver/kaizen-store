import { WorkNav } from "@/components/admin/work/work-nav";
import { WorkShell } from "@/components/admin/work/work-shell";
import { storesOf } from "@/components/admin/admin-shell-parts";
import { AdminTextScope } from "@/components/admin/admin-text";
import { adminLangOf } from "@/lib/admin-lang";
import { areaTexts } from "@/lib/admin-area";
import { BOOKINGS_WORDS } from "@/lib/admin-words/bookings";
import { WORK_WORDS } from "@/lib/admin-words/work";
import { requireAccount } from "@/server/auth";

/**
 * Work at the store owner's level (D123): the combined pages under
 * `/admin/account/work` and one store's own screens under
 * `/admin/account/work/s/{store}`, sharing a sub-navigation and the person's
 * running timer (one across all their stores, `WorkShell`). The layout stays
 * while they move between them, so the clock and its warnings carry on. It is
 * not the only check: every page and action asks `requirePermission()` (or, for
 * the combined pages, reads only the stores the account belongs to) itself.
 */
export default async function WorkLayout({ children }: LayoutProps<"/admin/account/work">) {
  const account = await requireAccount();
  const stores = (await storesOf(account)).map(({ slug, name, workOn }) => ({ slug, name, workOn }));
  return (
    <AdminTextScope texts={areaTexts(adminLangOf(account.adminLocale), { work: WORK_WORDS, bookings: BOOKINGS_WORDS })}>
      <WorkShell account={account}>
        <WorkNav stores={stores} />
        {children}
      </WorkShell>
    </AdminTextScope>
  );
}
