import Link from "next/link";

import type { WorkStore } from "@/lib/work-owner";
import { WORK_ROOT } from "@/lib/work-paths";

import { control } from "./work-parts";

/**
 * The pieces every combined Work page (D123) shares: the store choice of a list's filter form, and a store's name
 * as a link to its own Work. Server components, so the filter forms work without scripts.
 */

/** "All stores" or one of the account's stores, in a filter form (`?store=slug`). Nothing with one store. */
export function StoreFilter({ stores, value }: { stores: Pick<WorkStore, "slug" | "name">[]; value: string }) {
  if (stores.length < 2) return null;
  return (
    <label className="flex min-w-40 flex-col gap-1 text-sm font-medium">
      Store
      <select name="store" defaultValue={value} className={`${control} font-normal`}>
        <option value="">All stores</option>
        {stores.map((store) => (
          <option key={store.slug} value={store.slug}>
            {store.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A small note of which store a row belongs to, shown only where there is more than one to tell apart. */
export function StoreTag({ name, show }: { name: string; show: boolean }) {
  if (!show) return null;
  return <span className="text-xs text-muted">{name}</span>;
}

/** Where amounts of different currencies are shown apart, said once. */
export function CurrencyNote() {
  return (
    <p className="text-xs text-muted">
      Each store keeps its own money in its own currency. Amounts in different currencies are shown apart and never
      added together.
    </p>
  );
}

/** A link to the settings page, where Work is switched on for a store. */
export function SettingsLink({ children = "Work settings" }: { children?: string }) {
  return (
    <Link href={`${WORK_ROOT}/settings`} className="underline">
      {children}
    </Link>
  );
}
