import Link from "next/link";

import type { WorkStore } from "@/lib/work-owner";
import { WORK_ROOT } from "@/lib/work-paths";

import { control } from "./work-parts";
import { workText } from "@/lib/work-text";

/**
 * The pieces every combined Work page (D123) shares: the store choice of a list's filter form, and a store's name
 * as a link to its own Work. Server components, so the filter forms work without scripts.
 */

/** "All stores" or one of the account's stores, in a filter form (`?store=slug`). Nothing with one store. */
export function StoreFilter({ stores, value }: { stores: Pick<WorkStore, "slug" | "name">[]; value: string }) {
  const tw = workText().ownerCommon;
  if (stores.length < 2) return null;
  return (
    <label className="flex min-w-40 flex-col gap-1 text-sm font-medium">
      {tw.store}
      <select name="store" defaultValue={value} className={`${control} font-normal`}>
        <option value="">{tw.allStores}</option>
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
  const tw = workText().ownerCommon;
  return (
    <p className="text-xs text-muted">
      {tw.eachStoreKeepsIts}
    </p>
  );
}

/** A link to the settings page, where Work is switched on for a store. */
export function SettingsLink({ children }: { children?: string }) {
  const tw = workText().ownerCommon;
  return (
    <Link href={`${WORK_ROOT}/settings`} className="underline">
      {children ?? tw.workSettingsLink}
    </Link>
  );
}
