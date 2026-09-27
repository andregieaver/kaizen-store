import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { StoresList } from "@/components/admin/stores-list";
import { listStores, requireAccount } from "@/server/auth";
import { listHostings } from "@/server/hosts";

export const metadata: Metadata = { title: "Your stores" };

/**
 * The stores the account works in. With just one, go straight to it (All
 * stores lists them always); an outside host with no store of their own goes
 * to their hosting (D71).
 */
export default async function StoresPage() {
  const account = await requireAccount();
  const [stores, hostings] = await Promise.all([listStores(account), listHostings(account)]);
  if (stores.length === 0 && hostings.length > 0) redirect("/admin/hosting");
  if (stores.length === 1 && hostings.length === 0) redirect(`/admin/${stores[0].slug}`);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">Your stores</h1>
        <Link href="/admin/stores" className="text-sm underline">
          Create a store
        </Link>
      </div>
      <StoresList stores={stores} />
      {hostings.length > 0 && (
        <section aria-labelledby="hosting-heading" className="flex flex-col gap-2">
          <h2 id="hosting-heading" className="text-lg font-semibold">
            Hosting
          </h2>
          <ul className="divide-y divide-border rounded-lg border border-border bg-background text-sm">
            {hostings.map((h) => (
              <li key={h.slug} className="p-4">
                <Link href={`/admin/hosting/${h.slug}`} className="font-medium underline-offset-2 hover:underline">
                  {h.name}
                </Link>
                <span className="block text-muted">As {h.hostName}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
