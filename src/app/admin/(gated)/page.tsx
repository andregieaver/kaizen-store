import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { listStores, requireAccount } from "@/server/auth";

export const metadata: Metadata = { title: "Your stores" };

/** The stores the account works in. With just one, go straight to it. */
export default async function StoresPage() {
  const account = await requireAccount();
  const stores = await listStores(account);
  if (stores.length === 1) redirect(`/admin/${stores[0].slug}`);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold">Your stores</h1>
      {stores.length === 0 ? (
        <p className="text-sm text-muted">You do not have access to any store yet.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {stores.map((store) => (
            <li key={store.slug}>
              <Link
                href={`/admin/${store.slug}`}
                className="block rounded-lg border border-border bg-background p-4 hover:border-foreground"
              >
                <span className="font-medium">{store.name}</span>
                <span className="block text-sm text-muted">
                  {store.slug} · {store.role}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
