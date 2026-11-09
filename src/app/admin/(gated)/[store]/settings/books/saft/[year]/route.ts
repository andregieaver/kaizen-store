import { todayIn } from "@/lib/analytics-period";
import { saftFileName } from "@/lib/saft";
import { openBookOf } from "@/server/ledger";
import { requirePermission } from "@/server/permissions";
import { saftFile } from "@/server/saft";

/** The moment as the file's name has it, `YYYYMMDDhhmmss`, in the store's time zone. */
const stampIn = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .format(at)
    .replace(/\D/g, "");

/**
 * A year of the store's books as Skatteetaten's SAF-T file (D497), for a member who may read the store's settings (as the Books screen):
 * downloaded, never cached, audited; a year the book does not hold, or a store without books, is a 404; without an organisation number,
 * or with an account no code fits, a 409.
 */
export async function GET(_request: Request, { params }: RouteContext<"/admin/[store]/settings/books/saft/[year]">) {
  const { store: slug, year } = await params;
  const member = await requirePermission(slug, "books:read");
  const book = await openBookOf(member.store.id);
  if (!book || !/^\d{4}$/.test(year)) return new Response("Not found", { status: 404 });
  const now = new Date();
  const made = await saftFile(member, book, Number(year), todayIn(now, member.store.timeZone));
  if (!made.ok) {
    if (made.problem === "year") return new Response("Not found", { status: 404 });
    return new Response(made.problem === "org_number" ? "No organisation number" : `No grouping code for account ${made.accounts?.join(", ")}`, { status: 409 });
  }
  return new Response(made.xml, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "content-disposition": `attachment; filename="${saftFileName(made.organisationNumber, stampIn(now, member.store.timeZone))}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
