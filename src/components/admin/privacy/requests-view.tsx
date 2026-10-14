import Link from "next/link";

import { PRIVACY_KIND_LABELS, PRIVACY_STATUS_LABELS } from "@/lib/privacy-request";
import { STAFF_TEXT } from "@/lib/privacy-text";
import type { RequestView } from "@/server/privacy-requests";
import { Chip, List, ListRow, PageHeader, RowFact, RowLead } from "@/components/admin/ui";

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
        <PageHeader
          title="Privacy requests"
          description={<>People may ask what the store holds about them, or ask for it to be erased. Log a request when it arrives, and answer it within one month. This is not legal advice.</>}
        />
        {canWrite && (
          <Link href={`${base}/privacy/new`} className={buttonPrimary}>
            Log a request
          </Link>
        )}
      </div>

      {overdue > 0 && (
        <p role="alert" className="rounded-md border border-danger-text bg-card p-3 text-sm">
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
            className={`rounded-md border px-3 py-1.5 ${filter === key ? "border-brand font-medium" : "border-line"}`}
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
          <List label="Privacy requests">
            {shown.map((r) => (
              <ListRow key={r.id}>
                <RowLead
                  title={PRIVACY_KIND_LABELS[r.kind]}
                  href={`${base}/privacy/${r.id}`}
                  sub={
                    <>
                      <span className="break-all">{person(r)}</span> · {r.channel === "shopper" ? "Asked on the site" : "Logged by staff"} · received{" "}
                      {dayText(r.receivedAt, timeZone)}
                    </>
                  }
                />
                {r.status === "open" ? (
                  <RowFact
                    sub={<span className={r.overdue ? `font-medium ${alertText}` : undefined}>{clockWords(r.daysLeft, r.overdue)}</span>}
                  >
                    Due {dayText(r.extendedUntil ?? r.dueAt, timeZone)}
                    {r.extendedUntil && " (extended)"}
                  </RowFact>
                ) : (
                  <RowFact>Answered {dayText(r.completedAt, timeZone)}</RowFact>
                )}
                <Chip signal={r.status === "open" ? (r.overdue ? "danger" : "warning") : r.status === "done" ? "positive" : "neutral"} dot>
                  {PRIVACY_STATUS_LABELS[r.status]}
                </Chip>
              </ListRow>
            ))}
          </List>
        )}
      </section>
      <p className="max-w-2xl text-sm text-muted">{STAFF_TEXT.clock}</p>
    </div>
  );
}
