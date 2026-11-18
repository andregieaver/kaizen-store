import { after, connection } from "next/server";

import { countActiveMarkets } from "@/db/health";
import { checkHealth } from "@/lib/health";
import { noteFirstRequest } from "@/server/instance-start";

export async function GET() {
  await connection();
  noteFirstRequest("health", after);
  const report = await checkHealth({
    countActiveMarkets: process.env.DATABASE_URL ? countActiveMarkets : null,
  });
  return Response.json(report, {
    status: report.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
