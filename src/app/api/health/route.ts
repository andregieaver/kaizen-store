import { connection } from "next/server";

import { checkHealth } from "@/lib/health";

export async function GET() {
  await connection();
  const report = await checkHealth();
  return Response.json(report, {
    status: report.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
