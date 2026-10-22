import Link from "next/link";

import { countWords, fillWords } from "@/lib/admin-fill";
import { privacyEn, type PrivacyMessages } from "@/lib/admin-messages/privacy.en";
import type { RequestView } from "@/server/privacy-requests";
import { Chip, List, ListRow, PageHeader, RowFact, RowLead } from "@/components/admin/ui";

import { alertText, buttonPrimary, card, clockWords, dayText } from "./styles";

export type RequestsFilter = "open" | "answered" | "all";

const FILTERS: RequestsFilter[] = ["open", "answered", "all"];

/** The `?status=` of the list, read safely: anything else is the open list. */
export function requestsFilter(value: string | undefined): RequestsFilter {
  return value === "answered" || value === "all" ? value : "open";
}

/** The person's email as the log shows it: the address, or the word for one that was erased. */
const person = (r: RequestView, w: PrivacyMessages["list"]): string => r.subjectEmail ?? (r.outcome === "erased" ? w.erased : w.noAddress);

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
  words = privacyEn,
  locale = "en-GB",
}: {
  /** `/admin/{store}` */
  base: string;
  requests: RequestView[];
  filter: RequestsFilter;
  canWrite: boolean;
  timeZone?: string;
  /** The privacy screens' words in the admin's language, and its date locale. */
  words?: PrivacyMessages;
  locale?: string;
}) {
  const w = words.list;
  const c = words.common;
  const day = (value: Date | string | null | undefined) => dayText(value, timeZone, locale);
  const open = requests.filter((r) => r.status === "open");
  const overdue = open.filter((r) => r.overdue).length;
  const shown = requests.filter((r) => (filter === "open" ? r.status === "open" : filter === "answered" ? r.status !== "open" : true));
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader title={c.privacyRequests} description={<>{w.description}</>} />
        {canWrite && (
          <Link href={`${base}/privacy/new`} className={buttonPrimary}>
            {w.logRequest}
          </Link>
        )}
      </div>

      {overdue > 0 && (
        <p role="alert" className="rounded-md border border-danger-text bg-card p-3 text-sm">
          <span className={`font-medium ${alertText}`}>{countWords(overdue, w.overdue)}</span> {w.lawAsks}
        </p>
      )}

      <nav aria-label={w.filterLabel} className="flex flex-wrap gap-2 text-sm">
        {FILTERS.map((key) => (
          <Link
            key={key}
            href={key === "open" ? `${base}/privacy` : `${base}/privacy?status=${key}`}
            aria-current={filter === key ? "page" : undefined}
            className={`rounded-pill border px-3 py-1.5 ${filter === key ? "border-brand font-medium" : "border-line"}`}
          >
            {w.filters[key]}
          </Link>
        ))}
      </nav>

      <section aria-labelledby="request-list" className={card}>
        <h2 id="request-list" className="sr-only">
          {fillWords(w.filterHeading, { filter: w.filters[filter] })}
        </h2>
        {shown.length === 0 ? (
          <p className="text-sm text-muted">{filter === "open" ? w.noneOpen : w.nothingYet}</p>
        ) : (
          <List label={c.privacyRequests}>
            {shown.map((r) => (
              <ListRow key={r.id}>
                <RowLead
                  title={c.kinds[r.kind]}
                  href={`${base}/privacy/${r.id}`}
                  sub={
                    <>
                      <span className="break-all">{person(r, w)}</span> · {r.channel === "shopper" ? w.askedOnSite : w.loggedByStaff} ·{" "}
                      {fillWords(w.received, { date: day(r.receivedAt) })}
                    </>
                  }
                />
                {r.status === "open" ? (
                  <RowFact sub={<span className={r.overdue ? `font-medium ${alertText}` : undefined}>{clockWords(r.daysLeft, r.overdue, c.clock)}</span>}>
                    {fillWords(w.due, { date: day(r.extendedUntil ?? r.dueAt) })}
                    {r.extendedUntil && w.extended}
                  </RowFact>
                ) : (
                  <RowFact>{fillWords(w.answered, { date: day(r.completedAt) })}</RowFact>
                )}
                <Chip signal={r.status === "open" ? (r.overdue ? "danger" : "warning") : r.status === "done" ? "positive" : "neutral"} dot>
                  {c.statuses[r.status]}
                </Chip>
              </ListRow>
            ))}
          </List>
        )}
      </section>
      <p className="max-w-2xl text-sm text-muted">{words.staff.clock}</p>
    </div>
  );
}
