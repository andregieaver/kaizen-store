import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { PasswordField } from "@/components/admin/password-field";
import { AppearanceField } from "@/components/admin/admin-colors";
import { SchemeField } from "@/components/admin/admin-scheme";
import { AdminViewProvider, AdminViewToggle } from "@/components/admin/admin-view";
import { AdminLanguageField, AdminTextProvider } from "@/components/admin/admin-text";
import { adminDate, PLATFORM_TIME_ZONE } from "@/lib/admin-date";
import { adminLangOf } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import { adminText, adminTexts } from "@/lib/admin-text";
import { ManageTwoStep } from "@/components/admin/two-step-panel";
import { AvatarPicker } from "@/components/avatar-picker";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { createClient } from "@/lib/supabase/server";
import { todayIn } from "@/lib/work-dates";
import { listStores, passMembership, requireAccount } from "@/server/auth";
import { memberCan } from "@/server/permissions";
import { pushDevicesOf, pushPublicKey } from "@/server/push";
import { PushSettings } from "@/components/admin/push-settings";
import { removePushAction, removePushDeviceAction, savePushAction } from "./push-actions";
import { PrivacyOfficerForm } from "@/components/admin/privacy-officer-form";
import { accountOfficer, officerCandidates, ownedAccount, storedChoice } from "@/server/privacy-officers";
import { avatarFor } from "@/server/avatars";
import { isOwner, kaizenLifeIdentity, kaizenLifeSignInOn } from "@/server/kaizen-life";
import { twoStepStatus } from "@/server/two-step";
import { buttonClass, ButtonLink, Field, PageHeader, TextInput } from "@/components/admin/ui";
import { QuietActionForm } from "@/components/admin/quiet-action-form";
import { NAME_MAX } from "@/lib/email-change";
import { pendingEmailChange } from "@/server/email-change";

import {
  accountAvatarAction,
  adminLangAction,
  adminSchemeAction,
  adminViewAction,
  changeNameAction,
  colorModeAction,
  connectKaizenLifeAction,
  disconnectKaizenLifeAction,
  regenerateRecoveryCodesAction,
  removeTwoStepAction,
  revokeAppAction,
  setAccountOfficerAction,
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
  const vw = adminText(lang, "shell").view;
  const ow = adminText(lang, "oauth");
  const query = await searchParams;
  const status = query["kaizen-life"];
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
  const [identity, grants] = await Promise.all([
    owner && kaizenLifeSignInOn() ? kaizenLifeIdentity(supabase) : null,
    owner ? supabase.auth.oauth.listGrants().then(({ data }) => data ?? [], () => []) : [],
  ]);
  // The data protection officer for every store the person's account owns (D763): its owner's choice.
  const ownAccount = await ownedAccount(account.id);
  const officer = ownAccount
    ? await Promise.all([storedChoice(ownAccount.id, null), officerCandidates(ownAccount.id, null), accountOfficer(ownAccount.id)]).then(([choice, people, current]) => ({ choice, people, current }))
    : null;
  const pw = adminText(lang, "privacyOfficer");
  // Name and email (D836): each with its Change; the email's waiting change is one line here, its details on the email page.
  const pending = await pendingEmailChange(account.id);
  const pf = w.profile;
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={w.title} description={fillWords(w.signedInAs, { who: account.name ? `${account.name} (${account.email})` : account.email })} />

      <section aria-labelledby="profile-heading" className="flex max-w-md flex-col gap-4">
        <h2 id="profile-heading" className="text-title text-ink">
          {pf.title}
        </h2>
        <div className="flex flex-col gap-2" data-profile="name">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col">
              <span className="text-sm text-muted">{pf.name}</span>
              <span className="text-body text-ink [overflow-wrap:anywhere]">{account.name ?? <span className="text-muted">{pf.noName}</span>}</span>
            </div>
          </div>
          <details>
            <summary aria-label={pf.changeName} className={`${buttonClass("secondary")} w-fit cursor-pointer list-none`}>
              {pf.change}
            </summary>
            <ActionForm action={changeNameAction} className="mt-3 flex flex-col gap-3">
              <Field label={pf.name} hint={pf.nameHint} required>
                {(control) => <TextInput name="name" defaultValue={account.name ?? ""} maxLength={NAME_MAX} autoComplete="name" full {...control} />}
              </Field>
              <div>
                <SubmitButton>{pf.saveName}</SubmitButton>
              </div>
            </ActionForm>
          </details>
        </div>
        <div className="flex flex-col gap-2" data-profile="email">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col">
              <span className="text-sm text-muted">{pf.email}</span>
              <span className="text-body text-ink [overflow-wrap:anywhere]">{account.email}</span>
            </div>
          </div>
          <ButtonLink href="/admin/account/email" aria-label={pf.changeEmail} className="w-fit">
            {pf.change}
          </ButtonLink>
          <p className="text-xs text-muted">{pf.emailHint}</p>
          {pending && (
            <p role="status" className="text-sm">
              {fillWords(pf.pending, { email: pending.email })}{" "}
              <Link href="/admin/account/email" className="underline underline-offset-2">
                {pf.seePending}
              </Link>
            </p>
          )}
        </div>
      </section>

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
        <AppearanceField saved={account.colorMode ?? "system"} save={colorModeAction} words={adminText(lang, "bookings").lookFields} />
      </section>

      <section aria-labelledby="scheme-heading" className="flex max-w-md flex-col gap-3">
        <h2 id="scheme-heading" className="text-title text-ink">
          {w.scheme}
        </h2>
        <p className="text-sm text-muted">{w.schemeHint}</p>
        <SchemeField saved={account.adminScheme ?? "meadow"} save={adminSchemeAction} words={adminText(lang, "bookings").lookFields} />
        <Link href="/admin/account/appearance" className="w-fit text-sm underline underline-offset-2">
          {w.allSchemes}
        </Link>
      </section>

      {/* Basic or Advanced (D454): the same choice as the switch at the top of a store's admin. */}
      <section aria-labelledby="view-heading" className="flex max-w-md flex-col gap-3">
        <h2 id="view-heading" className="text-title text-ink">
          {vw.label}
        </h2>
        <p className="text-sm text-muted">{vw.accountHint}</p>
        <AdminViewProvider saved={account.adminView ?? "basic"} save={adminViewAction}>
          <AdminViewToggle />
        </AdminViewProvider>
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

      {officer ? (
        <section aria-labelledby="officer-heading" id="privacy-officer" className="flex max-w-xl flex-col gap-3">
          <h2 id="officer-heading" className="text-title text-ink">
            {pw.title}
          </h2>
          <p className="text-sm text-muted">{pw.accountLead}</p>
          <PrivacyOfficerForm words={pw} action={setAccountOfficerAction} store={false} choice={officer.choice} people={officer.people} current={officer.current} />
        </section>
      ) : null}

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
              madeOn={todayIn(PLATFORM_TIME_ZONE)}
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
              <QuietActionForm action={disconnectKaizenLifeAction}>
                <button type="submit" className={smallButton}>
                  {w.lifeDisconnect}
                </button>
              </QuietActionForm>
            </>
          ) : (
            <>
              <p className="text-sm text-muted">
                {w.lifeHint}
              </p>
              <QuietActionForm action={connectKaizenLifeAction}>
                <button type="submit" className={smallButton}>
                  {w.lifeConnect}
                </button>
              </QuietActionForm>
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
                  <span className="block text-xs text-muted">{fillWords(w.since, { date: adminDate(PLATFORM_TIME_ZONE, String(grant.granted_at), "day", lang) })}</span>
                </span>
                <QuietActionForm action={revokeAppAction}>
                  <input type="hidden" name="client" value={grant.client.id} />
                  <button type="submit" className={smallButton}>
                    {w.remove}
                  </button>
                </QuietActionForm>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* AI assistants and apps connected through Kaizena Flow's sign-in (D439): everyone's own, staff too, who have no Account sidebar. */}
      <section aria-labelledby="connected-heading" className="flex max-w-md flex-col gap-3">
        <h2 id="connected-heading" className="text-title text-ink">
          {ow.connected.title}
        </h2>
        <p className="text-sm text-muted">{ow.connected.description}</p>
        <div>
          <Link href="/admin/account/connected" className={smallButton + " inline-flex items-center"}>
            {ow.connected.open}
          </Link>
        </div>
      </section>

      {/* Deleting one's own account (D377): the page says what goes, or why it cannot yet. */}
      <section aria-labelledby="erase-heading" className="flex max-w-md flex-col gap-3">
        <h2 id="erase-heading" className="text-title text-ink">
          {w.erase.sectionTitle}
        </h2>
        <p className="text-sm text-muted">{w.erase.sectionText}</p>
        <div>
          <Link href="/admin/account/delete" className={smallButton + " inline-flex items-center"}>
            {w.erase.open}
          </Link>
        </div>
      </section>
    </div>
  );
}
