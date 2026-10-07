import type { FormState } from "@/components/admin/action-form";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import type { OfferedDesign } from "@/lib/design-presets";

import { DesignPreviewLink } from "./design-cards";

/** A design profile offered to a store, with where its preview is. */
export type PanelDesign = OfferedDesign & { previewHref: string; published?: boolean };

/**
 * The design profiles (D176) a store can apply, on its Design settings and on its page in the platform: a card for each (picture, title,
 * summary, Preview in a new window) and an Apply that first says exactly what changes and that the look from before is kept; and, after a
 * profile was applied, the way back. Server-drawn: the confirmation is a disclosure, so it works without JavaScript.
 */
export function DesignProfilePanel({
  designs,
  latest,
  apply,
  restore,
  canChange,
  closedNote,
}: {
  designs: PanelDesign[];
  /** The latest profile applied whose look from before can be put back. */
  latest: { presetTitle: string; appliedAt: string; savedTheme: string | null } | null;
  apply: ((state: FormState, formData: FormData) => Promise<FormState>) | null;
  restore: (() => Promise<FormState>) | null;
  canChange: boolean;
  /** Why nothing can be changed, when it cannot. */
  closedNote?: string;
}) {
  return (
    <section aria-labelledby="design-profiles-heading" className="flex flex-col gap-4 rounded-lg border border-border bg-background p-5">
      <div>
        <h2 id="design-profiles-heading" className="font-medium">
          Design profiles
        </h2>
        <p className="max-w-3xl text-sm text-muted">
          A whole look made by Kaizen: the theme (colours, fonts, buttons, corners, light and dark), a header, a footer, the product page
          layout and the site&apos;s CSS. Applying one never touches your products, pages, menus&apos; links, logo, name or business
          details, and your look from before is kept so you can put it back.
        </p>
      </div>
      {!canChange && closedNote && <p className="text-sm">{closedNote}</p>}
      {latest && (
        <div className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm">
          <p>
            Applied last: <strong>{latest.presetTitle}</strong> on {latest.appliedAt.slice(0, 10)}.
            {latest.savedTheme && <> The theme from before is the saved theme “{latest.savedTheme}”.</>}
          </p>
          {canChange && restore && (
            <ActionForm action={restore}>
              <SubmitButton variant="secondary">Put back the look from before {latest.presetTitle}</SubmitButton>
            </ActionForm>
          )}
        </div>
      )}
      {designs.length === 0 ? (
        <p className="text-sm text-muted">No design profiles are offered yet.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {designs.map((design) => (
            <li key={design.id} className="flex flex-col overflow-hidden rounded-lg border border-border">
              <div className="flex flex-1 flex-col gap-2 p-3 text-sm">
                {design.pictureUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- a profile's picture from Kaizen's media library
                  <img src={design.pictureUrl} alt="" loading="lazy" className="aspect-video w-full rounded-md border border-border object-cover" />
                )}
                <h3 className="font-medium">
                  {design.title}
                  {design.published === false && <span className="ml-2 rounded bg-surface px-1.5 py-0.5 text-xs font-normal">Not published</span>}
                </h3>
                {design.summary && <p>{design.summary}</p>}
                {canChange && apply && (
                  <details className="mt-auto">
                    <summary className="flex min-h-10 cursor-pointer items-center font-medium underline-offset-2 hover:underline">
                      Apply<span className="sr-only"> {design.title}</span>…
                    </summary>
                    <div className="mt-2 flex flex-col gap-2">
                      <p>Applying {design.title}:</p>
                      <ul className="list-disc pl-5">
                        <li>replaces the theme: colours, fonts, buttons, corners, product cards, light and dark;</li>
                        <li>adds its header, footer and product page layout as new pages and uses them (yours stay, unchosen);</li>
                        <li>replaces the store&apos;s custom CSS;</li>
                        <li>keeps your products, pages, menus, logo, name and business details as they are.</li>
                      </ul>
                      <p>Your look now is kept as a saved theme named “Before {design.title}”, and you can put it all back here.</p>
                      <ActionForm action={apply}>
                        <input type="hidden" name="design" value={design.id} />
                        <SubmitButton>Apply {design.title}</SubmitButton>
                      </ActionForm>
                    </div>
                  </details>
                )}
              </div>
              <DesignPreviewLink href={design.previewHref} title={design.title} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
