import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { PhoneRow, PhoneRows } from "@/components/admin/phone-row";
import { ButtonLink, Card, Chip, PageHeader, buttonClass } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { PRIVATE_PASSWORD_MAX, PRIVATE_PASSWORD_MIN } from "@/lib/private-mode";
import { SETTINGS_WORDS } from "@/lib/admin-words/settings";
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
  const w = SETTINGS_WORDS[adminLangOf(current.account.adminLocale)].privateMode;
  const never = store.isTemplate || store.starter;
  const field = "rounded-md border border-line bg-card px-3 py-2";
  // A phone's row that leads elsewhere (round 48): the card's place from 640 px.
  const phoneLink = "flex min-h-14 items-center justify-between gap-3 border-b border-line bg-card px-4 py-2 sm:hidden";

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title={w.title} status={<Chip signal={store.privateMode ? "warning" : "positive"}>{store.privateMode ? w.chipPrivate : w.chipPublic}</Chip>} description={<><span className="sm:hidden">{w.phone.lead}</span><span className="max-sm:hidden">{w.description}</span></>} />

      <Card>
        <p className="text-body-strong text-ink">{never ? w.stateNever : store.privateMode ? w.statePrivate : w.statePublic}</p>
        {editor && !never && (
          <ActionForm action={setPrivateModeAction.bind(null, store.slug, !store.privateMode)} className="mt-4" successMessage={store.privateMode ? w.madePublic : w.madePrivate}>
            <SubmitButton variant={store.privateMode ? "primary" : "secondary"}>{store.privateMode ? w.makePublic : w.makePrivate}</SubmitButton>
          </ActionForm>
        )}
      </Card>

      {/* Round 48 (D756): on a phone the password, signing out, the landing page and the preview are rows of one card, each saying where it
          stands; the password opens by itself while the store is private. From 640 px the cards are as before. */}
      <PhoneRows>
      {!never && (
        <PhoneRow
          flat
          defaultOpen={store.privateMode && editor}
          title={w.password.title}
          sub={store.privatePassword ? w.phone.hasPassword : w.phone.noPassword}
          change={w.phone.change}
          done={w.phone.done}
        >
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
        </PhoneRow>
      )}

      {!never && store.privatePassword && editor && (
        <PhoneRow flat title={w.signOut.title} sub={w.phone.signOutSub} change={w.phone.open} done={w.phone.done}>
        <Card title={w.signOut.title} description={w.signOut.description}>
          <ActionForm action={signEveryoneOutAction.bind(null, store.slug)} successMessage={w.signOut.done}>
            <SubmitButton variant="secondary">{w.signOut.button}</SubmitButton>
          </ActionForm>
        </Card>
        </PhoneRow>
      )}

      {!never && (
        <>
          <a href={`/admin/${store.slug}/pages#special-pages`} className={phoneLink}>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-body text-ink">{w.landing.title}</span>
              <span className="text-caption text-ink-2">{w.phone.landingSub}</span>
            </span>
            <span className="shrink-0 text-sm font-medium text-ink underline underline-offset-2">{w.phone.choose}</span>
          </a>
          <div className="max-sm:hidden">
            <Card title={w.landing.title} description={w.landing.description}>
              <ButtonLink href={`/admin/${store.slug}/pages#special-pages`}>{w.landing.link}</ButtonLink>
            </Card>
          </div>
        </>
      )}

      <a href={`/api/private/preview?store=${encodeURIComponent(store.slug)}`} className={`${phoneLink} !border-b-0`}>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-body text-ink">{w.preview.title}</span>
          <span className="text-caption text-ink-2">{w.phone.previewSub}</span>
        </span>
        <span className="shrink-0 text-sm font-medium text-ink underline underline-offset-2">{w.phone.open}</span>
      </a>
      <div className="max-sm:hidden">
      <Card title={w.preview.title} description={w.preview.description}>
        {/* An address of the admin's API, followed as a page load (never a client navigation): it sets the pass and goes to the store. */}
        <a href={`/api/private/preview?store=${encodeURIComponent(store.slug)}`} className={buttonClass("secondary")} data-private-preview="">
          {w.preview.button}
        </a>
      </Card>
      </div>
      </PhoneRows>
    </div>
  );
}
