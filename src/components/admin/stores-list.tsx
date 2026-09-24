import Link from "next/link";

import type { StoreSummary } from "@/server/auth";

/** The stores an account works in, as cards. */
export function StoresList({ stores }: { stores: StoreSummary[] }) {
  if (stores.length === 0) return <p className="text-sm text-muted">You do not have access to any store yet.</p>;
  return (
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
  );
}
