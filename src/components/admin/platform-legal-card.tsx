import Link from "next/link";
import type { ComponentProps } from "react";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Card } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import type { PlatformLegalMessages } from "@/lib/admin-messages/platform-legal.en";
import type { AdminLang } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import type { LegalPagesOverview } from "@/server/platform-legal";

/** The action that writes the pages, as `ActionForm` takes it. */
type WriteAction = ComponentProps<typeof ActionForm>["action"];

/**
 * Kaizena Flow's own legal pages on its Pages list (D312 P5): where each stands, the business details the texts are missing, and the
 * one button that writes and publishes them in English and Norwegian (`writePlatformLegalPages()`). A page already written is kept
 * unless its box is ticked.
 */
export function PlatformLegalCard({
  lang,
  overview,
  write,
}: {
  lang: AdminLang;
  overview: LegalPagesOverview;
  write: WriteAction;
}) {
  const w = adminText(lang, "platformLegal");
  const missing = overview.missing.map((key) => w.facts[key]).join(", ");
  const n = overview.missing.length;
  return (
    <>
      {/* Round 16 (D650): the missing details are one line, the pages rows, and writing them one press under the rows. */}
      {missing && (
        <p role="note" className="text-sm text-warning-text">
          {countWords(n, w.missingLine, { list: missing })}{" "}
          <Link href="/admin/platform/navigation" className="underline">
            {w.fillIn}
          </Link>
        </p>
      )}
      <Card title={w.title} description={w.description} compact>
        <ActionForm action={write} className="flex flex-col gap-4">
          <ul className="divide-y divide-line">
            {overview.pages.map((page) => (
              <li key={page.kind} className="flex min-h-14 flex-wrap items-center justify-between gap-3 py-3">
                <span className="flex flex-col">
                  {page.published ? (
                    <a href={`/${page.slug}`} className="text-body text-ink underline-offset-2 hover:underline">
                      {w.kinds[page.kind]}
                    </a>
                  ) : (
                    <span className="text-body text-ink">{w.kinds[page.kind]}</span>
                  )}
                  <span className="text-caption text-ink-2">{page.written ? w.states.written : page.published ? w.states.empty : w.states.none}</span>
                </span>
                {page.written && (
                  <label className="flex items-center gap-2 text-sm text-ink-2">
                    <input type="checkbox" name="overwrite" value={page.kind} />
                    {w.overwrite}
                  </label>
                )}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton>{w.write}</SubmitButton>
            <span className="text-caption text-ink-2">{w.writeHint}</span>
          </div>
        </ActionForm>
      </Card>
    </>
  );
}

/** How far Kaizena Flow's legal pages are, as the Pages list's sentence says it (round 16): none, some or all published with words. */
export function platformLegalLead(overview: LegalPagesOverview, w: PlatformLegalMessages): string {
  const written = overview.pages.filter((page) => page.written).length;
  return written === 0 ? w.legalNone : written === overview.pages.length ? w.legalAll : fillWords(w.legalSome, { n: written, total: overview.pages.length });
}
