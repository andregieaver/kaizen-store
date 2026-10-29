import { connection } from "next/server";

import { cspViolations } from "@/lib/csp-report";
import { log } from "@/server/log";
import { budgetVisitor, takeBudget } from "@/server/request-budget";

/**
 * Where browsers report what the site-wide Report-Only policy would have blocked (D389, PSI SEC-05): each violation is one `csp.violation`
 * log line with its directive, the blocked origin and the part of the site (`cspViolations()`), never the page's address, a cookie or
 * the visitor; nothing is stored. Budgeted per visitor and for the platform (`csp`), and always answered 204 so a page never retries.
 */
export async function POST(request: Request) {
  await connection();
  const done = new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  if (!(await takeBudget(null, "csp", budgetVisitor(request.headers)))) return done;
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 64_000) return done;
    body = JSON.parse(text);
  } catch {
    return done;
  }
  for (const violation of cspViolations(body)) log("warn", "csp.violation", violation);
  return done;
}
