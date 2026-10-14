import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { Card } from "@/components/admin/ui";
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
}: {
  profiles: ProfileItem[];
  products: ChooserProduct[];
  canWrite: boolean;
  save: (profileId: string | null) => Action;
  remove: (profileId: string) => Action;
}) {
  const names = Object.fromEntries(profiles.map((p) => [p.id, p.name]));
  const general = products.filter((p) => p.profileId === null).length;
  return (
    <div className="flex flex-col gap-6">
      <Card title="General" description="Every product in no other profile. Methods price it in their General blocks.">
        <p className="text-sm text-ink-2">
          {general} {general === 1 ? "product" : "products"}.
        </p>
      </Card>
      {profiles.map((profile) => (
        <Card key={profile.id} title={profile.name} description={`${profile.products} ${profile.products === 1 ? "product" : "products"}.`}>
          <ActionForm action={save(profile.id)} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              Name
              <input name="name" required maxLength={60} defaultValue={profile.name} className={control} disabled={!canWrite} />
            </label>
            <ProductChooser products={products} chosen={products.filter((p) => p.profileId === profile.id).map((p) => p.id)} profileNames={names} self={profile.id} disabled={!canWrite} />
            {canWrite && (
              <div>
                <SubmitButton variant="secondary">Save profile</SubmitButton>
              </div>
            )}
          </ActionForm>
          {canWrite && (
            <ActionForm action={remove(profile.id)} className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <button type="submit" className="inline-flex h-8 items-center rounded-pill bg-danger-soft px-3 text-sm text-danger-text">
                Delete {profile.name}
              </button>
              <span className="text-sm text-muted">
                Its {profile.products} {profile.products === 1 ? "product moves" : "products move"} to General, and its rates are removed.
              </span>
            </ActionForm>
          )}
        </Card>
      ))}
      {canWrite &&
        (profiles.length >= PROFILES_MAX ? (
          <p className="text-sm text-muted">The store has {PROFILES_MAX} profiles, the most it can have.</p>
        ) : (
          <Card title="Add a profile" description="Then give it rates on each method's page. A method with no rate for a profile is not offered to a basket holding it.">
            <ActionForm action={save(null)} className="flex flex-col gap-4">
              <label className="flex flex-col gap-1 text-sm">
                Name
                <input name="name" required maxLength={60} placeholder="Bulky goods" className={control} />
              </label>
              <ProductChooser products={products} chosen={[]} profileNames={names} self={null} />
              <div>
                <SubmitButton>Add profile</SubmitButton>
              </div>
            </ActionForm>
          </Card>
        ))}
    </div>
  );
}
