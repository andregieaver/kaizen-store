import Link from "next/link";
import type { ComponentProps } from "react";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Card, Chip } from "@/components/admin/ui";
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
  return (
    <Card title={w.title} description={w.description}>
      <ActionForm action={write} className="flex flex-col gap-4">
        {missing && (
          <p className="rounded-panel border border-warning-line bg-warning-soft p-4 text-sm text-warning-text">
            {w.missing.replace("{list}", missing)}{" "}
            <Link href="/admin/platform/navigation" className="underline">
              {w.businessLink}
            </Link>
          </p>
        )}
        <ul className="divide-y divide-line">
          {overview.pages.map((page) => (
            <li key={page.kind} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <span className="flex flex-wrap items-center gap-3">
                {page.published ? (
                  <a href={`/${page.slug}`} className="text-body-strong text-ink underline-offset-2 hover:underline">
                    {w.kinds[page.kind]}
                  </a>
                ) : (
                  <span className="text-body-strong text-ink">{w.kinds[page.kind]}</span>
                )}
                <Chip signal={page.written ? "positive" : page.published ? "warning" : "neutral"}>
                  {page.written ? w.states.written : page.published ? w.states.empty : w.states.none}
                </Chip>
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
        <div>
          <SubmitButton>{w.write}</SubmitButton>
        </div>
      </ActionForm>
    </Card>
  );
}
