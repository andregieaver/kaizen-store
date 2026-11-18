import { NextResponse, type NextRequest } from "next/server";

import { experimentsEn } from "@/lib/admin-messages/experiments.en";
import { writeCsv } from "@/lib/csv";
import { experimentCsvRows } from "@/lib/experiment-csv";
import { targetLabelText } from "@/lib/experiment-words";
import { sameSite } from "@/lib/same-site";
import { listedTests } from "@/server/experiment-list";
import { checkPermission } from "@/server/permissions";

/**
 * The store's A/B tests as a CSV (D148 phase 15, `src/lib/experiment-csv.ts`), from the list's own form: members who may read marketing, a
 * direct download written by the one CSV writer, never cached. A row per version; figures beyond the visitors only once a test has an answer.
 */
export async function POST(request: NextRequest, { params }: RouteContext<"/admin/[store]/experiments/export">) {
  const { store: slug } = await params;
  const member = await checkPermission(slug, "marketing:read", "ab_testing");
  if (!member) return new NextResponse("Not found", { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });
  const tests = await listedTests(member.store, { words: experimentsEn, numberLocale: "en-GB" });
  const csv = writeCsv(
    experimentCsvRows(
      tests.map((t) => ({
        name: t.name,
        status: t.status,
        goal: t.goal,
        target: targetLabelText(t.page.kind, t.page.slug, t.page.title, t.page.role) + (t.part ? ` (${t.part.label})` : ""),
        startedAt: t.startedAt,
        stoppedAt: t.stoppedAt,
        appliedVariant: t.appliedVariant,
        learning: t.learning,
        variants: t.variants,
        card: t.card,
        figures: t.figures,
      })),
    ),
  );
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ab-tests-${member.store.slug}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
