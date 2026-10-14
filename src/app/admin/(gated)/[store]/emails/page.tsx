import type { Metadata } from "next";

import { EmailLog } from "@/components/admin/email-log";
import { requirePermission } from "@/server/permissions";
import { listEmails } from "@/server/email";
import { PageHeader } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Emails" };

/** The emails the store has sent its customers (D26). */
export default async function StoreEmailsPage({ params }: PageProps<"/admin/[store]/emails">) {
  const { store } = await requirePermission((await params).store, "orders:read");
  const emails = await listEmails({ storeId: store.id, limit: 200 });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Emails to customers" />
      <section className="rounded-card border border-line bg-card p-5">
        <EmailLog emails={emails} base={`/admin/${store.slug}/emails`} locale={store.markets[0]?.locale} />
      </section>
    </div>
  );
}
