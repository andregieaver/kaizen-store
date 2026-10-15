import type { FormState } from "@/components/admin/action-form";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import type { OfferedDesign } from "@/lib/design-presets";

import { DesignPreviewLink } from "./design-cards";
import { Card } from "@/components/admin/ui";
import { themeStoreUrl } from "@/lib/theme-host";

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
  install,
  restore,
  canChange,
  closedNote,
}: {
  designs: PanelDesign[];
  /** The latest profile applied whose look from before can be put back. */
  latest: { presetTitle: string; appliedAt: string; savedTheme: string | null; previousInstall?: string | null } | null;
  apply: ((state: FormState, formData: FormData) => Promise<FormState>) | null;
  /** Adds a theme to the store's library without making it live (`docs/theme-phase-3.md` step 2); left out where there is no library. */
  install?: ((state: FormState, formData: FormData) => Promise<FormState>) | null;
  restore: (() => Promise<FormState>) | null;
  canChange: boolean;
  /** Why nothing can be changed, when it cannot. */
  closedNote?: string;
}) {
  return (
    <Card title="Add a theme" description={<>A whole look made by Kaizena Flow: its settings (colours, fonts, buttons, corners, light and dark), a header, a footer, the product page layout and the site&apos;s CSS. Applying one never touches your products, pages, menus&apos; links, logo, name or business details, and your look from before stays in your theme library so you can switch back. Add one to your themes to preview and customise it first; visitors see nothing until you switch. <a href={themeStoreUrl()} target="_blank" rel="noopener" className="underline underline-offset-2">See every theme in the theme store<span className="sr-only"> (opens in a new window)</span></a>.</>} className="flex flex-col gap-4" compact>
      {!canChange && closedNote && <p className="text-sm">{closedNote}</p>}
      {latest && (
        <div className="flex flex-col gap-2 rounded-md border border-line p-3 text-sm">
          <p>
            Applied last: <strong>{latest.presetTitle}</strong> on {latest.appliedAt.slice(0, 10)}.
            {latest.previousInstall ? (
              <> The look from before is “{latest.previousInstall}” in your theme library.</>
            ) : (
              latest.savedTheme && <> The theme from before is the saved theme “{latest.savedTheme}”.</>
            )}
          </p>
          {canChange && restore && (
            <ActionForm action={restore}>
              <SubmitButton variant="secondary">Put back the look from before {latest.presetTitle}</SubmitButton>
            </ActionForm>
          )}
        </div>
      )}
      {designs.length === 0 ? (
        <p className="text-sm text-muted">No themes are offered yet.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {designs.map((design) => (
            <li key={design.id} className="flex flex-col overflow-hidden rounded-panel border border-line">
              <div className="flex flex-1 flex-col gap-2 p-3 text-sm">
                {design.pictureUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- a profile's picture from Kaizen's media library
                  <img src={design.pictureUrl} alt="" loading="lazy" className="aspect-video w-full rounded-md border border-line object-cover" />
                )}
                <h3 className="text-body-strong text-ink">
                  {design.title}
                  {design.published === false && <span className="ml-2 rounded bg-sunken px-1.5 py-0.5 text-xs font-normal">Not published</span>}
                </h3>
                {design.summary && <p>{design.summary}</p>}
                {canChange && install && (
                  <ActionForm action={install} className="mt-auto">
                    <input type="hidden" name="design" value={design.id} />
                    <SubmitButton variant="secondary">
                      Add to my themes<span className="sr-only"> ({design.title})</span>
                    </SubmitButton>
                  </ActionForm>
                )}
                {canChange && apply && (
                  <details className={install ? undefined : "mt-auto"}>
                    <summary className="flex min-h-10 cursor-pointer items-center font-medium underline-offset-2 hover:underline">
                      Apply<span className="sr-only"> {design.title}</span>…
                    </summary>
                    <div className="mt-2 flex flex-col gap-2">
                      <p>Applying {design.title}:</p>
                      <ul className="list-disc pl-5">
                        <li>installs it and makes it live: colours, fonts, buttons, corners, product cards, light and dark;</li>
                        <li>adds its header, footer and product page layout as new pages and uses them (yours stay, unchosen);</li>
                        <li>replaces the store&apos;s custom CSS;</li>
                        <li>keeps your products, pages, menus, logo, name and business details as they are.</li>
                      </ul>
                      <p>Your look now stays in your theme library with every change you made to it, and you can switch back to it at any time.</p>
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
    </Card>
  );
}
