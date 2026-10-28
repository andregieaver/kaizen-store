import { Button, ButtonLink, Card, Chip, List, ListRow, RowAmount, RowFact, RowLead } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import type { MarketingMessages } from "@/lib/admin-messages/marketing.en";
import { SEGMENT_SAMPLE, type Person } from "@/lib/segments";

export type SegmentPeopleProps = {
  /** The people of the page shown, by last order. */
  people: readonly Person[];
  total: number;
  page: number;
  pages: number;
  /** The address of a page of the list (from 0). */
  pageHref: (page: number) => string;
  /** The CSV's form (the owner's only, D380): the route and the field naming what to export; null hides the button. */
  csv: { action: string; field: "segment" | "rfm"; value: string } | null;
  date: (iso: string) => string;
  count: (n: number) => string;
  /** Money spent without VAT in the main currency; a person with an amount in a currency with no rate shows none, never 0. */
  money: (minor: number) => string;
  words: MarketingMessages["segments"];
};

/**
 * Who is in a segment, a page at a time (D380): name or address, orders and last order, money spent, and whether they want the store's emails, with the
 * owner's CSV of everyone in it. Shown only to staff who may read customers; the page decides.
 */
export function SegmentPeople({ people, total, page, pages, pageHref, csv, date, count, money, words: w }: SegmentPeopleProps) {
  const from = page * SEGMENT_SAMPLE + 1;
  const to = page * SEGMENT_SAMPLE + people.length;
  return (
    <Card
      title={w.whoIsIn}
      description={total > people.length ? fillWords(w.pageOf, { from: count(from), to: count(to), total: count(total) }) : undefined}
      aside={
        csv && total > 0 ? (
          <form action={csv.action} method="post">
            <input type="hidden" name={csv.field} value={csv.value} />
            <Button type="submit">{w.downloadCsv}</Button>
          </form>
        ) : undefined
      }
      compact
    >
      {people.length === 0 ? (
        <p className="text-body text-muted">{w.nobody}</p>
      ) : (
        <List label={w.peopleList}>
          {people.map((p) => (
            <ListRow key={p.email}>
              <RowLead title={<span className="block max-w-80 truncate">{p.name || p.email}</span>} sub={p.name ? p.email : undefined} />
              <RowFact className="hidden sm:block" sub={p.lastOrderAt ? fillWords(w.lastOrder, { date: date(p.lastOrderAt) }) : w.noOrder}>
                {countWords(p.orders, w.orders)}
              </RowFact>
              <RowAmount>{p.spentMinor === null ? "–" : money(p.spentMinor)}</RowAmount>
              {p.consent === "subscribed" && (
                <Chip signal="positive" dot>
                  {w.wantsYourEmails}
                </Chip>
              )}
            </ListRow>
          ))}
        </List>
      )}
      {pages > 1 && (
        <nav aria-label={w.pagesLabel} className="mt-4 flex flex-wrap items-center gap-2">
          {page > 0 && <ButtonLink href={pageHref(page - 1)}>{w.previous}</ButtonLink>}
          {page < pages - 1 && <ButtonLink href={pageHref(page + 1)}>{w.next}</ButtonLink>}
        </nav>
      )}
    </Card>
  );
}
