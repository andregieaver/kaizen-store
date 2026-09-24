import type { Metadata } from "next";

import { EmailLog } from "@/components/admin/email-log";
import { requireMember } from "@/server/auth";
import { listEmails } from "@/server/email";

export const metadata: Metadata = { title: "Emails" };

/** The emails the store has sent its customers (D26). */
export default async function StoreEmailsPage({ params }: PageProps<"/admin/[store]/emails">) {
  const { store } = await requireMember((await params).store);
  const emails = await listEmails({ storeId: store.id, limit: 200 });
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Emails to customers</h1>
      <section className="rounded-lg border border-border bg-background p-5">
        <EmailLog emails={emails} base={`/admin/${store.slug}/emails`} locale={store.markets[0]?.locale} />
      </section>
    </div>
  );
}
