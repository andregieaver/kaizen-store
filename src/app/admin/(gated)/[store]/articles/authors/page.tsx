import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { AdminTextScope } from "@/components/admin/admin-text";
import { BlogAuthorForm } from "@/components/admin/blog-author-form";
import { ButtonLink, Card, List, ListRow, PageHeader, RowActions, RowLead } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { authorsNow } from "@/server/blogs";
import { uploadsEnabled } from "@/server/media";
import { memberCan, requirePageTypeAccess } from "@/server/permissions";

import { uploadImageAction } from "../../products/actions";
import { deleteAuthorAction, saveAuthorAction } from "../blogs/actions";

export const metadata: Metadata = { title: "Authors" };

/** The authors of a store's articles (wave 7 unit G, D341): chosen on an article, shown under it and named in its structured data. */
export default async function AuthorsPage({ params, searchParams }: PageProps<"/admin/[store]/articles/authors">) {
  const current = await requirePageTypeAccess((await params).store, "article", "read");
  const { store } = current;
  const editor = memberCan(current, "website:write");
  const lang = adminLangOf(current.account.adminLocale);
  const w = adminText(lang, "blog");
  const query = await searchParams;
  const authors = await authorsNow(store.id);
  const editing = authors.find((a) => a.id === query.author) ?? null;
  const base = `/admin/${store.slug}/articles`;

  return (
    <AdminTextScope texts={adminTexts(lang, ["blog", "website"])}>
      <div className="flex flex-col gap-6">
        <PageHeader
          back={{ href: `${base}/blogs`, label: w.links.blogs }}
          title={w.authors.title}
          description={w.authors.description}
        />
        <Card title={w.authors.yours}>
          {authors.length === 0 ? (
            <p className="text-sm text-muted">{w.authors.none}</p>
          ) : (
            <List label={w.authors.yours}>
              {authors.map((author) => (
                <ListRow key={author.id}>
                  <RowLead
                    title={author.name}
                    sub={author.bio ? author.bio.slice(0, 120) : undefined}
                    avatar={
                      author.picture ? (
                        // eslint-disable-next-line @next/next/no-img-element -- the store's own small picture
                        <img src={author.picture} alt="" className="size-10 rounded-full object-cover" />
                      ) : undefined
                    }
                  />
                  {editor && (
                    <RowActions>
                      <ButtonLink kind="quiet" size="dense" href={`?author=${author.id}#author-form`}>
                        {w.authors.edit}
                      </ButtonLink>
                    </RowActions>
                  )}
                </ListRow>
              ))}
            </List>
          )}
        </Card>
        {editor && (
          <div id="author-form">
            <Card title={editing ? fillWords(w.authors.editing, { name: editing.name }) : w.authors.add}>
              <BlogAuthorForm
                key={editing?.id ?? "new"}
                author={editing}
                upload={uploadsEnabled() ? uploadImageAction.bind(null, store.slug) : null}
                save={saveAuthorAction.bind(null, store.slug)}
                cancelHref="?"
              />
              {editing && (
                <ActionForm action={deleteAuthorAction.bind(null, store.slug)} className="mt-4 border-t border-line pt-4">
                  <input type="hidden" name="id" value={editing.id} />
                  <SubmitButton variant="secondary">{w.authors.remove}</SubmitButton>
                </ActionForm>
              )}
            </Card>
          </div>
        )}
      </div>
    </AdminTextScope>
  );
}
