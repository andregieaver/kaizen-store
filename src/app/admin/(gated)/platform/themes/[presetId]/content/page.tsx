import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { PackPictures, PackPicturesWatch, PackSlotPictures } from "@/components/admin/pack-pictures";
import { PreviewLink } from "@/components/admin/preview-link";
import { Card, Chip } from "@/components/admin/ui";
import { designPreviewPath } from "@/lib/design-presets";
import { contentPackStates, packSlotViews } from "@/server/content-packs";
import { shownDesignDetails } from "@/server/design-presets";
import { contentSources, themeContentOf } from "@/server/store-starters";

import { giveThemeContentAction, openThemeContentAction, publishThemeContentAction } from "../../actions";
import { askPackPicturesAction, putBackPackPictureAction, remakePackPictureAction, stopPackPicturesAction } from "../../demo-stores/actions";
import { designPage } from "../data";
import { DesignShell } from "../shell";
import { countWords, fillWords } from "@/lib/admin-fill";
import { platformSiteWords } from "@/server/platform-site-words";

export const metadata: Metadata = { title: "Theme content" };

const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";


/**
 * A theme's own content (D275, `docs/themes-content-and-demo-stores.md`): the pages, products and pictures its preview and photographs show
 * and new stores started from it begin with. Edited in its store admin, its pictures made in the background, published with the theme or on
 * its own here, or replaced with a copy of other published content.
 */
export default async function ThemeContentPage({ params, searchParams }: PageProps<"/admin/platform/themes/[presetId]/content">) {
  const { design, facts } = await designPage((await params).presetId);
  const [query, content, sources, packs] = await Promise.all([searchParams, themeContentOf(design.id), contentSources(), contentPackStates()]);
  const title = shownDesignDetails(design).title;
  const { w } = await platformSiteWords();
  const c = w.content;
  const pack = content?.pack ? packs.find((one) => one.key === content.pack) : undefined;
  const picturesReady = pack && pack.starterId !== null && pack.current && !pack.archived;
  // Each of its pictures, to make again one by one (D283), once the pack's store is current.
  const slots = picturesReady ? await packSlotViews(pack.key) : null;
  const status = !content
    ? null
    : !content.published
      ? { words: c.notPublished, signal: "warning" as const }
      : content.changed
        ? { words: c.changed, signal: "warning" as const }
        : { words: c.published, signal: "positive" as const };
  const others = sources.filter((source) => source.id !== content?.starterId);

  return (
    <DesignShell design={design} facts={facts} tab="content">
      {query.nocontent && (
        <p role="status" className="rounded-panel border border-line bg-card p-4 text-sm">
          {c.notCopied}
        </p>
      )}

      <Card
        title={c.title}
        description={fillWords(c.description, { title })}
        aside={status && <Chip signal={status.signal}>{status.words}</Chip>}
      >
        {content ? (
          <div className="flex flex-col gap-4">
            <PackPicturesWatch active={Boolean(picturesReady && pack.asked && pack.pictures < pack.slots)} />
            <p className="text-sm">
              <span className="text-body-strong text-ink">{content.storeName}</span>: {countWords(content.products, c.products)}, {countWords(content.pages, c.pages)}
              {content.pictures && fillWords(c.pictures, { made: content.pictures.made, slots: content.pictures.slots })}.
            </p>
            {content.pack && (
              <p className="text-sm text-muted">{c.packNote}</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <ActionForm action={openThemeContentAction.bind(null, design.id)}>
                <SubmitButton variant="secondary">{c.edit}</SubmitButton>
              </ActionForm>
              <PreviewLink href={designPreviewPath(design.id, null, true)} label={w.preview.preview} title={title} of={w.preview.of} />
              {design.workspaceStoreId && <PreviewLink href={designPreviewPath(design.id, null, true, true)} label={w.preview.draft} title={title} of={w.preview.of} />}
              {/* Kept mounted once published, so its confirmation stays on screen after the page is read again. */}
              <ActionForm action={publishThemeContentAction.bind(null, design.id)}>
                {(!content.published || content.changed) && <SubmitButton>{c.publish}</SubmitButton>}
              </ActionForm>
            </div>
            {picturesReady && pack.pictures < pack.slots && (
              <PackPictures
                title={pack.title}
                made={pack.pictures}
                total={pack.slots}
                asked={pack.asked}
                problem={pack.problem}
                ask={askPackPicturesAction.bind(null, [pack.key])}
                stop={stopPackPicturesAction.bind(null, pack.key)}
              />
            )}
            <p className="text-sm text-muted">{c.publishNote}</p>
          </div>
        ) : (
          <p className="text-sm">{fillWords(c.none, { title })}</p>
        )}
      </Card>

      {pack && slots && (
        <Card
          title={c.picturesTitle}
          description={fillWords(c.picturesDescription, { store: content?.storeName ?? pack.storeName })}
        >
          <PackSlotPictures
            title={pack.title}
            slots={slots}
            // Said by *Make the pictures* above while some are still to make.
            problem={pack.pictures >= pack.slots ? pack.problem : null}
            remake={remakePackPictureAction.bind(null, pack.key)}
            putBack={putBackPackPictureAction.bind(null, pack.key)}
            stop={stopPackPicturesAction.bind(null, pack.key)}
          />
        </Card>
      )}

      <Card
        title={content ? c.replaceTitle : c.giveTitle}
        description={
          <>
            {c.giveDescription}
            {content && c.letGo}
          </>
        }
      >
        {others.length === 0 ? (
          <p className="text-sm text-muted">{c.noSources}</p>
        ) : (
          <ActionForm action={giveThemeContentAction.bind(null, design.id)} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              {c.copyFrom}
              <select name="source" required className={control}>
                {others.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.title} ({w.contentSources[source.kind]})
                  </option>
                ))}
              </select>
            </label>
            {content && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="confirm" required className="mt-0.5 size-4" />
                <span>{fillWords(c.replaceConfirm, { store: content.storeName })}</span>
              </label>
            )}
            <div>
              <SubmitButton variant={content ? "secondary" : undefined}>{content ? c.replace : c.use}</SubmitButton>
            </div>
          </ActionForm>
        )}
      </Card>
    </DesignShell>
  );
}
