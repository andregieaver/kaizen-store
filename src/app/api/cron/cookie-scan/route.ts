import { revalidateTag } from "next/cache";
import { after, connection } from "next/server";

import { runScan } from "@/server/cookie-scan-runner";
import { claimScan } from "@/server/cookie-scans";
import { cronAuthorised } from "@/server/cron-auth";
import { cookiesTag } from "@/server/site-cookies";

/** A scan opens up to twelve pages in Chromium, which takes a while to start on a cold function. */
export const maxDuration = 120;

/**
 * Every minute, from Supabase's scheduler: the next cookie scan (D58), one
 * an owner asked for or a site due its weekly scan. The answer goes back at
 * once and the scan runs after it, so the scheduler never waits on a browser.
 */
async function run(request: Request) {
  await connection();
  if (!(await cronAuthorised(request))) return new Response("Unauthorized", { status: 401 });
  const scan = await claimScan();
  if (scan) {
    after(async () => {
      await runScan(scan);
      // The cookie page and banner follow what the scan found.
      revalidateTag(cookiesTag(scan.storeId), "max");
    });
  }
  return Response.json({ scan: scan?.id ?? null }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = run;
export const POST = run;
