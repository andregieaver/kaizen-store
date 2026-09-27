import { notFound } from "next/navigation";

import { audit, requireMember } from "@/server/auth";
import { dac7Csv, dac7Report } from "@/server/dac7";

/**
 * The year's DAC7 report as a spreadsheet file (D71): `sellers.csv` or
 * `properties.csv`. For owners only, as it holds hosts' tax numbers.
 */
export async function GET(_request: Request, { params }: RouteContext<"/admin/[store]/hosts/dac7/[year]/[part]">) {
  const { store: slug, year: yearText, part: file } = await params;
  const { store, role, account } = await requireMember(slug);
  const year = Number(yearText);
  const part = file === "sellers.csv" ? "sellers" : file === "properties.csv" ? "properties" : null;
  if (role !== "owner" || !part || !Number.isInteger(year) || year < 2023 || year > new Date().getUTCFullYear()) notFound();
  const report = await dac7Report(store.id, year, store.timeZone);
  await audit(account.id, store.id, "hosts.dac7_downloaded", { year, part });
  return new Response(dac7Csv(report, part), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="dac7-${store.slug}-${year}-${part}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
