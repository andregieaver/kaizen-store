import Link from "next/link";

import { formatDuration } from "@/lib/work-time";
import { clientFigures, type ClientShow } from "@/lib/work-ui";
import type { WorkClientItem } from "@/server/work";

import { Badge, card, control, secondaryButton } from "./work-parts";
import { Card, List, ListRow, RowAmount, RowFact, RowLead } from "@/components/admin/ui";
import { workText } from "@/lib/work-text";



/**
 * The store's clients with what is going on for each: active assignments, time
 * logged and time not yet on an invoice. A search and the active, archived or all
 * choice are in the address (a plain form, so it works without scripts). The
 * table scrolls sideways on a phone.
 */
export function ClientsList({
  base,
  clients,
  query,
  show,
}: {
  /** `workBase(store)`. */
  base: string;
  clients: WorkClientItem[];
  query: string;
  show: ClientShow;
}) {
  const tw = workText().clientsList;
  const filtered = query !== "" || show !== "active";
  return (
    <div className="flex flex-col gap-4">
      <form method="get" role="search" aria-label={tw.findAClient} className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm font-medium">
          {tw.search}
          <input
            type="search"
            name="q"
            defaultValue={query}
            maxLength={100}
            placeholder={tw.nameContactOrEmail}
            className={control}
            autoComplete="off"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {tw.show}
          <select name="show" defaultValue={show} className={control}>
            {(Object.keys(tw.showLabels) as ClientShow[]).map((value) => (
              <option key={value} value={value}>
                {tw.showLabels[value]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={secondaryButton}>
          {tw.search}
        </button>
        {filtered && (
          <Link href={`${base}/clients`} className="min-h-10 content-center text-sm underline">
            {tw.clear}
          </Link>
        )}
      </form>

      {clients.length === 0 ? (
        <p className={`${card} text-sm text-muted`}>
          {filtered
            ? tw.noClientMatchesTry
            : tw.youHaveNoClients}
        </p>
      ) : (
        <Card compact>
          <List label={tw.showLabels[show]}>
            {clients.map((client) => (
              <ListRow key={client.id}>
                <RowLead
                  title={client.name}
                  href={`${base}/clients/${client.id}`}
                  sub={
                    <>
                      {[client.contactName, client.billingEmail].filter(Boolean).join(" · ") || clientFigures(client, workText().labels.clientFigures)}
                    </>
                  }
                />
                {client.archivedAt && <Badge>{tw.archived}</Badge>}
                <RowFact className="hidden sm:block">
                  {client.activeAssignments === 1 ? "1 active assignment" : `${client.activeAssignments} active assignments`}
                </RowFact>
                <RowFact className="hidden sm:block">{formatDuration(client.loggedMinutes)} logged</RowFact>
                <RowAmount>
                  {client.unbilledMinutes > 0 ? `${formatDuration(client.unbilledMinutes)} not invoiced` : <span className="text-muted">{tw.allInvoiced}</span>}
                </RowAmount>
              </ListRow>
            ))}
          </List>
        </Card>
      )}
    </div>
  );
}
