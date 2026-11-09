import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { Card, PageHeader } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { clientNeeds, type ClientNeed } from "@/lib/books-clients";
import { formatMoney } from "@/lib/money";
import { storeHref } from "@/lib/paths";
import { requireAccount } from "@/server/auth";
import { booksClients } from "@/server/books-clients";

export const metadata: Metadata = { title: "Books" };

/**
 * An accountant's clients (B6, D512): every store whose books the person keeps or reads, each with what its books need now (the VAT term
 * to report and when it is due, supplier invoices due, the bank's lines and documents waiting, the inbox) and how far they are locked, the
 * most pressing first; each opens the store's Books. Counts only.
 */
export default async function AccountBooksPage() {
  await connection();
  const account = await requireAccount();
  const lang = adminLangOf(account.adminLocale);
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const w = adminText(lang, "books").clients;
  const clients = await booksClients(account);
  const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale, { dateStyle: "medium", timeZone: "UTC" });
  const needText = (need: ClientNeed, currency: string, vat: number | null): string => {
    if (need.kind === "open_books") return w.notOpen;
    if (need.kind === "vat") {
      const term = need.term.size === "year" ? String(need.term.year) : `${need.term.term}/${need.term.year}`;
      return fillWords(need.late ? w.vatLate : w.vat, { term, due: day(need.term.due), amount: formatMoney(vat ?? 0, currency, locale) });
    }
    return countWords(need.count, w[need.kind]);
  };
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={w.title} description={w.description} />
      {clients.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">{w.none}</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-4">
          {clients.map((c) => {
            const needs = clientNeeds(c, c.today);
            return (
              <li key={c.slug}>
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex min-w-0 flex-col gap-1">
                      <h2 className="text-body-strong text-ink [overflow-wrap:anywhere]">
                        {c.name}
                        {(c.owner || !c.keeps) && <span className="text-sm font-normal text-muted"> · {c.owner ? w.yours : w.reads}</span>}
                      </h2>
                      {c.book && (
                        <p className="text-sm text-muted">
                          {c.book.lockedThrough ? fillWords(c.book.lockHeld ? w.lockedHeld : w.locked, { day: day(c.book.lockedThrough) }) : w.notLocked}
                        </p>
                      )}
                    </div>
                    <Link href={storeHref(c.slug, "/settings/books")} className="inline-flex min-h-10 items-center rounded-pill border border-edge bg-card px-4 text-sm hover:bg-sunken">
                      {w.open}
                    </Link>
                  </div>
                  {needs.length === 0 ? (
                    <p className="mt-3 text-sm text-ink-2">{w.nothing}</p>
                  ) : (
                    <ul className="mt-3 flex flex-col gap-1 text-sm">
                      {needs.map((need, i) => (
                        <li key={i} className={need.kind === "vat" && need.late ? "text-danger-text" : "text-ink"}>
                          {needText(need, c.book?.currency ?? "NOK", c.vatTotalMinor)}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
