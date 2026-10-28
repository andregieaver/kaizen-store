import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { PasswordField } from "@/components/admin/password-field";
import { AppearanceField } from "@/components/admin/admin-colors";
import { SchemeField } from "@/components/admin/admin-scheme";
import { AdminLanguageField, AdminTextProvider } from "@/components/admin/admin-text";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import { adminText, adminTexts } from "@/lib/admin-text";
import { ManageTwoStep } from "@/components/admin/two-step-panel";
import { AvatarPicker } from "@/components/avatar-picker";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { createClient } from "@/lib/supabase/server";
import { listStores, passMembership, requireAccount } from "@/server/auth";
import { memberCan } from "@/server/permissions";
import { pushDevicesOf, pushPublicKey } from "@/server/push";
import { PushSettings } from "@/components/admin/push-settings";
import { removePushAction, removePushDeviceAction, savePushAction } from "./push-actions";
import { avatarFor } from "@/server/avatars";
import { isOwner, kaizenLifeIdentity, kaizenLifeSignInOn } from "@/server/kaizen-life";
import { lifeLink, lifeLinkOn } from "@/server/kaizen-life-link";
import { twoStepStatus } from "@/server/two-step";
import { PageHeader } from "@/components/admin/ui";

import {
  accountAvatarAction,
  adminLangAction,
  adminSchemeAction,
  colorModeAction,
  connectKaizenLifeAction,
  connectLifeAssistantAction,
  disconnectKaizenLifeAction,
  disconnectLifeAssistantAction,
  regenerateRecoveryCodesAction,
  removeTwoStepAction,
  revokeAppAction,
  setPasswordAction,
} from "./actions";

export const metadata: Metadata = { title: "Your account" };

const smallButton = "min-h-10 rounded-pill border border-edge bg-card px-4 text-sm font-medium hover:bg-sunken";

export default async function AccountPage({ searchParams }: PageProps<"/admin/account">) {
  const account = await requireAccount();
  // The admin's language for this account (D312 A0): the Language section's words are already in it.
  const lang = adminLangOf(account.adminLocale);
  const words = adminText(lang, "common").language;
  const w = adminText(lang, "bookings").account;
  const dateLocale = lang === "en" ? "en-GB" : ADMIN_LANG_FACTS[lang].locale;
  const query = await searchParams;
  const status = query["kaizen-life"];
  const assistantStatus = query["life-assistant"];
  const owner = await isOwner(account);
  const supabase = await createClient();
  const twoStep = await twoStepStatus(account);
  // The stores whose orders this person reads, each a switch for notifications on this device (D361).
  const [pushStores, pushDevices] = await Promise.all([
    listStores(account).then(async (stores) => {
      const read = await Promise.all(stores.map(async (s) => ({ s, member: await passMembership(s.slug, account.id) })));
      return read.filter(({ member }) => member && memberCan(member, "orders:read")).map(({ s, member }) => ({ slug: s.slug, id: member!.store.id, name: s.name }));
    }),
    pushDevicesOf(account.id),
  ]);
  const [identity, grants, link] = await Promise.all([
    owner && kaizenLifeSignInOn() ? kaizenLifeIdentity(supabase) : null,
    owner ? supabase.auth.oauth.listGrants().then(({ data }) => data ?? [], () => []) : [],
    owner && lifeLinkOn() ? lifeLink(account.id) : null,
  ]);
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={w.title} description={fillWords(w.signedInAs, { who: account.name ? `${account.name} (${account.email})` : account.email })} />

      <section aria-labelledby="picture-heading" className="flex max-w-md flex-col gap-3">
        <h2 id="picture-heading" className="text-title text-ink">
          {w.picture}
        </h2>
        <AvatarPicker
          avatar={avatarFor(account)}
          ownPicture={Boolean(account.avatarPath)}
          action={accountAvatarAction}
          labels={{
            choose: w.choose,
            change: w.change,
            remove: w.removePicture,
            working: w.saving,
            hint: w.pictureHint,
            unreadable: w.unreadable,
          }}
        />
      </section>

      <section aria-labelledby="language-heading" className="flex max-w-md flex-col gap-3">
        <h2 id="language-heading" className="text-title text-ink">
          {words.title}
        </h2>
        <p className="text-sm text-muted">{words.description}</p>
        <AdminLanguageField save={adminLangAction} />
        {lang !== "en" && <p className="text-xs text-muted">{words.partly}</p>}
      </section>

      <section aria-labelledby="appearance-heading" className="flex max-w-md flex-col gap-3">
        <h2 id="appearance-heading" className="text-title text-ink">
          {w.mode}
        </h2>
        <p className="text-sm text-muted">{w.modeHint}</p>
        <AppearanceField saved={account.colorMode ?? "system"} save={colorModeAction} />
      </section>

      <section aria-labelledby="scheme-heading" className="flex max-w-md flex-col gap-3">
        <h2 id="scheme-heading" className="text-title text-ink">
          {w.scheme}
        </h2>
        <p className="text-sm text-muted">{w.schemeHint}</p>
        <SchemeField saved={account.adminScheme ?? "meadow"} save={adminSchemeAction} />
        <Link href="/admin/account/appearance" className="w-fit text-sm underline underline-offset-2">
          {w.allSchemes}
        </Link>
      </section>

      {owner && (
        <section aria-labelledby="usage-heading" className="flex max-w-md flex-col gap-3">
          <h2 id="usage-heading" className="text-title text-ink">
            {w.usage}
          </h2>
          <p className="text-sm text-muted">{w.usageHint}</p>
          <Link href="/admin/account/usage" className={`${smallButton} inline-flex w-fit items-center`}>
            {w.seeUsage}
          </Link>
        </section>
      )}

      <section aria-labelledby="password-heading" className="flex max-w-md flex-col gap-3">
        <h2 id="password-heading" className="text-title text-ink">
          {w.password}
        </h2>
        <p className="text-sm text-muted">
          {w.passwordHint}
        </p>
        <ActionForm action={setPasswordAction} replaceOnSuccess className="flex flex-col gap-3">
          {/* Lets password managers save the new password with the right email. */}
          <input
            type="email"
            name="username"
            autoComplete="username"
            value={account.email}
            readOnly
            hidden
          />
          <PasswordField
            label={w.newPassword}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            hint={fillWords(w.passwordRule, { n: MIN_PASSWORD_LENGTH })}
          />
          <div>
            <SubmitButton>{w.savePassword}</SubmitButton>
          </div>
        </ActionForm>
      </section>

      <section aria-labelledby="two-step-heading" className="flex max-w-md flex-col gap-3">
        <h2 id="two-step-heading" className="text-title text-ink">
          {w.twoStep}
        </h2>
        {twoStep ? (
          // Its words are the sign-in area's (D312 A1), handed down here only.
          <AdminTextProvider lang={lang} texts={adminTexts(lang, ["common", "signIn"])}>
            <ManageTwoStep
              enrolled={twoStep.enrolled}
              codesLeft={twoStep.codesLeft}
              platformAdmin={account.platformAdmin}
              recoveryAvailable={twoStep.recoveryAvailable}
              setUpHref="/admin/sign-in/two-step/set-up?next=/admin/account"
              account={account.email}
              madeOn={new Date().toISOString().slice(0, 10)}
              regenerate={regenerateRecoveryCodesAction}
              remove={removeTwoStepAction}
            />
          </AdminTextProvider>
        ) : (
          <p className="text-sm text-muted">{w.twoStepAgain}</p>
        )}
      </section>

      {/* Notifications on this device (D361): the stores whose orders this person reads. */}
      <div className="max-w-2xl">
        <PushSettings
          publicKey={pushPublicKey()}
          stores={pushStores}
          devices={pushDevices.map((d) => ({ id: d.id, storeId: d.storeId, storeName: d.storeName, device: d.device, endpoint: d.endpoint }))}
          actions={{ save: savePushAction, remove: removePushAction, removeDevice: removePushDeviceAction }}
        />
      </div>

      {owner && kaizenLifeSignInOn() && (
        <section aria-labelledby="kaizen-life-heading" className="flex max-w-md flex-col gap-3">
          <h2 id="kaizen-life-heading" className="text-title text-ink">
            Kaizen Life
          </h2>
          {status === "failed" && (
            <p role="alert" className="text-sm">
              {w.failed}
            </p>
          )}
          {identity ? (
            <>
              <p className="text-sm">
                {fillWords(w.lifeConnected, { as: typeof identity.identity_data?.email === "string" ? fillWords(w.as, { email: identity.identity_data.email }) : "" })}
              </p>
              <form action={disconnectKaizenLifeAction}>
                <button type="submit" className={smallButton}>
                  {w.lifeDisconnect}
                </button>
              </form>
            </>
          ) : (
            <>
              <p className="text-sm text-muted">
                {w.lifeHint}
              </p>
              <form action={connectKaizenLifeAction}>
                <button type="submit" className={smallButton}>
                  {w.lifeConnect}
                </button>
              </form>
            </>
          )}
        </section>
      )}

      {owner && lifeLinkOn() && (
        <section aria-labelledby="life-assistant-heading" className="flex max-w-md flex-col gap-3">
          <h2 id="life-assistant-heading" className="text-title text-ink">
            {w.assistant}
          </h2>
          {assistantStatus === "failed" && (
            <p role="alert" className="text-sm">
              {w.assistantFailed}
            </p>
          )}
          {link ? (
            <>
              <p className="text-sm">
                {fillWords(w.assistantConnected, { as: link.email ? fillWords(w.as, { email: link.email }) : "" })}
              </p>
              <form action={disconnectLifeAssistantAction}>
                <button type="submit" className={smallButton}>
                  {w.assistantDisconnect}
                </button>
              </form>
            </>
          ) : (
            <>
              <p className="text-sm text-muted">
                {w.assistantHint}
              </p>
              <form action={connectLifeAssistantAction}>
                <button type="submit" className={smallButton}>
                  {w.assistantConnect}
                </button>
              </form>
            </>
          )}
        </section>
      )}

      {grants.length > 0 && (
        <section aria-labelledby="apps-heading" className="flex max-w-md flex-col gap-3">
          <h2 id="apps-heading" className="text-title text-ink">
            {w.apps}
          </h2>
          <ul className="flex flex-col gap-2">
            {grants.map((grant) => (
              <li key={grant.client.id} className="flex items-center justify-between gap-3 rounded-md border border-line p-3 text-sm">
                <span>
                  {grant.client.name || w.anApp}
                  <span className="block text-xs text-muted">{fillWords(w.since, { date: new Date(grant.granted_at).toLocaleDateString(dateLocale, { dateStyle: "medium" }) })}</span>
                </span>
                <form action={revokeAppAction}>
                  <input type="hidden" name="client" value={grant.client.id} />
                  <button type="submit" className={smallButton}>
                    {w.remove}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
