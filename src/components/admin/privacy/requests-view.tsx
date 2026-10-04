import Link from "next/link";

import { PRIVACY_KIND_LABELS, PRIVACY_STATUS_LABELS } from "@/lib/privacy-request";
import { STAFF_TEXT } from "@/lib/privacy-text";
import type { RequestView } from "@/server/privacy-requests";

import { alertText, buttonPrimary, card, clockWords, dayText } from "./styles";

export type RequestsFilter = "open" | "answered" | "all";

export const FILTER_LABELS: Record<RequestsFilter, string> = { open: "Open", answered: "Answered", all: "All" };

/** The `?status=` of the list, read safely: anything else is the open list. */
export function requestsFilter(value: string | undefined): RequestsFilter {
  return value === "answered" || value === "all" ? value : "open";
}

/** The person's email as the log shows it: the address, or the word for one that was erased. */
const person = (r: RequestView): string => r.subjectEmail ?? (r.outcome === "erased" ? "Erased" : "No address");

/**
 * The log of privacy requests (wave 1, 1g, D162, `docs/wave-1g-gdpr.md` 2.3 item 4): what is open with its days left (red and in words
 * when past), then what was answered. Anyone who may read customers can read it; logging one is for those who may change customers.
 */
export function RequestsView({
  base,
  requests,
  filter,
  canWrite,
  timeZone,
}: {
  /** `/admin/{store}` */
  base: string;
  requests: RequestView[];
  filter: RequestsFilter;
  canWrite: boolean;
  timeZone?: string;
}) {
  const open = requests.filter((r) => r.status === "open");
  const overdue = open.filter((r) => r.overdue).length;
  const shown = requests.filter((r) => (filter === "open" ? r.status === "open" : filter === "answered" ? r.status !== "open" : true));
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Privacy requests</h1>
          <p className="max-w-2xl text-sm text-muted">
            People may ask what the store holds about them, or ask for it to be erased. Log a request when it arrives, and answer it within one month. This is not legal advice.
          </p>
        </div>
        {canWrite && (
          <Link href={`${base}/privacy/new`} className={buttonPrimary}>
            Log a request
          </Link>
        )}
      </div>

      {overdue > 0 && (
        <p role="alert" className="rounded-md border border-red-700 bg-background p-3 text-sm dark:border-red-400">
          <span className={`font-medium ${alertText}`}>
            {overdue === 1 ? "1 request is" : `${overdue} requests are`} past its day.
          </span>{" "}
          The law asks for an answer within one month.
        </p>
      )}

      <nav aria-label="Filter requests" className="flex flex-wrap gap-2 text-sm">
        {(Object.keys(FILTER_LABELS) as RequestsFilter[]).map((key) => (
          <Link
            key={key}
            href={key === "open" ? `${base}/privacy` : `${base}/privacy?status=${key}`}
            aria-current={filter === key ? "page" : undefined}
            className={`rounded-md border px-3 py-1.5 ${filter === key ? "border-foreground font-medium" : "border-border"}`}
          >
            {FILTER_LABELS[key]}
          </Link>
        ))}
      </nav>

      <section aria-labelledby="request-list" className={card}>
        <h2 id="request-list" className="sr-only">
          {FILTER_LABELS[filter]} requests
        </h2>
        {shown.length === 0 ? (
          <p className="text-sm text-muted">{filter === "open" ? "No request is open." : "Nothing here yet."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">Privacy requests</caption>
              <thead className="text-muted">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">Request</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Person</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Received</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Due</th>
                  <th scope="col" className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="border-t border-border align-top">
                    <td className="py-2 pr-3">
                      <Link href={`${base}/privacy/${r.id}`} className="font-medium underline">
                        {PRIVACY_KIND_LABELS[r.kind]}
                      </Link>
                      <span className="block text-xs text-muted">{r.channel === "shopper" ? "Asked on the site" : "Logged by staff"}</span>
                    </td>
                    <td className="py-2 pr-3 break-all">{person(r)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{dayText(r.receivedAt, timeZone)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {r.status === "open" ? (
                        <>
                          {dayText(r.extendedUntil ?? r.dueAt, timeZone)}
                          <span className={`block text-xs ${r.overdue ? `font-medium ${alertText}` : "text-muted"}`}>{clockWords(r.daysLeft, r.overdue)}</span>
                        </>
                      ) : (
                        <span className="text-muted">Answered {dayText(r.completedAt, timeZone)}</span>
                      )}
                    </td>
                    <td className="py-2">
                      {PRIVACY_STATUS_LABELS[r.status]}
                      {r.extendedUntil && r.status === "open" && <span className="block text-xs text-muted">Extended</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="max-w-2xl text-sm text-muted">{STAFF_TEXT.clock}</p>
    </div>
  );
}
