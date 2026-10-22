import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { requireFeature } from "@/components/admin/feature-off";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { categoryTree } from "@/lib/taxonomy";
import { requirePermission } from "@/server/permissions";
import { getPageForEdit } from "@/server/pages";
import { layoutUses } from "@/server/product-layouts";
import { listTerms } from "@/server/taxonomy";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { countWords, fillWords } from "@/lib/admin-fill";

import { assignLayoutAction } from "../../actions";

export const metadata: Metadata = { title: "Where a layout is used" };

/**
 * Where one of a store's product layouts (D79) is used: as the store's
 * standard, and for product categories (with those below them) and tags.
 * Single products choose theirs in the product editor.
 */
export default async function AssignLayoutPage({ params }: PageProps<"/admin/[store]/product-layouts/[pageId]/assign">) {
  const { store: storeSlug, pageId } = await params;
  const gated = await requirePermission(storeSlug, "products:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const w = adminText(adminLangOf(gated.account.adminLocale), "website").assignLayout;
  const layout = z.uuid().safeParse(pageId).success ? await getPageForEdit(store.id, pageId, "product_layout") : null;
  if (!layout) notFound();
  const [terms, uses] = await Promise.all([listTerms({ storeId: store.id, contentType: "product" }), layoutUses(store.id)]);
  const use = uses.get(layout.id) ?? { standard: false, categoryIds: [], tagIds: [], products: 0 };
  const others = [...uses.entries()].filter(([id]) => id !== layout.id);
  const otherFor = (termId: string) => others.some(([, u]) => u.categoryIds.includes(termId) || u.tagIds.includes(termId));
  const otherStandard = others.some(([, u]) => u.standard);
  const base = `/admin/${store.slug}/product-layouts`;
  const categories = categoryTree(terms);
  const tags = terms.filter((term) => term.kind === "tag");
  const check = (id: string, name: string, depth = 0) => (
    <label key={id} className="flex items-center gap-3 text-sm" style={{ paddingInlineStart: `${depth * 1.25}rem` }}>
      <input type="checkbox" name="term" value={id} defaultChecked={use.categoryIds.includes(id) || use.tagIds.includes(id)} className="size-4" />
      <span>
        {name}
        {otherFor(id) && <span className="text-muted">{w.otherLayout}</span>}
      </span>
    </label>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <PageHeader
          back={{ href: base, label: w.back }}
          title={fillWords(w.title, { title: layout.draft.title || w.untitled })}
          description={`${w.description}${use.products > 0 ? countWords(use.products, w.ownProducts) : ""}`}
        />
        {layout.state === "draft" && (
          <p role="note" className="mt-2 rounded-md bg-sunken p-3 text-sm">
            {w.notPublished}
          </p>
        )}
      </div>
      <ActionForm action={assignLayoutAction.bind(null, store.slug, layout.id)} className="flex flex-col gap-6">
        <fieldset className={`flex flex-col gap-2 p-5 ${CARD_CLASS}`}>
          <legend className="px-1 font-medium">{w.wholeStore}</legend>
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" name="standard" defaultChecked={use.standard} className="size-4" />
            <span>
              {w.standard}
              {otherStandard && <span className="text-muted">{w.replaces}</span>}
            </span>
          </label>
        </fieldset>
        <fieldset className={`flex flex-col gap-2 p-5 ${CARD_CLASS}`}>
          <legend className="px-1 font-medium">{w.categories}</legend>
          {categories.length === 0 ? (
            <p className="text-sm text-muted">{w.noCategories}</p>
          ) : (
            categories.map((category) => check(category.id, category.name, category.depth))
          )}
          <p className="text-xs text-muted">{w.categoryHint}</p>
        </fieldset>
        <fieldset className={`flex flex-col gap-2 p-5 ${CARD_CLASS}`}>
          <legend className="px-1 font-medium">{w.tags}</legend>
          {tags.length === 0 ? <p className="text-sm text-muted">{w.noTags}</p> : tags.map((tag) => check(tag.id, tag.name))}
        </fieldset>
        <div>
          <SubmitButton>{w.save}</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
