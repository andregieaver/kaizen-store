import "server-only";

import { NextResponse } from "next/server";

import type { Membership } from "./auth";
import { downloadPart, jobFor, requestCustomerExport, requestInventoryExport, requestOrderExport, requestProductExport, requestRedirectExport, tickJob, type ExportRequest } from "./data-jobs";
import { isJobId } from "./data-job-store";

/**
 * What the export routes share (D165, `docs/wave-2-data.md` 5.2): the response of a POST from an export page, and the step an open job page asks for.
 * The route files do the guard themselves (`checkPermission(slug, "<key>")` with a literal key, which `permissions.scan.test.ts` holds) and the
 * same-site check; these take the membership that passed. A refusal goes back to the page with a CODE the page turns into a fixed sentence, never
 * text from the address.
 */

export type ExportPage = "products" | "orders" | "customers" | "redirects" | "inventory";

const request = { products: requestProductExport, orders: requestOrderExport, customers: requestCustomerExport, redirects: requestRedirectExport, inventory: requestInventoryExport } as const;

const safeFilename = (name: string): string => name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "export.csv";

/** The back address of an export page, with a code and no other text. */
export const exportPageHref = (slug: string, page: ExportPage, query: Record<string, string> = {}): string => {
  const q = new URLSearchParams(query).toString();
  return `/admin/${slug}/${page}/export${q ? `?${q}` : ""}`;
};

const form = async (req: Request): Promise<Record<string, string>> => {
  const data = await req.formData().catch(() => null);
  const out: Record<string, string> = {};
  if (data) for (const [key, value] of data.entries()) if (typeof value === "string") out[key] = value;
  return out;
};

/**
 * An export page's POST: `intent=download` with `job` and `part` gives the signed address of a done job's file (logged first); anything else asks for
 * an export with the page's options: a file at once, or a job (303 to the page, which shows it). Never cached.
 */
export async function exportResponse(req: Request, member: Membership, slug: string, page: ExportPage): Promise<NextResponse> {
  const fields = await form(req);
  const back = (query: Record<string, string>) => NextResponse.redirect(new URL(exportPageHref(slug, page, query), req.url), 303);
  if (fields.intent === "download") {
    const part = Number.parseInt(fields.part ?? "0", 10);
    if (!isJobId(fields.job) || !Number.isInteger(part) || part < 0) return new NextResponse("Not found", { status: 404 });
    const got = await downloadPart(member, fields.job, part);
    if (!got.ok) return new NextResponse("Not found", { status: 404 });
    return NextResponse.redirect(got.url, 303);
  }
  let result: ExportRequest;
  try {
    result = await request[page](member, fields);
  } catch (error) {
    console.error("data_export.failed", page, error instanceof Error ? error.message : error);
    return back({ problem: "failed" });
  }
  if (!result.ok) return result.code === "forbidden" ? new NextResponse("Not found", { status: 404 }) : back({ problem: result.code });
  if (result.mode === "job") return back({ job: result.jobId });
  return new NextResponse(result.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeFilename(result.filename)}"`,
      "Cache-Control": "no-store",
      ...(result.unknownNumbers.length > 0 ? { "X-Kaizen-Unknown-Numbers": String(result.unknownNumbers.length) } : {}),
    },
  });
}

/** What a job page may show of a job: its state, never a path, an input name's folder or anything of a person. */
export type JobState = {
  id: string;
  kind: string;
  status: string;
  phase: string | null;
  rowsDone: number | null;
  rowsTotal: number | null;
  counts: Record<string, unknown>;
  files: { index: number; name: string; rows: number; bytes: number }[];
  problem: string | null;
  expiresAt: string | null;
  finishedAt: string | null;
};

/** The step an open page asks for: runs the job once and answers with its state, a 404 for a job the member may not see. */
export async function tickResponse(member: Membership, jobId: string, kinds: readonly string[]): Promise<NextResponse> {
  if (!isJobId(jobId)) return new NextResponse("Not found", { status: 404 });
  // A page ticks only the kind of job it is for: an import's page never runs an export of the same store.
  const seen = await jobFor(member, jobId);
  if (!seen || !kinds.includes(seen.kind)) return new NextResponse("Not found", { status: 404 });
  const job = await tickJob(member, jobId);
  if (!job) return new NextResponse("Not found", { status: 404 });
  const state: JobState = {
    id: job.id,
    kind: job.kind,
    status: job.status,
    phase: job.phase,
    rowsDone: job.rowsDone,
    rowsTotal: job.rowsTotal,
    counts: job.counts,
    files: job.files.map((f, index) => ({ index, name: f.name, rows: f.rows, bytes: f.bytes })),
    problem: job.problem,
    expiresAt: job.expiresAt,
    finishedAt: job.finishedAt,
  };
  return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
}
