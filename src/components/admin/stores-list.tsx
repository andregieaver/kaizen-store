import Link from "next/link";

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
}: {
  stores: StoreSummary[];
  canDuplicate?: boolean;
  platformAdmin?: boolean;
}) {
  if (stores.length === 0) return <p className="text-sm text-muted">You do not have access to any store yet.</p>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {stores.map((store) => (
        <li key={store.slug} className="flex flex-col rounded-lg border border-border bg-background hover:border-foreground">
          <Link href={`/admin/${store.slug}`} className="block rounded-t-lg p-4">
            <span className="font-medium">{store.name}</span>
            <span className="block text-sm text-muted">
              {store.slug} · {store.role}
            </span>
          </Link>
          {canDuplicate && (store.role === "owner" || platformAdmin) && (
            <div className="border-t border-border px-4 py-2 text-sm">
              <Link href={copyWizardPath(store.slug)} className="underline underline-offset-2">
                Duplicate<span className="sr-only"> {store.name}</span>
              </Link>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
