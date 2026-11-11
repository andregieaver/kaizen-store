"use client";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { useAdminText } from "@/components/admin/admin-text";
import type { ProductSettings } from "@/lib/shop-tiles";

/** The store's product settings (D557): two switches for what a product's tile shows. Works without a script; the server saves them. */
export function ProductSettingsForm({
  settings,
  canEdit,
  action,
}: {
  settings: ProductSettings;
  canEdit: boolean;
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const w = useAdminText("products").settings;
  return (
    <ActionForm action={action} successMessage={w.saved} className="flex flex-col gap-6">
      <fieldset disabled={!canEdit} className="contents">
        <section aria-labelledby="tiles" className="flex flex-col gap-4 rounded-lg border border-line bg-card p-5">
          <h2 id="tiles" className="text-title text-ink">
            {w.tilesTitle}
          </h2>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="tileStock" defaultChecked={settings.tileStock} className="mt-0.5 size-4" />
            <span>
              <span className="font-medium">{w.stock}</span>
              <span className="block text-muted">{w.stockHint}</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="tileQuantity" defaultChecked={settings.tileQuantity} className="mt-0.5 size-4" />
            <span>
              <span className="font-medium">{w.quantity}</span>
              <span className="block text-muted">{w.quantityHint}</span>
            </span>
          </label>
        </section>
      </fieldset>
      {canEdit ? (
        <div>
          <SubmitButton>{w.save}</SubmitButton>
        </div>
      ) : (
        <p className="text-sm text-muted">{w.readOnly}</p>
      )}
    </ActionForm>
  );
}
