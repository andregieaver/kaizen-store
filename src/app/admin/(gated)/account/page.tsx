import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { PasswordField } from "@/components/admin/password-field";
import { AppearanceField } from "@/components/admin/admin-colors";
import { AvatarPicker } from "@/components/avatar-picker";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/server/auth";
import { avatarFor } from "@/server/avatars";
import { isOwner, kaizenLifeIdentity, kaizenLifeSignInOn } from "@/server/kaizen-life";
import { lifeLink, lifeLinkOn } from "@/server/kaizen-life-link";

import {
  accountAvatarAction,
  colorModeAction,
  connectKaizenLifeAction,
  connectLifeAssistantAction,
  disconnectKaizenLifeAction,
  disconnectLifeAssistantAction,
  revokeAppAction,
  setPasswordAction,
} from "./actions";

export const metadata: Metadata = { title: "Your account" };

const smallButton = "min-h-10 rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-surface";

export default async function AccountPage({ searchParams }: PageProps<"/admin/account">) {
  const account = await requireAccount();
  const query = await searchParams;
  const status = query["kaizen-life"];
  const assistantStatus = query["life-assistant"];
  const owner = await isOwner(account);
  const supabase = await createClient();
  const [identity, grants, link] = await Promise.all([
    owner && kaizenLifeSignInOn() ? kaizenLifeIdentity(supabase) : null,
    owner ? supabase.auth.oauth.listGrants().then(({ data }) => data ?? [], () => []) : [],
    owner && lifeLinkOn() ? lifeLink(account.id) : null,
  ]);
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Your account</h1>
        <p className="text-sm text-muted">
          Signed in as {account.name ? `${account.name} (${account.email})` : account.email}.
        </p>
      </div>

      <section aria-labelledby="picture-heading" className="flex max-w-md flex-col gap-3">
        <h2 id="picture-heading" className="font-medium">
          Profile picture
        </h2>
        <AvatarPicker
          avatar={avatarFor(account)}
          ownPicture={Boolean(account.avatarPath)}
          action={accountAvatarAction}
          labels={{
            choose: "Choose a picture",
            change: "Change picture",
            remove: "Remove picture",
            working: "Saving …",
            hint: "Shown to you and to the people you work with. Without a picture of your own, your Gravatar is shown if your email has one, else your initials.",
            unreadable: "That file could not be read as a picture. Use a JPEG, PNG, WebP or AVIF.",
          }}
        />
      </section>

      <section aria-labelledby="appearance-heading" className="flex max-w-md flex-col gap-3">
        <h2 id="appearance-heading" className="font-medium">
          Light or dark
        </h2>
        <p className="text-sm text-muted">How the admin looks for you. Your stores keep the colours set under Design.</p>
        <AppearanceField saved={account.colorMode ?? "system"} save={colorModeAction} />
      </section>

      <section aria-labelledby="password-heading" className="flex max-w-md flex-col gap-3">
        <h2 id="password-heading" className="font-medium">
          Password
        </h2>
        <p className="text-sm text-muted">
          Set a password to sign in without waiting for an email. You can still use a sign-in
          link whenever you like.
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
            label="New password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            hint={`At least ${MIN_PASSWORD_LENGTH} characters. A few unrelated words make a strong, memorable password.`}
          />
          <div>
            <SubmitButton>Save password</SubmitButton>
          </div>
        </ActionForm>
      </section>

      {owner && kaizenLifeSignInOn() && (
        <section aria-labelledby="kaizen-life-heading" className="flex max-w-md flex-col gap-3">
          <h2 id="kaizen-life-heading" className="font-medium">
            Kaizen Life
          </h2>
          {status === "failed" && (
            <p role="alert" className="text-sm">
              That did not go through. Try again.
            </p>
          )}
          {identity ? (
            <>
              <p className="text-sm">
                Connected{typeof identity.identity_data?.email === "string" ? ` as ${identity.identity_data.email}` : ""}: you can sign in here with
                your Kaizen Life account.
              </p>
              <form action={disconnectKaizenLifeAction}>
                <button type="submit" className={smallButton}>
                  Disconnect Kaizen Life
                </button>
              </form>
            </>
          ) : (
            <>
              <p className="text-sm text-muted">
                Connect your Kaizen Life account to sign in here with it, even if it uses another email address.
              </p>
              <form action={connectKaizenLifeAction}>
                <button type="submit" className={smallButton}>
                  Connect Kaizen Life
                </button>
              </form>
            </>
          )}
        </section>
      )}

      {owner && lifeLinkOn() && (
        <section aria-labelledby="life-assistant-heading" className="flex max-w-md flex-col gap-3">
          <h2 id="life-assistant-heading" className="font-medium">
            Kaizen Life for your assistant
          </h2>
          {assistantStatus === "failed" && (
            <p role="alert" className="text-sm">
              Kaizen Life was not connected. Try again.
            </p>
          )}
          {link ? (
            <>
              <p className="text-sm">
                Connected{link.email ? ` as ${link.email}` : ""}: your store assistant can ask your Kaizen Life assistant about
                your calendar, tasks and plans when you ask it to.
              </p>
              <form action={disconnectLifeAssistantAction}>
                <button type="submit" className={smallButton}>
                  Disconnect it from your assistant
                </button>
              </form>
            </>
          ) : (
            <>
              <p className="text-sm text-muted">
                Let your store assistant ask your Kaizen Life assistant about your calendar, tasks and plans. Kaizen Life asks
                you first, and your store works just the same without it.
              </p>
              <form action={connectLifeAssistantAction}>
                <button type="submit" className={smallButton}>
                  Connect it to your assistant
                </button>
              </form>
            </>
          )}
        </section>
      )}

      {grants.length > 0 && (
        <section aria-labelledby="apps-heading" className="flex max-w-md flex-col gap-3">
          <h2 id="apps-heading" className="font-medium">
            Apps you sign in to with Kaizen Store
          </h2>
          <ul className="flex flex-col gap-2">
            {grants.map((grant) => (
              <li key={grant.client.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm">
                <span>
                  {grant.client.name || "An app"}
                  <span className="block text-xs text-muted">Since {new Date(grant.granted_at).toLocaleDateString("en-GB", { dateStyle: "medium" })}</span>
                </span>
                <form action={revokeAppAction}>
                  <input type="hidden" name="client" value={grant.client.id} />
                  <button type="submit" className={smallButton}>
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
