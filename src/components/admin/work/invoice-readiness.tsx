import Link from "next/link";

import type { InvoiceReadiness } from "@/server/work-invoices";
import { problemHref } from "@/lib/work-invoice-ui";

import { Badge } from "./work-parts";

/**
 * What is missing before the draft can be issued, as the owner reads it (docs/work.md 4.5 6): each problem in words,
 * whether it blocks issuing or only asks for a second look, and a link to where it is fixed (the Company page, Work
 * settings, the client, or the lines). Nothing here decides anything: the server checks again when issuing.
 */
export function ReadinessList({
  readiness,
  storeSlug,
  clientId,
  checking = false,
}: {
  readiness: InvoiceReadiness;
  storeSlug: string;
  clientId: string;
  checking?: boolean;
}) {
  const errors = readiness.problems.filter((p) => p.severity === "error");
  const warnings = readiness.problems.filter((p) => p.severity !== "error");
  return (
    <div className="flex flex-col gap-3" aria-busy={checking}>
      <p role="status" className="text-sm font-medium">
        {readiness.ready
          ? "Ready to issue."
          : `${errors.length} ${errors.length === 1 ? "thing" : "things"} to fix before you can issue this invoice.`}
      </p>
      {readiness.problems.length > 0 && (
        <ul className="flex flex-col gap-2">
          {[...errors, ...warnings].map((problem) => {
            const fix = problemHref(problem.where, { storeSlug, clientId });
            return (
              <li
                key={`${problem.code}:${problem.message}`}
                className="flex flex-col gap-1 rounded-md border border-border p-3 text-sm"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={problem.severity === "error" ? "bad" : "warn"}>
                    {problem.severity === "error" ? "Fix" : "Check"}
                  </Badge>
                  <span>{problem.message}</span>
                </span>
                <Link href={fix.href} className="self-start text-sm underline">
                  {fix.label}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
