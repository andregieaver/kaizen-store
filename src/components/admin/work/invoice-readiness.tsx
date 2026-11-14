import Link from "next/link";

import type { InvoiceReadiness } from "@/server/work-invoices";
import { countWords } from "@/lib/admin-fill";
import { problemHref } from "@/lib/work-invoice-ui";

import { Badge } from "./work-parts";
import type { ScreensMessages } from "@/lib/admin-messages/screens.en";

/**
 * The words the list reads, handed in by the caller (a server page or a client part) so this file imports no catalogue:
 * `problems` is the templates by problem code in the account's language, or null for English (the server's own text).
 */
export type ReadinessWords = {
  readyToIssue: string;
  toFix: ScreensMessages["workReadiness"]["toFix"];
  fix: string;
  check: string;
  open: Record<string, string>;
  problems: Record<string, string | undefined> | null;
};

/** A problem in the account's words: the server's own text when English or when the code has none, else the template with its `{name}`s filled. */
function problemText(
  words: ReadinessWords,
  problem: { code: string; message: string; values?: Record<string, string> },
): string {
  const template = words.problems?.[problem.code];
  return template
    ? template.replace(/\{(\w+)\}/g, (whole, name: string) => problem.values?.[name] ?? whole)
    : problem.message;
}

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
  words,
}: {
  readiness: InvoiceReadiness;
  storeSlug: string;
  clientId: string;
  checking?: boolean;
  words: ReadinessWords;
}) {
  const errors = readiness.problems.filter((p) => p.severity === "error");
  const warnings = readiness.problems.filter((p) => p.severity !== "error");
  return (
    <div className="flex flex-col gap-3" aria-busy={checking}>
      <p role="status" className="text-sm font-medium">
        {readiness.ready
          ? words.readyToIssue
          : countWords(errors.length, words.toFix)}
      </p>
      {readiness.problems.length > 0 && (
        <ul className="flex flex-col gap-2">
          {[...errors, ...warnings].map((problem) => {
            const fix = problemHref(problem.where, { storeSlug, clientId });
            return (
              <li
                key={`${problem.code}:${problem.message}`}
                className="flex flex-col gap-1 rounded-md border border-line p-3 text-sm"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={problem.severity === "error" ? "bad" : "warn"}>
                    {problem.severity === "error" ? words.fix : words.check}
                  </Badge>
                  <span>{problemText(words, problem)}</span>
                </span>
                <Link href={fix.href} className="self-start text-sm underline">
                  {words.open[problem.where]}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
