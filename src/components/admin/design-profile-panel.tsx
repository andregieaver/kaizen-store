import type { FormState } from "@/components/admin/action-form";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import type { OfferedDesign } from "@/lib/design-presets";

import { DesignPreviewLink } from "./design-cards";
import { Card, Chip } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, type AdminLang } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { platformText } from "@/lib/platform-text";
import { themeStoreUrl } from "@/lib/theme-host";
import { chargeButton, chargeLine, chargeToken, type ChargeWords, type ThemeCharge } from "@/lib/theme-prices";

/** A design profile offered to a store, with where its preview is, and what making it live costs the store (D286; none: free). */
export type PanelDesign = OfferedDesign & { previewHref: string; published?: boolean; charge?: ThemeCharge };

/** One card: a theme's own look or one of its presets (`docs/theme-showcase-phase-1.md`), each added or applied on its own. */
type PanelLook = PanelDesign & { preset: { key: string; name: string } | null };

/** A preview address for one of the theme's presets (`preset={key}`), kept relative as the page gave it. */
function presetHref(href: string, key: string): string {
  const url = new URL(href, "http://x");
  url.searchParams.set("preset", key);
  return `${url.pathname}${url.search}`;
}

/** The cards: each theme's own look, then each of its presets as a look of its own (*Calm · Coast*). */
export function panelLooks(designs: PanelDesign[]): PanelLook[] {
  return designs.flatMap((design) => [
    { ...design, preset: null },
    ...(design.presets ?? []).map((preset) => ({ ...design, preset, previewHref: presetHref(design.previewHref, preset.key) })),
  ]);
}

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
  lang = "en",
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
  /** The admin's language (D312 A7); English unless given. */
  lang?: AdminLang;
}) {
  const all = adminText(lang, "design");
  const { common: c, add: w } = all;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const cards = platformText(lang).themeCards;
  return (
    <Card title={w.title} description={<>{w.description} <a href={themeStoreUrl(undefined, lang)} target="_blank" rel="noopener" className="underline underline-offset-2">{w.seeAll}<span className="sr-only">{w.opensNew}</span></a>.</>} className="flex flex-col gap-4" compact>
      {!canChange && closedNote && <p className="text-sm">{closedNote}</p>}
      {latest && (
        <div className="flex flex-col gap-2 rounded-md border border-line p-3 text-sm">
          <p>
            {fillWords(w.appliedLast, { name: latest.presetTitle, date: latest.appliedAt.slice(0, 10) })}
            {latest.previousInstall
              ? fillWords(w.beforeInstall, { name: latest.previousInstall })
              : latest.savedTheme && fillWords(w.beforeSaved, { name: latest.savedTheme })}
          </p>
          {canChange && restore && (
            <ActionForm action={restore}>
              <SubmitButton variant="secondary">{fillWords(w.putBack, { name: latest.presetTitle })}</SubmitButton>
            </ActionForm>
          )}
        </div>
      )}
      {designs.length === 0 ? (
        <p className="text-sm text-muted">{w.none}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {panelLooks(designs).map((design) => {
            const name = design.preset ? fillWords(c.lookName, { theme: design.title, preset: design.preset.name }) : design.title;
            return (
              <li key={`${design.id}:${design.preset?.key ?? ""}`} className="flex flex-col overflow-hidden rounded-panel border border-line">
                <div className="flex flex-1 flex-col gap-2 p-3 text-sm">
                  {design.pictureUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- a profile's picture from Kaizen's media library
                    <img src={design.pictureUrl} alt="" loading="lazy" className="aspect-video w-full rounded-md border border-line object-cover" />
                  )}
                  <h3 className="text-body-strong text-ink">
                    {name}
                    {design.published === false && <span className="ml-2 rounded bg-sunken px-1.5 py-0.5 text-xs font-normal">{w.notPublished}</span>}
                  </h3>
                  {design.preset ? <p>{fillWords(w.presetOf, { theme: design.title })}</p> : design.summary && <p>{design.summary}</p>}
                  <ChargeNote charge={design.charge} words={{ yours: w.yours, premium: w.premium, charge: all.charge, locale }} />
                  {canChange && install && (
                    <ActionForm action={install} className="mt-auto">
                      <input type="hidden" name="design" value={design.id} />
                      {design.preset && <input type="hidden" name="preset" value={design.preset.key} />}
                      <SubmitButton variant="secondary">
                        {w.addToMine}<span className="sr-only"> ({name})</span>
                      </SubmitButton>
                    </ActionForm>
                  )}
                  {canChange && apply && (
                    <details className={install ? undefined : "mt-auto"}>
                      <summary className="flex min-h-10 cursor-pointer items-center font-medium underline-offset-2 hover:underline">
                        {w.apply}<span className="sr-only"> {name}</span>…
                      </summary>
                      <div className="mt-2 flex flex-col gap-2">
                        <p>{fillWords(w.applying, { name })}</p>
                        <ul className="list-disc pl-5">
                          <li>{w.installs}</li>
                          <li>{w.addsLayouts}</li>
                          <li>{w.replacesCss}</li>
                          <li>{w.keeps}</li>
                        </ul>
                        <p>{w.stays}</p>
                        {design.charge && chargeLine(design.charge, all.charge, locale) && <p className="text-body-strong text-ink">{chargeLine(design.charge, all.charge, locale)}</p>}
                        <ActionForm action={apply}>
                          <input type="hidden" name="design" value={design.id} />
                          {design.preset && <input type="hidden" name="preset" value={design.preset.key} />}
                          {design.charge?.kind === "now" && <input type="hidden" name="charge" value={chargeToken(design.charge.price)} />}
                          <SubmitButton>{design.charge ? chargeButton(design.charge, fillWords(w.applyName, { name }), all.charge, locale) : fillWords(w.applyName, { name })}</SubmitButton>
                        </ActionForm>
                      </div>
                    </details>
                  )}
                </div>
                <DesignPreviewLink href={design.previewHref} title={name} words={cards} />
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** What a premium theme costs this store, under its summary (D286): its price and when it is paid, or that the store has it. */
export function ChargeNote({
  charge,
  words = { yours: "Yours", premium: "Premium" },
}: {
  charge?: ThemeCharge;
  /** In the admin's language (D312 A7); English unless given. */
  words?: { yours: string; premium: string; charge?: ChargeWords; locale?: string };
}) {
  if (!charge || charge.kind === "free") return null;
  return (
    <p className="flex flex-wrap items-center gap-2 text-caption text-muted">
      <Chip signal={charge.kind === "owned" ? "positive" : "insight"}>{charge.kind === "owned" ? words.yours : words.premium}</Chip>
      <span>{chargeLine(charge, words.charge, words.locale)}</span>
    </p>
  );
}
