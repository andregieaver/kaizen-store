import type { Metadata } from "next";

import { RequestsView } from "@/components/admin/support/requests-view";
import { requirePermission } from "@/server/permissions";
import { listRequests } from "@/server/support-actions";
import { memberDesk } from "@/server/support-desk";

import { decideRequestAction } from "./actions";

export const metadata: Metadata = { title: "Support requests" };

/** What the store's chat assistant passed to a person (D216, `docs/support.md` 2.4, step 10): decide each, and the customer is told. */
export default async function SupportRequestsPage({ params, searchParams }: PageProps<"/admin/[store]/support/requests">) {
  const { store: slug } = await params;
  const member = await requirePermission(slug, "support:read");
  const staff = memberDesk(member);
  const which = (await searchParams).show === "decided" ? "decided" : "open";
  const rows = await listRequests(staff.desk, which);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-display text-ink">Requests</h1>
        <p className="text-muted">What the chat assistant could not do and passed to your team: refunds, cancelling an order, a new address, an exception.</p>
      </div>
      <RequestsView
        rows={rows}
        which={which}
        base={`/admin/${slug}`}
        decide={staff.canWrite ? (id) => decideRequestAction.bind(null, slug, id) : null}
        now={new Date()}
      />
    </div>
  );
}
