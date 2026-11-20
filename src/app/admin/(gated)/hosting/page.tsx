import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { requireAccount } from "@/server/auth";
import { listHostings } from "@/server/hosts";
import { CARD_CLASS, EmptyState, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { BOOKINGS_WORDS } from "@/lib/admin-words/bookings";

export const metadata: Metadata = { title: "Hosting" };

/** The stores the account hosts for (D71); with just one, straight to it. */
export default async function HostingPage() {
  const account = await requireAccount();
  const hostings = await listHostings(account);
  if (hostings.length === 1) redirect(`/admin/hosting/${hostings[0].slug}`);
  const w = BOOKINGS_WORDS[adminLangOf(account.adminLocale)].hosting;
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader title={w.title} />
      {hostings.length === 0 ? (
        <EmptyState title={w.none} />
      ) : (
        <ul className={`divide-y divide-line ${CARD_CLASS}`}>
          {hostings.map((h) => (
            <li key={h.slug} className="p-4 text-sm">
              <Link href={`/admin/hosting/${h.slug}`} className="font-medium underline-offset-2 hover:underline">
                {h.name}
              </Link>
              <span className="block text-muted">{fillWords(w.as, { name: h.hostName })}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
