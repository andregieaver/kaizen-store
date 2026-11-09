import type { Metadata } from "next";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Card, Chip, List, ListRow, PageHeader, RowLead } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { isApiPower } from "@/lib/admin-api";
import { LISTING_NOTE_MAX } from "@/lib/apps";
import { clientHost } from "@/lib/oauth";
import { scopeLabel } from "@/lib/oauth-words";
import { requirePlatformReader } from "@/server/auth";
import { listingRequests } from "@/server/developer-apps";

import { decideListingAction } from "./actions";

export const metadata: Metadata = { title: "App listings" };

/**
 * Kaizena Flow's review of apps that ask to be listed (wave 14 unit D3, D441): each with what it does, its developer, its addresses and
 * what it asks for in words, and *Approve* (with a note if any) or *Decline* (with the reason). Either is emailed to the developer and kept
 * on the app's page. The decided ones below, newest first.
 */
export default async function PlatformAppsPage() {
  await connection();
  const admin = await requirePlatformReader();
  const lang = adminLangOf(admin.adminLocale);
  const ow = adminText(lang, "oauth");
  const w = ow.platformApps;
  const powerWords = adminText(lang, "notifications").apiTokens.scopeWords;
  const [waiting, decided] = await Promise.all([listingRequests(admin, "requested"), listingRequests(admin, "decided")]);
  const when = (iso: string) => new Date(iso).toLocaleString(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "medium", timeZone: "Europe/Oslo" });
  const field = "min-h-10 rounded-md border border-line bg-card px-3 py-2 text-sm";
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={w.title} description={w.description} />
      <Card title={w.waiting}>
        {waiting.length === 0 ? (
          <p className="text-sm text-muted">{w.none}</p>
        ) : (
          <List label={w.waiting}>
            {waiting.map((app) => (
              <ListRow key={app.id}>
                <RowLead
                  title={app.name}
                  sub={
                    <span className="flex flex-col gap-2">
                      <span>{app.description || w.noDescription}</span>
                      <span>
                        {fillWords(w.by, { person: app.developer ? (app.developer.name ?? app.developer.email) : w.noDeveloper, when: when(app.createdAt) })} ·{" "}
                        {clientHost({ clientId: app.clientId, clientUri: app.homepageUrl, redirectUris: app.redirectUris })}
                        {app.homepageUrl ? ` · ${app.homepageUrl}` : ""}
                        {app.privacyUrl ? ` · ${app.privacyUrl}` : ` · ${w.noPrivacy}`}
                        {app.supportEmail ? ` · ${app.supportEmail}` : ""}
                      </span>
                      <span>
                        {w.asks}{" "}
                        {app.scopes
                          .filter((scope) => scope !== "stores:read")
                          .map((scope) => (isApiPower(scope) ? (powerWords[scope as keyof typeof powerWords] ?? scope) : scopeLabel(ow, scope)))
                          .join(" · ")}
                      </span>
                      {app.webhookHint && <span>{fillWords(w.events, { hint: app.webhookHint, topics: String(app.webhookTopics.length) })}</span>}
                      <span className="flex flex-wrap items-start gap-4">
                        <ActionForm action={decideListingAction.bind(null, app.id, "approved")} className="flex flex-col gap-1" successMessage={w.approved}>
                          <label className="flex flex-col gap-1 text-sm">
                            {w.note}
                            <textarea name="note" rows={2} maxLength={LISTING_NOTE_MAX} className={field} />
                          </label>
                          <SubmitButton>{w.approve}</SubmitButton>
                        </ActionForm>
                        <ActionForm action={decideListingAction.bind(null, app.id, "declined")} className="flex flex-col gap-1" successMessage={w.declined}>
                          <label className="flex flex-col gap-1 text-sm">
                            {w.reason}
                            <textarea name="note" rows={2} required maxLength={LISTING_NOTE_MAX} className={field} />
                          </label>
                          <SubmitButton variant="secondary">{w.decline}</SubmitButton>
                        </ActionForm>
                      </span>
                    </span>
                  }
                />
              </ListRow>
            ))}
          </List>
        )}
      </Card>
      {decided.length > 0 && (
        <Card title={w.decided}>
          <List label={w.decided}>
            {decided.map((app) => (
              <ListRow key={app.id}>
                <RowLead
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      {app.name}
                      <Chip signal={app.listing === "approved" ? "positive" : "neutral"}>{app.listing === "approved" ? w.approved : w.declined}</Chip>
                    </span>
                  }
                  sub={app.listingNote ?? ""}
                />
              </ListRow>
            ))}
          </List>
        </Card>
      )}
    </div>
  );
}
