import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { ButtonLink, Card, Chip, PageHeader, buttonClass } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { PRIVATE_PASSWORD_MAX, PRIVATE_PASSWORD_MIN } from "@/lib/private-mode";
import { memberCan, requirePermission } from "@/server/permissions";

import { setPrivateModeAction, setPrivatePasswordAction, signEveryoneOutAction } from "./actions";

export const metadata: Metadata = { title: "Private mode" };

/**
 * Private mode (wave 7 unit E, D339, `docs/wave-7-storefront.md` E): one line that says whether the store is private, one button that changes
 * it, then the password, signing everyone out, the landing page and a preview for staff. A new store is private until it opens.
 */
export default async function PrivateModePage({ params }: PageProps<"/admin/[store]/settings/private">) {
  const current = await requirePermission((await params).store, "settings:read");
  const { store } = current;
  const editor = memberCan(current, "settings:write");
  const w = adminText(adminLangOf(current.account.adminLocale), "settings").privateMode;
  const never = store.isTemplate || store.starter;
  const field = "rounded-md border border-line bg-card px-3 py-2";

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title={w.title} status={<Chip signal={store.privateMode ? "warning" : "positive"}>{store.privateMode ? w.chipPrivate : w.chipPublic}</Chip>} description={w.description} />

      <Card>
        <p className="text-body-strong text-ink">{never ? w.stateNever : store.privateMode ? w.statePrivate : w.statePublic}</p>
        {editor && !never && (
          <ActionForm action={setPrivateModeAction.bind(null, store.slug, !store.privateMode)} className="mt-4" successMessage={store.privateMode ? w.madePublic : w.madePrivate}>
            <SubmitButton variant={store.privateMode ? "primary" : "secondary"}>{store.privateMode ? w.makePublic : w.makePrivate}</SubmitButton>
          </ActionForm>
        )}
      </Card>

      {!never && (
        <Card title={w.password.title} description={w.password.description}>
          <p className="text-sm text-ink-2">{store.privatePassword ? w.password.has : w.password.none}</p>
          {editor && (
            <ActionForm action={setPrivatePasswordAction.bind(null, store.slug)} className="mt-4 flex flex-col gap-3" successMessage={w.password.saved}>
              <label className="flex flex-col gap-1 text-sm">
                {w.password.label}
                <input
                  type="password"
                  name="password"
                  autoComplete="new-password"
                  minLength={PRIVATE_PASSWORD_MIN}
                  maxLength={PRIVATE_PASSWORD_MAX}
                  required
                  aria-describedby="private-password-hint"
                  className={field}
                />
                <span id="private-password-hint" className="text-caption text-muted">
                  {w.password.hint}
                </span>
              </label>
              <div className="flex flex-wrap gap-2">
                <SubmitButton>{w.password.save}</SubmitButton>
                {store.privatePassword && (
                  <SubmitButton variant="secondary" name="remove" value="1" skipValidation>
                    {w.password.remove}
                  </SubmitButton>
                )}
              </div>
            </ActionForm>
          )}
        </Card>
      )}

      {!never && store.privatePassword && editor && (
        <Card title={w.signOut.title} description={w.signOut.description}>
          <ActionForm action={signEveryoneOutAction.bind(null, store.slug)} successMessage={w.signOut.done}>
            <SubmitButton variant="secondary">{w.signOut.button}</SubmitButton>
          </ActionForm>
        </Card>
      )}

      {!never && (
        <Card title={w.landing.title} description={w.landing.description}>
          <ButtonLink href={`/admin/${store.slug}/pages#special-pages`}>{w.landing.link}</ButtonLink>
        </Card>
      )}

      <Card title={w.preview.title} description={w.preview.description}>
        {/* An address of the admin's API, followed as a page load (never a client navigation): it sets the pass and goes to the store. */}
        <a href={`/api/private/preview?store=${encodeURIComponent(store.slug)}`} className={buttonClass("secondary")} data-private-preview="">
          {w.preview.button}
        </a>
      </Card>
    </div>
  );
}
