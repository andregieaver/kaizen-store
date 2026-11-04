import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AdminTextScope } from "@/components/admin/admin-text";
import { AppForm, RenewAppSecret } from "@/components/admin/developer-apps";
import { Card, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { OAUTH_PATHS, resourceUrl } from "@/lib/oauth";
import { siteUrl } from "@/lib/site";
import { requireAccount } from "@/server/auth";
import { ownApp } from "@/server/developer-apps";

import { renewAppSecretAction, updateAppAction } from "../actions";
import { appFormChoices } from "../app-form-data";

export const metadata: Metadata = { title: "App" };

/**
 * Account → Developer → an app (D441): its form, its credentials (the client ID; the client and events secrets renewed and shown once) and
 * how a store installs it. The app's page never names the stores it is installed on, only how many.
 */
export default async function AppPage({ params }: PageProps<"/admin/account/developer/[app]">) {
  await connection();
  const account = await requireAccount();
  const app = await ownApp(account.id, (await params).app);
  if (!app) notFound();
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "oauth").developer;
  const site = siteUrl();
  return (
    <AdminTextScope texts={adminTexts(lang, ["oauth"])}>
      <div className="flex flex-col gap-8">
        <PageHeader
          title={app.name}
          description={
            <>
              {w.distributions[app.distribution]} · {fillWords(w.installations, { n: String(app.installations) })}
              {app.listing ? ` · ${fillWords(w.listing[app.listing], { note: app.listingNote ?? "" })}` : ""}
              {app.blocked ? ` · ${w.blocked}` : ""}
            </>
          }
        />
        <Card title={w.credentials.title}>
          <div className="flex flex-col gap-4 text-sm">
            <div className="flex flex-col gap-1">
              <span className="font-medium text-ink">{w.credentials.clientId}</span>
              <code className="break-all font-mono text-xs text-ink">{app.clientId}</code>
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-medium text-ink">{w.credentials.secret}</span>
              <span className="text-muted">{w.credentials.secretHint}</span>
              <div>
                <RenewAppSecret renew={renewAppSecretAction.bind(null, app.id, "client")} label={w.credentials.renew} />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-medium text-ink">{w.credentials.eventsSecret}</span>
              <span className="text-muted">{w.credentials.eventsSecretHint}</span>
              <div>
                <RenewAppSecret renew={renewAppSecretAction.bind(null, app.id, "webhook")} label={w.credentials.renewEvents} />
              </div>
            </div>
          </div>
        </Card>
        <Card title={w.install.title}>
          <p className="text-sm text-ink-2">
            {fillWords(w.install.text, { authorize: `${site}${OAUTH_PATHS.authorize}`, resource: resourceUrl(site, "admin"), token: `${site}${OAUTH_PATHS.token}` })}{" "}
            <a href="/docs/developers/apps/build-an-app" className="underline">
              {w.install.docs}
            </a>
          </p>
        </Card>
        <Card>
          <AppForm
            isNew={false}
            initial={{
              name: app.name,
              description: app.description,
              logoUrl: app.logoUrl ?? "",
              homepageUrl: app.homepageUrl ?? "",
              privacyUrl: app.privacyUrl ?? "",
              supportEmail: app.supportEmail ?? "",
              redirectUris: app.redirectUris,
              scopes: app.scopes,
              distribution: app.distribution,
              webhookUrl: "",
              webhookHint: app.webhookHint,
              webhookTopics: app.webhookTopics,
            }}
            {...appFormChoices(lang)}
            save={updateAppAction.bind(null, app.id)}
          />
        </Card>
      </div>
    </AdminTextScope>
  );
}
