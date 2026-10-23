import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { PreviewLink } from "@/components/admin/preview-link";
import { ButtonLink, Card, List, ListRow, RowActions, RowLead } from "@/components/admin/ui";
import { VARIATIONS_MAX, designPreviewPath, designTabHref } from "@/lib/design-presets";
import { listVariations } from "@/server/design-variations";
import { shownDesignDetails } from "@/server/design-presets";

import { designWorkspacePage } from "../data";
import { DesignShell } from "../shell";
import { addVariationAction, moveVariationAction, removeVariationAction } from "../variation-actions";
import { fillWords } from "@/lib/admin-fill";
import { platformSiteWords } from "@/server/platform-site-words";

export const metadata: Metadata = { title: "Theme presets" };

/**
 * A theme's presets (`docs/theme-showcase-phase-1.md` step 1): its own look first, then up to five more named designs over it (colours,
 * fonts, buttons, section styles), each edited in the theme editor; part of the theme's draft until it is published.
 */
export default async function DesignPresetsPage({ params }: PageProps<"/admin/platform/themes/[presetId]/presets">) {
  const { presetId } = await params;
  const page = await designWorkspacePage(presetId);
  const presets = await listVariations(page.admin, presetId);
  const { w } = await platformSiteWords();
  const p = w.presets;
  const title = shownDesignDetails(page.design).title;
  const full = presets.length >= VARIATIONS_MAX;
  return (
    <DesignShell design={page.design} facts={page.facts} tab="presets">
      {page.problem !== null ? (
        <p role="alert" className="rounded-panel border border-line bg-card p-4 text-sm">{page.problem}</p>
      ) : (
        <>
          <p className="max-w-3xl text-sm text-muted">{p.intro}</p>
          <Card title={p.title} count={presets.length + 1} countLabel={p.countLabel}>
            <List label={p.list}>
              <ListRow>
                <RowLead title={title} sub={p.ownLook} />
                <RowActions>
                  <ButtonLink href={designTabHref(presetId, "theme")} size="dense">
                    {p.edit}
                  </ButtonLink>
                  <PreviewLink href={designPreviewPath(presetId, null, true, true)} label={w.preview.preview} title={title} of={w.preview.of} />
                </RowActions>
              </ListRow>
              {presets.map((preset, index) => (
                <ListRow key={preset.key}>
                  <RowLead title={preset.name} href={`${designTabHref(presetId, "presets")}/${preset.key}`} sub={fillWords(p.address, { key: preset.key })} />
                  <RowActions>
                    <form action={moveVariationAction.bind(null, presetId, preset.key, "up")}>
                      <button type="submit" disabled={index === 0} className="min-h-10 rounded-pill px-3 text-sm hover:bg-sunken disabled:opacity-40">
                        {p.moveUp}
                        <span className="sr-only">: {preset.name}</span>
                      </button>
                    </form>
                    <form action={moveVariationAction.bind(null, presetId, preset.key, "down")}>
                      <button
                        type="submit"
                        disabled={index === presets.length - 1}
                        className="min-h-10 rounded-pill px-3 text-sm hover:bg-sunken disabled:opacity-40"
                      >
                        {p.moveDown}
                        <span className="sr-only">: {preset.name}</span>
                      </button>
                    </form>
                    <ButtonLink href={`${designTabHref(presetId, "presets")}/${preset.key}`} size="dense">
                      {p.edit}
                      <span className="sr-only"> {preset.name}</span>
                    </ButtonLink>
                    <PreviewLink href={designPreviewPath(presetId, null, true, true, false, preset.key)} label={w.preview.preview} title={preset.name} of={w.preview.of} />
                    <details className="relative">
                      <summary className="flex min-h-10 cursor-pointer list-none items-center rounded-pill px-3 text-sm hover:bg-sunken [&::-webkit-details-marker]:hidden">
                        {p.remove}
                        <span className="sr-only"> {preset.name}</span>
                      </summary>
                      <div className="absolute right-0 z-10 mt-2 flex w-72 flex-col gap-3 rounded-panel border border-line bg-card p-4 text-sm shadow-lg">
                        <p>{fillWords(p.removeNote, { name: preset.name })}</p>
                        <ActionForm action={removeVariationAction.bind(null, presetId, preset.key)}>
                          <SubmitButton variant="secondary">{fillWords(p.removeNamed, { name: preset.name })}</SubmitButton>
                        </ActionForm>
                      </div>
                    </details>
                  </RowActions>
                </ListRow>
              ))}
            </List>
          </Card>
          <Card title={p.addTitle} description={full ? fillWords(p.full, { max: VARIATIONS_MAX + 1 }) : p.copyNote}>
            {!full && (
              <ActionForm action={addVariationAction.bind(null, presetId)} className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-sm">
                  {p.name}
                  <input name="name" required maxLength={40} placeholder={p.namePlaceholder} className="input min-h-10 w-64 rounded-lg border border-edge px-3" />
                </label>
                <SubmitButton>{p.add}</SubmitButton>
              </ActionForm>
            )}
          </Card>
        </>
      )}
    </DesignShell>
  );
}
