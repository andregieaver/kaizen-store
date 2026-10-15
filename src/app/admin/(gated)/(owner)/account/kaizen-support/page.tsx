import type { Metadata } from "next";

import { KaizenRequests } from "@/components/admin/support/kaizen-requests";
import { requireAccount } from "@/server/auth";
import { myStores, requesterConversations } from "@/server/support-kaizen";
import { PageHeader } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Kaizena Flow support" };

/**
 * *Your requests to Kaizen* (D216, 2.8, step 11): the account's own conversations with Kaizen's support, and a new one. Kaizen's
 * assistant answers first from Kaizen's knowledge, the account's stores (read-only) and the admin's pages; Kaizen's people take over.
 */
export default async function KaizenSupportPage({ searchParams }: PageProps<"/admin/account/kaizen-support">) {
  const account = await requireAccount();
  const [rows, stores] = await Promise.all([requesterConversations(account), myStores(account.id)]);
  const c = (await searchParams).c;
  const open = typeof c === "string" && rows.some((row) => row.id === c) ? c : null;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Kaizena Flow support"
        description={<>Ask Kaizena Flow for help with your stores or your account. Kaizena Flow&apos;s assistant answers first, and a person from Kaizena Flow takes over when needed. Answers also come by email when you are away.</>}
      />
      <KaizenRequests initial={rows} stores={stores.map((s) => ({ slug: s.store, name: s.name }))} initialOpen={open} />
    </div>
  );
}
