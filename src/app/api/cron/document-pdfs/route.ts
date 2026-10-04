import { connection } from "next/server";

import { cronAuthorised } from "@/server/cron-auth";
import { pdfJob } from "@/server/invoice-pdf";

/** Up to ten PDFs are made in one run, each in a Chromium that takes a while to start on a cold function. */
export const maxDuration = 120;

/**
 * Makes the PDFs of invoices and credit notes that have none yet (D159, `docs/wave-1b-invoices.md` 4.9, 5.2), oldest first, up to ten a run,
 * leaving out a document that failed five times (its Waiting tab has a *Try again* button) and one that failed in the last five minutes.
 * Schedule it where the five-minute job is scheduled (`/api/cron/cart-reminders`); nothing breaks without it, since a PDF is also made on
 * the first download. Its own route so that Chromium stays out of the others (`outputFileTracingIncludes` in `next.config.ts`).
 */
async function run(request: Request) {
  await connection();
  if (!(await cronAuthorised(request))) return new Response("Unauthorized", { status: 401 });
  const pdfs = await pdfJob();
  return Response.json({ pdfs }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = run;
export const POST = run;
