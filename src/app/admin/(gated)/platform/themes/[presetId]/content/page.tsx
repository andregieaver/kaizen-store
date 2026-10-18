import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { PackPictures, PackPicturesWatch } from "@/components/admin/pack-pictures";
import { PreviewLink } from "@/components/admin/preview-link";
import { Card, Chip } from "@/components/admin/ui";
import { designPreviewPath } from "@/lib/design-presets";
import { contentPackStates } from "@/server/content-packs";
import { shownDesignDetails } from "@/server/design-presets";
import { contentSources, themeContentOf } from "@/server/store-starters";

import { giveThemeContentAction, openThemeContentAction, publishThemeContentAction } from "../../actions";
import { askPackPicturesAction, stopPackPicturesAction } from "../../demo-stores/actions";
import { designPage } from "../data";
import { DesignShell } from "../shell";

export const metadata: Metadata = { title: "Theme content" };

const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";
const KIND_WORDS = { pack: "starting content", theme: "a theme's content", demo: "demo store" } as const;

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * A theme's own content (D275, `docs/themes-content-and-demo-stores.md`): the pages, products and pictures its preview and photographs show
 * and new stores started from it begin with. Edited in its store admin, its pictures made in the background, published with the theme or on
 * its own here, or replaced with a copy of other published content.
 */
export default async function ThemeContentPage({ params, searchParams }: PageProps<"/admin/platform/themes/[presetId]/content">) {
  const { design, facts } = await designPage((await params).presetId);
  const [query, content, sources, packs] = await Promise.all([searchParams, themeContentOf(design.id), contentSources(), contentPackStates()]);
  const title = shownDesignDetails(design).title;
  const pack = content?.pack ? packs.find((one) => one.key === content.pack) : undefined;
  const picturesReady = pack && pack.starterId !== null && pack.current && !pack.archived;
  const status = !content
    ? null
    : !content.published
      ? { words: "Not published yet", signal: "warning" as const }
      : content.changed
        ? { words: "Published, with changes since", signal: "warning" as const }
        : { words: "Published", signal: "positive" as const };
  const others = sources.filter((source) => source.id !== content?.starterId);

  return (
    <DesignShell design={design} facts={facts} tab="content">
      {query.nocontent && (
        <p role="status" className="rounded-panel border border-line bg-card p-4 text-sm">
          The theme is made, but its content could not be copied. Choose its content below.
        </p>
      )}

      <Card
        title="Its content"
        description={
          <>
            What the theme store shows {title} with, what its photographs are taken on, and what a new store started from it begins with: its
            pages, products, menus and pictures. Every preset is shown on the same content. A store that switches to {title} keeps its own words.
          </>
        }
        aside={status && <Chip signal={status.signal}>{status.words}</Chip>}
      >
        {content ? (
          <div className="flex flex-col gap-4">
            <PackPicturesWatch active={Boolean(picturesReady && pack.asked && pack.pictures < pack.slots)} />
            <p className="text-sm">
              <span className="text-body-strong text-ink">{content.storeName}</span>: {count(content.products, "product", "products")}, {count(content.pages, "page", "pages")}
              {content.pictures && `, ${content.pictures.made} of ${content.pictures.slots} pictures made`}.
            </p>
            {content.pack && (
              <p className="text-sm text-muted">
                Kaizena Flow writes this content as starting content: setting the starting content up again on the Themes page brings its newest
                version.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <ActionForm action={openThemeContentAction.bind(null, design.id)}>
                <SubmitButton variant="secondary">Edit the content</SubmitButton>
              </ActionForm>
              <PreviewLink href={designPreviewPath(design.id, null, true)} label="Preview" title={title} />
              {design.workspaceStoreId && <PreviewLink href={designPreviewPath(design.id, null, true, true)} label="Preview the draft" title={title} />}
              {/* Kept mounted once published, so its confirmation stays on screen after the page is read again. */}
              <ActionForm action={publishThemeContentAction.bind(null, design.id)}>
                {(!content.published || content.changed) && <SubmitButton>Publish the content</SubmitButton>}
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
            <p className="text-sm text-muted">Publishing the theme publishes its content too. Edits in its store reach no one until then.</p>
          </div>
        ) : (
          <p className="text-sm">
            {title} has no content yet, so the theme store shows no preview of it and a new store started from it gets the Standard store. Choose
            its content below.
          </p>
        )}
      </Card>

      <Card
        title={content ? "Replace its content" : "Give it content"}
        description={
          <>
            A copy of published content, the theme&apos;s own to change: Kaizena Flow&apos;s starting content, another theme&apos;s content or a demo
            store.
            {content && " The content it has now is let go: starting content stays as it is, a copy of its own is archived."}
          </>
        }
      >
        {others.length === 0 ? (
          <p className="text-sm text-muted">No published content to copy yet: set up and publish the starting content on the Themes page first.</p>
        ) : (
          <ActionForm action={giveThemeContentAction.bind(null, design.id)} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Copy from
              <select name="source" required className={control}>
                {others.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.title} ({KIND_WORDS[source.kind]})
                  </option>
                ))}
              </select>
            </label>
            {content && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="confirm" required className="mt-0.5 size-4" />
                <span>Replace {content.storeName} with the copy</span>
              </label>
            )}
            <div>
              <SubmitButton variant={content ? "secondary" : undefined}>{content ? "Replace the content" : "Use this content"}</SubmitButton>
            </div>
          </ActionForm>
        )}
      </Card>
    </DesignShell>
  );
}
