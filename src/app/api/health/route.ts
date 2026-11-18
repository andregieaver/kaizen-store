import { readFile } from "node:fs/promises";
import path from "node:path";

import { after, connection } from "next/server";

import { countActiveMarkets } from "@/db/health";
import { checkHealth, readBuildStats } from "@/lib/health";
import { noteFirstRequest } from "@/server/instance-start";

export async function GET() {
  await connection();
  noteFirstRequest("health", after);
  // build-stats.json is written when the build ends (scripts/next-build.mjs) and traced with this route (next.config.ts).
  const stats = readBuildStats(await readFile(path.join(process.cwd(), "build-stats.json"), "utf8").catch(() => ""));
  const report = await checkHealth({
    build: stats.build,
    buildCommit: stats.commit,
    countActiveMarkets: process.env.DATABASE_URL ? countActiveMarkets : null,
  });
  return Response.json(report, {
    status: report.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
