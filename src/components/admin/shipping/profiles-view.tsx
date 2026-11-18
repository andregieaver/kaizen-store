import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { PhoneRow, PhoneRows } from "@/components/admin/phone-row";
import { Card } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { shippingEn, type ShippingMessages } from "@/lib/admin-messages/shipping.en";
import { PROFILES_MAX } from "@/lib/shipping-limits";

import { ProductChooser } from "./product-chooser";

/**
 * Shipping profiles (D237, `docs/wave-3-shipping-methods.md` 2.1): groups of products with rates of their own on each method. General is every
 * product in no profile. Each profile has its name and its products; deleting one moves its products to General and removes its rates.
 * Presentational: the page binds the actions.
 */

type Action = (state: FormState, form: FormData) => Promise<FormState>;

export type ProfileItem = { id: string; name: string; products: number };
export type ChooserProduct = { id: string; title: string; profileId: string | null; shipped: boolean };

const control = "min-h-10 w-full max-w-md rounded-md border border-line bg-card px-3 text-sm";

export function ProfilesView({
  profiles,
  products,
  canWrite,
  save,
  remove,
  words: w = shippingEn.profiles,
}: {
  profiles: ProfileItem[];
  products: ChooserProduct[];
  canWrite: boolean;
  save: (profileId: string | null) => Action;
  remove: (profileId: string) => Action;
  /** The view's words in the admin's language (D312 A8); English unless given. The product chooser reads its own. */
  words?: ShippingMessages["profiles"];
}) {
  const names = Object.fromEntries(profiles.map((p) => [p.id, p.name]));
  const general = products.filter((p) => p.profileId === null).length;
  const adding = canWrite && profiles.length < PROFILES_MAX;
  // Round 49 (D762): on a phone General, each profile and adding one are rows of one card; a profile's or a new one's form opens under it.
  return (
    <div className="flex flex-col gap-6">
      <PhoneRows>
      <div className={`flex min-h-14 flex-col justify-center gap-0.5 bg-card px-4 py-2 sm:hidden ${profiles.length === 0 && !adding ? "" : "border-b border-line"}`}>
        <span className="text-body text-ink">{w.general}</span>
        <span className="text-caption text-ink-2">{`${countWords(general, w.products).replace(/\.$/, "")} · ${w.phone.generalSub}`}</span>
      </div>
      <div className="max-sm:hidden">
        <Card title={w.general} description={w.generalDescription}>
          <p className="text-sm text-ink-2">{countWords(general, w.products)}</p>
        </Card>
      </div>
      {profiles.map((profile, i) => (
        <PhoneRow key={profile.id} flat last={i === profiles.length - 1 && !adding} title={profile.name} sub={countWords(profile.products, w.products)} change={w.phone.change} done={w.phone.done}>
        <Card title={profile.name} description={countWords(profile.products, w.products)}>
          <ActionForm action={save(profile.id)} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              {w.name}
              <input name="name" required maxLength={60} defaultValue={profile.name} className={control} disabled={!canWrite} />
            </label>
            <ProductChooser products={products} chosen={products.filter((p) => p.profileId === profile.id).map((p) => p.id)} profileNames={names} self={profile.id} disabled={!canWrite} />
            {canWrite && (
              <div>
                <SubmitButton variant="secondary">{w.save}</SubmitButton>
              </div>
            )}
          </ActionForm>
          {canWrite && (
            <ActionForm action={remove(profile.id)} className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <button type="submit" className="inline-flex h-8 items-center rounded-pill bg-danger-soft px-3 text-sm text-danger-text">
                {fillWords(w.delete, { name: profile.name })}
              </button>
              <span className="text-sm text-muted">{countWords(profile.products, w.deleteNote)}</span>
            </ActionForm>
          )}
        </Card>
        </PhoneRow>
      ))}
      {canWrite &&
        (profiles.length >= PROFILES_MAX ? (
          <p className="text-sm text-muted">{fillWords(w.full, { max: PROFILES_MAX })}</p>
        ) : (
          <PhoneRow flat last title={w.addTitle} sub={w.phone.addSub} change={w.phone.open} done={w.phone.close}>
          <Card title={w.addTitle} description={w.addDescription}>
            <ActionForm action={save(null)} className="flex flex-col gap-4">
              <label className="flex flex-col gap-1 text-sm">
                {w.name}
                <input name="name" required maxLength={60} placeholder={w.namePlaceholder} className={control} />
              </label>
              <ProductChooser products={products} chosen={[]} profileNames={names} self={null} />
              <div>
                <SubmitButton>{w.add}</SubmitButton>
              </div>
            </ActionForm>
          </Card>
          </PhoneRow>
        ))}
      </PhoneRows>
      <p className="px-0.5 text-caption text-muted sm:hidden">{w.phone.sum}</p>
    </div>
  );
}
