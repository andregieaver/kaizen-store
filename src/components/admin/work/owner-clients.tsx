import Link from "next/link";

import type { WorkStore } from "@/lib/work-owner";
import { WORK_ROOT, workBase } from "@/lib/work-paths";
import { formatDuration } from "@/lib/work-time";
import { clientFigures, type ClientShow } from "@/lib/work-ui";
import type { OwnerClient } from "@/server/work-owner";
import { Card, List, ListRow, PageHeader, RowAmount, RowFact, RowLead } from "@/components/admin/ui";

import { StoreFilter } from "./owner-common";
import { NewInStoreButton } from "./owner-parts";
import { Badge, card, control, secondaryButton } from "./work-parts";


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
        <PageHeader title="Clients" description={<>The people and companies you bill{many ? ", across all your stores" : ""}.</>} />
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
        <Card compact>
          <List label={SHOW_LABELS[show]}>
            {clients.map((client) => (
              <ListRow key={`${client.storeId}:${client.id}`}>
                <RowLead
                  title={client.name}
                  href={`${workBase(client.storeSlug)}/clients/${client.id}`}
                  sub={
                    <>
                    {many && (
                      <>
                        <Link href={workBase(client.storeSlug)} className="underline-offset-2 hover:underline">
                          {client.storeName}
                        </Link>
                        {` (${client.currency}) · `}
                      </>
                    )}
                      {[client.contactName, client.billingEmail].filter(Boolean).join(" · ") || clientFigures(client)}
                    </>
                  }
                />
                {client.archivedAt && <Badge>Archived</Badge>}
                <RowFact className="hidden sm:block">
                  {client.activeAssignments === 1 ? "1 active assignment" : `${client.activeAssignments} active assignments`}
                </RowFact>
                <RowFact className="hidden sm:block">{formatDuration(client.loggedMinutes)} logged</RowFact>
                <RowAmount>
                  {client.unbilledMinutes > 0 ? `${formatDuration(client.unbilledMinutes)} not invoiced` : <span className="text-muted">All invoiced</span>}
                </RowAmount>
              </ListRow>
            ))}
          </List>
        </Card>
      )}
    </div>
  );
}
