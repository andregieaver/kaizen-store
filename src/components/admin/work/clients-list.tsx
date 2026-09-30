import Link from "next/link";

import { formatDuration } from "@/lib/work-time";
import { clientFigures, type ClientShow } from "@/lib/work-ui";
import type { WorkClientItem } from "@/server/work";

import { Badge, card, control, secondaryButton } from "./work-parts";

const th = "px-4 py-2 text-left text-xs font-medium tracking-wide text-muted uppercase";

const SHOW_LABELS: Record<ClientShow, string> = {
  active: "Active clients",
  archived: "Archived clients",
  all: "All clients",
};

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
  const filtered = query !== "" || show !== "active";
  return (
    <div className="flex flex-col gap-4">
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
          <Link href={`${base}/clients`} className="min-h-10 content-center text-sm underline">
            Clear
          </Link>
        )}
      </form>

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
                <tr key={client.id}>
                  <th scope="row" className="min-w-48 px-4 py-3 text-left font-normal">
                    <Link href={`${base}/clients/${client.id}`} className="font-medium underline">
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
