import type { FormState } from "@/components/admin/action-form";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { VAT_CATEGORY_DESCRIPTION_MAX, VAT_CATEGORY_NAME_MAX, type VatCategoryRow } from "@/lib/vat";

import { card, hint, input, label, VAT_EN, type VatWords } from "./styles";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

/**
 * The VAT categories (D157): what owners choose for a product. The built-in ones (standard, exempt, accommodation) cannot be
 * renamed or switched off, and no category is ever deleted: a product keeps the one it has. Platform admins add more.
 */
export function CategoriesCard({
  categories,
  addAction,
  activeAction,
  words = VAT_EN,
}: {
  categories: VatCategoryRow[];
  addAction: Action;
  /** Binds a category's code and the state to set. */
  activeAction: (code: string, active: boolean) => Action;
  words?: VatWords;
}) {
  const w = words.categories;
  return (
    <section aria-labelledby="categories" className={card}>
      <div>
        <h2 id="categories" className="text-title text-ink">
          {w.title}
        </h2>
        <p className="text-sm text-muted">{w.text}</p>
      </div>
      <ul className="flex flex-col divide-y divide-line text-sm">
        {categories.map((category) => (
          <li key={category.code} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2 first:pt-0">
            <span className="min-w-0 flex-1">
              <span className="font-medium">{category.nameEn}</span> <span className="font-mono text-xs text-muted">{category.code}</span>
              {category.builtIn && <span className="ml-2 rounded-full border border-line px-2 py-0.5 text-xs text-muted">{w.builtIn}</span>}
              {!category.active && <span className="ml-2 rounded-full border border-line px-2 py-0.5 text-xs text-muted">{w.off}</span>}
              {category.description && <span className="block text-muted">{category.description}</span>}
            </span>
            {!category.builtIn && (
              <ActionForm action={activeAction(category.code, !category.active)} successMessage={category.active ? w.isOff : w.isOn} className="flex flex-col gap-1">
                <SubmitButton variant="secondary">{category.active ? w.switchOff : w.switchOn}</SubmitButton>
              </ActionForm>
            )}
          </li>
        ))}
      </ul>
      <ActionForm action={addAction} successMessage={w.added} className="flex flex-col gap-4 border-t border-line pt-4">
        <h3 className="text-body-strong text-ink">{w.add}</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={label}>
            {w.code} <span className={hint}>{w.codeHint}</span>
            <input name="code" required pattern="[a-z][a-z0-9_]{1,30}" autoComplete="off" spellCheck={false} className={`${input} font-mono`} />
          </label>
          <label className={label}>
            {w.name} <span className={hint}>{w.nameHint}</span>
            <input name="nameEn" required maxLength={VAT_CATEGORY_NAME_MAX} autoComplete="off" className={input} />
          </label>
          <label className={`${label} sm:col-span-2`}>
            {w.description}
            <input name="description" maxLength={VAT_CATEGORY_DESCRIPTION_MAX} autoComplete="off" className={input} />
          </label>
          <label className={label}>
            {w.order} <span className={hint}>{w.orderHint}</span>
            <input name="sort" type="number" inputMode="numeric" min={0} max={10000} defaultValue={100} className={`${input} sm:w-32`} />
          </label>
        </div>
        <div>
          <SubmitButton>{w.addButton}</SubmitButton>
        </div>
      </ActionForm>
    </section>
  );
}
