import { todayIn } from "@/lib/analytics-period";
import { adminLangOf } from "@/lib/admin-lang";
import { amountCell, writeCsv } from "@/lib/csv";
import { lastDayOf } from "@/lib/year-end";
import { audit } from "@/server/auth";
import { openBookOf } from "@/server/ledger";
import { requirePermission } from "@/server/permissions";
import { yearEndView } from "@/server/year-end";

/**
 * A year's business specification (D506) as a spreadsheet, for a member who may read the store's settings (as the Books screen): the
 * profit and loss and the balance on the year's last day by the codes of Skatteetaten's *næringsspesifikasjon*, in the Nordic dialect
 * spreadsheets open as written; never cached, audited. A year the book does not hold, or a store without books, is a 404.
 */
export async function GET(_request: Request, { params }: RouteContext<"/admin/[store]/settings/books/naering/[year]">) {
  const { store: slug, year: raw } = await params;
  const member = await requirePermission(slug, "settings:read");
  const book = await openBookOf(member.store.id);
  const year = Number(raw);
  if (!book || !/^\d{4}$/.test(raw) || lastDayOf(year) < book.openedOn) return new Response("Not found", { status: 404 });
  const today = todayIn(new Date(), member.store.timeZone);
  const view = await yearEndView(member.store.id, book, year, today);
  const nb = adminLangOf(member.account.adminLocale) === "nb";
  const money = (minor: number) => amountCell(minor, book.currency);
  const rows = [
    [nb ? "Del" : "Part", nb ? "Kode" : "Code", nb ? "Post" : "Item", nb ? "Kategori" : "Category", `${nb ? "Beløp" : "Amount"} (${book.currency})`],
    ...view.spec.result.map((l) => [nb ? "Resultatregnskap" : "Profit and loss", l.code, nb ? l.nb : l.en, l.category, money(l.amount)]),
    [nb ? "Resultatregnskap" : "Profit and loss", "", nb ? "Årsresultat" : "Result for the year", "", money(view.spec.resultTotal)],
    ...view.spec.balance.map((l) => [nb ? `Balanse ${lastDayOf(year)}` : `Balance ${lastDayOf(year)}`, l.code, nb ? l.nb : l.en, l.category, money(l.amount)]),
  ];
  await audit(member.account.id, member.store.id, "work.business_spec_downloaded", { bookId: book.id, year });
  return new Response(writeCsv(rows, "excel_nordic"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="naeringsspesifikasjon-${year}.csv"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
