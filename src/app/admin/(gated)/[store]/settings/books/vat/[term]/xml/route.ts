import { todayIn } from "@/lib/analytics-period";
import { vatTermOfKey } from "@/lib/vat-return";
import { openBookOf } from "@/server/ledger";
import { requirePermission } from "@/server/permissions";
import { ourVatReturn, vatReturnOrgNumber, vatReturnXml } from "@/server/vat-return";

/**
 * A term's VAT return as Skatteetaten's XML (D496), for a member who may read the store's settings (as the Books screen): downloaded,
 * never cached; a term the book does not hold, or a store without books, is a 404; without an organisation number, a 409.
 */
export async function GET(_request: Request, { params }: RouteContext<"/admin/[store]/settings/books/vat/[term]/xml">) {
  const { store: slug, term: key } = await params;
  const { store } = await requirePermission(slug, "settings:read");
  const book = await openBookOf(store.id);
  if (!book) return new Response("Not found", { status: 404 });
  const term = vatTermOfKey(book.vatTerm, key);
  if (!term || term.to < book.openedOn || term.from > todayIn(new Date(), store.timeZone)) return new Response("Not found", { status: 404 });
  const organisationNumber = await vatReturnOrgNumber(book, store.id);
  if (!organisationNumber) return new Response("No organisation number", { status: 409 });
  const ours = await ourVatReturn(book, term);
  const name = `mva-melding-${term.year}-${term.size === "year" ? "aarlig" : term.term}.xml`;
  return new Response(vatReturnXml(organisationNumber, ours, store.id), {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
