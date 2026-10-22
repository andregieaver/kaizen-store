import Link from "next/link";

import { homeEn, type HomeMessages } from "@/lib/admin-messages/home.en";
import { copyWizardPath } from "@/lib/store-copy-paths";
import type { StoreSummary } from "@/server/auth";

/**
 * The stores an account works in, as cards. `canDuplicate` (D129) is true where the account may copy its stores:
 * only the ones it owns (or any, for the platform's admins) get a Duplicate link.
 */
export function StoresList({
  stores,
  canDuplicate = false,
  platformAdmin = false,
  words: w = homeEn.stores,
}: {
  stores: StoreSummary[];
  canDuplicate?: boolean;
  platformAdmin?: boolean;
  /** The `home` catalogue's `stores` words in the account's language (D312 A3). */
  words?: HomeMessages["stores"];
}) {
  if (stores.length === 0) return <p className="text-sm text-muted">{w.noAccess}</p>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {stores.map((store) => (
        <li key={store.slug} className="flex flex-col rounded-panel border border-line bg-card hover:border-brand">
          <Link href={`/admin/${store.slug}`} className="block rounded-t-lg p-4">
            <span className="font-medium">{store.name}</span>
            <span className="block text-sm text-muted">
              {store.slug} · {w.roles[store.role as keyof typeof w.roles] ?? store.role}
            </span>
          </Link>
          {canDuplicate && (store.role === "owner" || platformAdmin) && (
            <div className="border-t border-line px-4 py-2 text-sm">
              <Link href={copyWizardPath(store.slug)} className="underline underline-offset-2">
                {w.duplicate}<span className="sr-only"> {store.name}</span>
              </Link>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
