"use client";

import { useState } from "react";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { FontLinks } from "@/components/font-links";
import { fontClass, type SiteFonts } from "@/lib/fonts";

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
  const [heading, setHeading] = useState(fonts.heading);
  const [body, setBody] = useState(fonts.body);
  return (
    <ActionForm action={action} className="flex flex-col gap-5" successMessage="Saved. The site uses these fonts now.">
      <input type="hidden" name="heading" value={heading ?? ""} />
      <input type="hidden" name="body" value={body ?? ""} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FontPicker label="Headings" value={heading} onChange={setHeading} install={install} defaultLabel="The body font" />
        <FontPicker label="Body text" value={body} onChange={setBody} install={install} defaultLabel="The system's font" />
      </div>

      <FontLinks families={[heading, body]} />
      <figure className="flex flex-col gap-2 rounded-lg border border-border p-5">
        <figcaption className="text-xs text-muted">Sample</figcaption>
        <div className={body ? fontClass(body) : undefined}>
          <p className={`text-2xl font-semibold ${heading ? fontClass(heading) : ""}`}>Handmade cups for slow mornings</p>
          <p className="mt-2 max-w-prose">
            Each cup is thrown by hand in our workshop and glazed in small batches, so no two are quite alike. Free delivery
            on orders over 500 kr.
          </p>
        </div>
      </figure>
      <div>
        <SubmitButton>Save fonts</SubmitButton>
      </div>
    </ActionForm>
  );
}
