import type { FormState } from "@/components/admin/action-form";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { VAT_CATEGORY_DESCRIPTION_MAX, VAT_CATEGORY_NAME_MAX, type VatCategoryRow } from "@/lib/vat";

import { card, hint, input, label } from "./styles";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

/**
 * The VAT categories (D157): what owners choose for a product. The built-in ones (standard, exempt, accommodation) cannot be
 * renamed or switched off, and no category is ever deleted: a product keeps the one it has. Platform admins add more.
 */
export function CategoriesCard({
  categories,
  addAction,
  activeAction,
}: {
  categories: VatCategoryRow[];
  addAction: Action;
  /** Binds a category's code and the state to set. */
  activeAction: (code: string, active: boolean) => Action;
}) {
  return (
    <section aria-labelledby="categories" className={card}>
      <div>
        <h2 id="categories" className="font-medium">
          Categories
        </h2>
        <p className="text-sm text-muted">
          What an owner puts a product in to give it a country&apos;s reduced rate. A category with no rate for a country takes the standard rate there. Categories are never
          deleted: a product keeps the one it has, and a switched-off category cannot be chosen again.
        </p>
      </div>
      <ul className="flex flex-col divide-y divide-border text-sm">
        {categories.map((category) => (
          <li key={category.code} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2 first:pt-0">
            <span className="min-w-0 flex-1">
              <span className="font-medium">{category.nameEn}</span> <span className="font-mono text-xs text-muted">{category.code}</span>
              {category.builtIn && <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-xs text-muted">Built in</span>}
              {!category.active && <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-xs text-muted">Off</span>}
              {category.description && <span className="block text-muted">{category.description}</span>}
            </span>
            {!category.builtIn && (
              <ActionForm action={activeAction(category.code, !category.active)} successMessage={category.active ? "The category is off." : "The category is on."} className="flex flex-col gap-1">
                <SubmitButton variant="secondary">{category.active ? "Switch off" : "Switch on"}</SubmitButton>
              </ActionForm>
            )}
          </li>
        ))}
      </ul>
      <ActionForm action={addAction} successMessage="The category is added." className="flex flex-col gap-4 border-t border-border pt-4">
        <h3 className="text-sm font-medium">Add a category</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={label}>
            Code <span className={hint}>(lower-case letters, digits and underscores)</span>
            <input name="code" required pattern="[a-z][a-z0-9_]{1,30}" autoComplete="off" spellCheck={false} className={`${input} font-mono`} />
          </label>
          <label className={label}>
            Name <span className={hint}>(in English, shown to owners)</span>
            <input name="nameEn" required maxLength={VAT_CATEGORY_NAME_MAX} autoComplete="off" className={input} />
          </label>
          <label className={`${label} sm:col-span-2`}>
            Description
            <input name="description" maxLength={VAT_CATEGORY_DESCRIPTION_MAX} autoComplete="off" className={input} />
          </label>
          <label className={label}>
            Order in lists <span className={hint}>(lower comes first)</span>
            <input name="sort" type="number" inputMode="numeric" min={0} max={10000} defaultValue={100} className={`${input} sm:w-32`} />
          </label>
        </div>
        <div>
          <SubmitButton>Add the category</SubmitButton>
        </div>
      </ActionForm>
    </section>
  );
}
