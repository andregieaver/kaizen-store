import type { Metadata } from "next";
import { AdminTextScope } from "@/components/admin/admin-text";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";

import { RequestsView } from "@/components/admin/support/requests-view";
import { requirePermission } from "@/server/permissions";
import { listRequests } from "@/server/support-actions";
import { memberDesk } from "@/server/support-desk";
import { PageHeader } from "@/components/admin/ui";

import { decideRequestAction } from "./actions";

export const metadata: Metadata = { title: "Support requests" };

/** What the store's chat assistant passed to a person (D216, `docs/support.md` 2.4, step 10): decide each, and the customer is told. */
export default async function SupportRequestsPage({
  params,
  searchParams,
}: PageProps<"/admin/[store]/support/requests">) {
  const { store: slug } = await params;
  const member = await requirePermission(slug, "support:read");
  const staff = memberDesk(member);
  const lang = adminLangOf(member.account.adminLocale);
  const t = adminText(lang, "support");
  const which = (await searchParams).show === "decided" ? "decided" : "open";
  const rows = await listRequests(staff.desk, which);
  return (
    <AdminTextScope texts={adminTexts(lang, ["support"])}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t.pages.storeRequests.title}
          description={t.pages.storeRequests.description}
        />
        <RequestsView
          words={t}
          rows={rows}
          which={which}
          base={`/admin/${slug}`}
          decide={
            staff.canWrite
              ? (id) => decideRequestAction.bind(null, slug, id)
              : null
          }
          now={new Date()}
        />
      </div>
    </AdminTextScope>
  );
}
