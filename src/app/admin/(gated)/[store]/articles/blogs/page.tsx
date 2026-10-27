import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { ButtonLink, Card, Chip, List, ListRow, PageHeader, RowActions, RowFact, RowLead } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { BLOG_COMMENT_SETTINGS, BLOG_HANDLE_MAX, BLOG_TITLE_MAX, blogPath, blogTitle, feedPath, type Blog } from "@/lib/blogs";
import { t } from "@/lib/i18n";
import { languageName } from "@/lib/localization";
import { marketUrl } from "@/lib/paths";
import { articleCounts, blogsNow } from "@/server/blogs";
import { listPages } from "@/server/pages";
import { memberCan, requirePageTypeAccess } from "@/server/permissions";

import { deleteBlogAction, saveBlogAction } from "./actions";

export const metadata: Metadata = { title: "Blogs" };

const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";

/**
 * A store's blogs (wave 7 unit G, D341): the first at `/blog`, the others at `/blogs/{address}`, each with its own name per language, articles,
 * feed, comments setting and what its address shows. Homer sees his blogs and one form; the first blog's address never changes.
 */
export default async function BlogsPage({ params, searchParams }: PageProps<"/admin/[store]/articles/blogs">) {
  const current = await requirePageTypeAccess((await params).store, "article", "read");
  const { store } = current;
  const editor = memberCan(current, "website:write");
  const w = adminText(adminLangOf(current.account.adminLocale), "blog");
  const query = await searchParams;
  const [blogs, counts, pages] = await Promise.all([blogsNow(store.id), articleCounts(store.id), listPages(store.id)]);
  const main = store.localization.locales[0];
  const nameOf = (blog: Blog) => blogTitle(blog, main ?? "en", main, t(store.markets[0]?.lang ?? "en").blog);
  const market = store.markets[0];
  const site = (path: string) => (market ? marketUrl(store.slug, market.slug, path) : path);
  const base = `/admin/${store.slug}/articles`;
  const editing = blogs.find((b) => b.id === query.blog) ?? null;
  const published = pages.filter((p) => p.state !== "draft");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: base, label: w.blogs.back }}
        title={w.blogs.title}
        description={w.blogs.description}
        actions={
          <>
            <ButtonLink href={`${base}/authors`}>{w.links.authors}</ButtonLink>
            <ButtonLink href={`${base}/comments`}>{w.links.comments}</ButtonLink>
          </>
        }
      />
      <Card title={w.blogs.yours}>
        <List label={w.blogs.yours}>
          {blogs.map((blog) => (
            <ListRow key={blog.id}>
              <RowLead title={nameOf(blog)} sub={blogPath(blog)} />
              <RowFact>{countWords(counts.get(blog.id) ?? 0, w.blogs.articles)}</RowFact>
              {blog.main && <Chip>{w.blogs.first}</Chip>}
              <Chip signal={blog.comments === "off" ? "neutral" : "insight"}>{w.comments[blog.comments].label}</Chip>
              <RowActions>
                <a href={site(feedPath(blog))} className="text-sm underline">
                  {w.blogs.feed}
                </a>
                {editor && (
                  <ButtonLink kind="quiet" size="dense" href={`?blog=${blog.id}#blog-form`}>
                    {w.blogs.edit}
                  </ButtonLink>
                )}
              </RowActions>
            </ListRow>
          ))}
        </List>
      </Card>
      {editor && (
        <div id="blog-form">
          <Card title={editing ? fillWords(w.blogs.editing, { name: nameOf(editing) }) : w.blogs.add}>
            <ActionForm key={editing?.id ?? "new"} action={saveBlogAction.bind(null, store.slug)} className="flex max-w-2xl flex-col gap-4">
              {editing && <input type="hidden" name="id" value={editing.id} />}
              {store.localization.keptLocales.map((locale) => (
                <label key={locale} className="flex flex-col gap-1 text-sm font-medium">
                  {store.localization.keptLocales.length > 1 ? fillWords(w.blogs.nameIn, { language: languageName(locale) }) : w.blogs.name}
                  <input name={`title.${locale}`} defaultValue={editing?.titles[locale] ?? ""} maxLength={BLOG_TITLE_MAX} className={input} />
                </label>
              ))}
              <p className="text-caption text-muted">{w.blogs.nameHint}</p>
              {editing?.main ? (
                <p className="text-sm">{w.blogs.firstAddress}</p>
              ) : (
                <label className="flex flex-col gap-1 text-sm font-medium">
                  {w.blogs.handle}
                  <input name="handle" required defaultValue={editing?.handle ?? ""} maxLength={BLOG_HANDLE_MAX} pattern="[a-z0-9]+(-[a-z0-9]+)*" className={input} />
                  <span className="text-caption font-normal text-muted">{w.blogs.handleHint}</span>
                </label>
              )}
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium">{w.blogs.commentsLabel}</legend>
                {BLOG_COMMENT_SETTINGS.map((setting) => (
                  <label key={setting} className="flex items-start gap-2 text-sm">
                    <input type="radio" name="comments" value={setting} defaultChecked={(editing?.comments ?? "moderated") === setting} className="mt-0.5 size-4" />
                    <span>
                      {w.comments[setting].label}
                      <span className="block text-caption text-muted">{w.comments[setting].hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              {editing?.main ? (
                <p className="text-sm text-muted">{w.blogs.listingFirst}</p>
              ) : (
                <label className="flex flex-col gap-1 text-sm font-medium">
                  {w.blogs.listing}
                  <select name="listingPageId" defaultValue={editing?.listingPageId ?? ""} className={input}>
                    <option value="">{w.blogs.listingStandard}</option>
                    {published.map((page) => (
                      <option key={page.id} value={page.id}>
                        {page.title || page.slug}
                      </option>
                    ))}
                  </select>
                  <span className="text-caption font-normal text-muted">{w.blogs.listingHint}</span>
                </label>
              )}
              <div className="flex flex-wrap gap-2">
                <SubmitButton>{w.blogs.save}</SubmitButton>
                {editing && (
                  <ButtonLink kind="quiet" href="?">
                    {w.blogs.cancel}
                  </ButtonLink>
                )}
              </div>
            </ActionForm>
            {editing && !editing.main && (
              <ActionForm action={deleteBlogAction.bind(null, store.slug)} className="mt-4 border-t border-line pt-4">
                <input type="hidden" name="id" value={editing.id} />
                <SubmitButton variant="secondary">{w.blogs.remove}</SubmitButton>
              </ActionForm>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
