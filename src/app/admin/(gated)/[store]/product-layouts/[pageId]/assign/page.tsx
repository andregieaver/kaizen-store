import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { requireFeature } from "@/components/admin/feature-off";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { categoryTree } from "@/lib/taxonomy";
import { requirePermission } from "@/server/permissions";
import { getPageForEdit } from "@/server/pages";
import { layoutUses } from "@/server/product-layouts";
import { listTerms } from "@/server/taxonomy";

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
        {otherFor(id) && <span className="text-muted"> (uses another layout; choosing this one replaces it)</span>}
      </span>
    </label>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href={base} className="w-fit text-sm underline">
          Product layouts
        </Link>
        <h1 className="text-2xl font-semibold">Where “{layout.draft.title || "Untitled"}” is used</h1>
        <p className="text-sm text-muted">
          A product&apos;s page uses its own layout if it has one (chosen in the product editor), else its nearest
          category&apos;s, else one of its tags&apos;, else the store&apos;s standard layout, else Kaizen&apos;s.
          {use.products > 0 && ` ${use.products === 1 ? "One product has" : `${use.products} products have`} this layout as its own.`}
        </p>
        {layout.state === "draft" && (
          <p role="note" className="mt-2 rounded-md bg-surface p-3 text-sm">
            This layout is not published yet: products start using it once it is.
          </p>
        )}
      </div>
      <ActionForm action={assignLayoutAction.bind(null, store.slug, layout.id)} className="flex flex-col gap-6">
        <fieldset className="flex flex-col gap-2 rounded-lg border border-border bg-background p-5">
          <legend className="px-1 font-medium">The whole store</legend>
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" name="standard" defaultChecked={use.standard} className="size-4" />
            <span>
              The store&apos;s standard layout, for products with none of their own or from their categories or tags
              {otherStandard && <span className="text-muted"> (replaces the one chosen now)</span>}
            </span>
          </label>
        </fieldset>
        <fieldset className="flex flex-col gap-2 rounded-lg border border-border bg-background p-5">
          <legend className="px-1 font-medium">Product categories</legend>
          {categories.length === 0 ? (
            <p className="text-sm text-muted">The store has no product categories yet.</p>
          ) : (
            categories.map((category) => check(category.id, category.name, category.depth))
          )}
          <p className="text-xs text-muted">A category&apos;s layout is also used for the categories below it that have none of their own.</p>
        </fieldset>
        <fieldset className="flex flex-col gap-2 rounded-lg border border-border bg-background p-5">
          <legend className="px-1 font-medium">Product tags</legend>
          {tags.length === 0 ? <p className="text-sm text-muted">The store has no product tags yet.</p> : tags.map((tag) => check(tag.id, tag.name))}
        </fieldset>
        <div>
          <SubmitButton>Save</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
