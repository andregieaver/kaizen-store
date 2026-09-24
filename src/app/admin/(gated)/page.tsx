import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { StoresList } from "@/components/admin/stores-list";
import { listStores, requireAccount } from "@/server/auth";

export const metadata: Metadata = { title: "Your stores" };

/** The stores the account works in. With just one, go straight to it (All stores lists them always). */
export default async function StoresPage() {
  const account = await requireAccount();
  const stores = await listStores(account);
  if (stores.length === 1) redirect(`/admin/${stores[0].slug}`);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">Your stores</h1>
        <Link href="/admin/stores" className="text-sm underline">
          Create a store
        </Link>
      </div>
      <StoresList stores={stores} />
    </main>
  );
}
