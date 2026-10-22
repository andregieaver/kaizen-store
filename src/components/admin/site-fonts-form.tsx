"use client";

import { useState } from "react";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { FontLinks } from "@/components/font-links";
import { fontClass } from "@/lib/fonts";
import { type SiteFonts } from "@/lib/fonts-schema";

import { useAdminText } from "./admin-text";
import { FontPicker, type InstallFont } from "./font-picker";

/**
 * A site's own fonts (D59), Kaizen's or a store's: one for headings and
 * one for everything else, from Google Fonts, with a sample of both.
 * Blocks in the page builder can still choose their own.
 */
export function SiteFontsForm({
  fonts,
  action,
  install,
}: {
  fonts: SiteFonts;
  action: (state: FormState, form: FormData) => Promise<FormState>;
  install: InstallFont;
}) {
  const { editor: e, fonts: w } = useAdminText("design");
  const [heading, setHeading] = useState(fonts.heading);
  const [body, setBody] = useState(fonts.body);
  return (
    <ActionForm action={action} className="flex flex-col gap-5" successMessage={w.siteSaved}>
      <input type="hidden" name="heading" value={heading ?? ""} />
      <input type="hidden" name="body" value={body ?? ""} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FontPicker label={e.headings} value={heading} onChange={setHeading} install={install} defaultLabel={e.theBodyFont} />
        <FontPicker label={e.bodyText} value={body} onChange={setBody} install={install} defaultLabel={e.systemFont} />
      </div>

      <FontLinks families={[heading, body]} />
      <figure className="flex flex-col gap-2 rounded-panel border border-line p-5">
        <figcaption className="text-xs text-muted">{w.sample}</figcaption>
        <div className={body ? fontClass(body) : undefined}>
          <p className={`text-metric text-ink tabular-nums ${heading ? fontClass(heading) : ""}`}>{w.sampleHeading}</p>
          <p className="mt-2 max-w-prose">{w.sampleText}</p>
        </div>
      </figure>
      <div>
        <SubmitButton>{w.saveFonts}</SubmitButton>
      </div>
    </ActionForm>
  );
}
