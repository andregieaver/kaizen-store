import Link from "next/link";

import type { WorkStore } from "@/lib/work-owner";
import { WORK_ROOT, workBase } from "@/lib/work-paths";
import { formatDuration } from "@/lib/work-time";
import { clientFigures, type ClientShow } from "@/lib/work-ui";
import type { OwnerClient } from "@/server/work-owner";

import { StoreFilter } from "./owner-common";
import { NewInStoreButton } from "./owner-parts";
import { Badge, card, control, secondaryButton } from "./work-parts";

const th = "px-4 py-2 text-left text-xs font-medium tracking-wide text-muted uppercase";

const SHOW_LABELS: Record<ClientShow, string> = {
  active: "Active clients",
  archived: "Archived clients",
  all: "All clients",
};

/**
 * The clients of all the account's stores in one list (D123): a search, the active, archived or all choice and a
 * store filter, all in the address (a plain form). Each row says which store the client belongs to and leads to the
 * client in that store's own Work, where it is edited. "New client" first asks which store.
 */
export function OwnerClientsList({
  stores,
  clients,
  query,
  show,
  storeSlug,
  defaultStore,
  truncated,
}: {
  stores: WorkStore[];
  clients: OwnerClient[];
  query: string;
  show: ClientShow;
  /** The store the list is narrowed to (`?store=`), or empty. */
  storeSlug: string;
  /** The store "New client" starts on. */
  defaultStore: string;
  truncated: boolean;
}) {
  const filtered = query !== "" || show !== "active" || storeSlug !== "";
  const many = stores.length > 1;
  const base = `${WORK_ROOT}/clients`;
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Clients</h1>
          <p className="text-sm text-muted">
            The people and companies you bill{many ? ", across all your stores" : ""}.
          </p>
        </div>
        <NewInStoreButton
          kind="client"
          stores={stores.map(({ slug, name }) => ({ slug, name }))}
          defaultSlug={defaultStore}
        />
      </div>

      <form method="get" role="search" aria-label="Find a client" className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm font-medium">
          Search
          <input
            type="search"
            name="q"
            defaultValue={query}
            maxLength={100}
            placeholder="Name, contact or email"
            className={control}
            autoComplete="off"
          />
        </label>
        <StoreFilter stores={stores} value={storeSlug} />
        <label className="flex flex-col gap-1 text-sm font-medium">
          Show
          <select name="show" defaultValue={show} className={control}>
            {(Object.keys(SHOW_LABELS) as ClientShow[]).map((value) => (
              <option key={value} value={value}>
                {SHOW_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={secondaryButton}>
          Search
        </button>
        {filtered && (
          <Link href={base} className="min-h-10 content-center text-sm underline">
            Clear
          </Link>
        )}
      </form>

      {truncated && (
        <p role="status" className="text-sm text-muted">
          There are more clients than can be listed here. Search or choose a store to narrow them down.
        </p>
      )}

      {clients.length === 0 ? (
        <p className={`${card} text-sm text-muted`}>
          {filtered
            ? "No client matches. Try another search, or show all clients."
            : "You have no clients yet. Add one, then log the hours you work for them."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-background">
          <table className="w-full text-sm">
            <caption className="sr-only">{SHOW_LABELS[show]}</caption>
            <thead>
              <tr>
                <th scope="col" className={th}>
                  Client
                </th>
                {many && (
                  <th scope="col" className={th}>
                    Store
                  </th>
                )}
                <th scope="col" className={`${th} text-right`}>
                  Active assignments
                </th>
                <th scope="col" className={`${th} text-right`}>
                  Logged
                </th>
                <th scope="col" className={`${th} text-right`}>
                  Not invoiced
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {clients.map((client) => (
                <tr key={`${client.storeId}:${client.id}`}>
                  <th scope="row" className="min-w-48 px-4 py-3 text-left font-normal">
                    <Link href={`${workBase(client.storeSlug)}/clients/${client.id}`} className="font-medium underline">
                      {client.name}
                    </Link>
                    {client.archivedAt && (
                      <>
                        {" "}
                        <Badge>Archived</Badge>
                      </>
                    )}
                    <span className="block text-xs text-muted">
                      {[client.contactName, client.billingEmail].filter(Boolean).join(" · ") || clientFigures(client)}
                    </span>
                  </th>
                  {many && (
                    <td className="px-4 py-3">
                      <Link href={workBase(client.storeSlug)} className="underline">
                        {client.storeName}
                      </Link>
                      <span className="block text-xs text-muted">{client.currency}</span>
                    </td>
                  )}
                  <td className="px-4 py-3 text-right tabular-nums">{client.activeAssignments}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatDuration(client.loggedMinutes)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {client.unbilledMinutes > 0 ? (
                      formatDuration(client.unbilledMinutes)
                    ) : (
                      <span className="text-muted">None</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
