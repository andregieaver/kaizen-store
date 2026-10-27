import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { ButtonLink, Card, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { SUBMISSION_LIMITS } from "@/lib/theme-submissions";
import { memberCan, requirePermission } from "@/server/permissions";
import { authoredThemes } from "@/server/theme-submissions";

import { submitThemeAction } from "./actions";

export const metadata: Metadata = { title: "Share this look as a theme" };

/**
 * Sharing the store's look as a theme (wave 7 unit J, D344, `docs/wave-7-storefront.md` J): one form that sends the live look for Kaizena
 * Flow to review, as a new theme or as an update of one the person is the author of. Their state is followed under Your themes.
 */
export default async function ShareLookPage({ params }: PageProps<"/admin/[store]/settings/design/share">) {
  const member = await requirePermission((await params).store, "website:read");
  const { store } = member;
  const w = adminText(adminLangOf(member.account.adminLocale), "design").share;
  const refusal = !memberCan(member, "website:write") ? w.readOnly : store.isTemplate || store.starter ? w.notHere : store.status !== "active" ? w.closed : null;
  const mine = refusal ? [] : (await authoredThemes(member.account.id)).filter((theme) => !theme.archived);
  const field = "rounded-md border border-line bg-card px-3 py-2";
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader back={{ href: `/admin/${store.slug}/settings/design`, label: adminText(adminLangOf(member.account.adminLocale), "design").page.title }} title={w.title} description={w.description} />
      {refusal ? (
        <Card>
          <p className="text-sm text-ink-2">{refusal}</p>
        </Card>
      ) : (
        <Card>
          <ActionForm action={submitThemeAction.bind(null, store.slug)} className="flex flex-col gap-4" successMessage={w.sent} replaceOnSuccess>
            {mine.length > 0 && (
              <label className="flex flex-col gap-1 text-sm">
                {w.as}
                <select name="as" defaultValue="new">
                  <option value="new">{w.asNew}</option>
                  {mine.map((theme) => (
                    <option key={theme.id} value={theme.id}>
                      {fillWords(w.asUpdate, { title: theme.title })}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex flex-col gap-1 text-sm">
              {w.name}
              <input name="title" maxLength={SUBMISSION_LIMITS.title} className={field} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {w.summary}
              <input name="summary" maxLength={SUBMISSION_LIMITS.summary} className={field} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {w.about}
              <textarea name="description" rows={4} maxLength={SUBMISSION_LIMITS.description} className={field} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {w.author}
              <input name="authorName" required maxLength={SUBMISSION_LIMITS.authorName} defaultValue={member.account.name ?? ""} aria-describedby="share-author-hint" className={field} />
              <span id="share-author-hint" className="text-caption text-muted">
                {w.authorHint}
              </span>
            </label>
            {mine.length > 0 && (
              <label className="flex flex-col gap-1 text-sm">
                {w.notes}
                <textarea name="notes" rows={3} maxLength={SUBMISSION_LIMITS.notes} aria-describedby="share-notes-hint" className={field} />
                <span id="share-notes-hint" className="text-caption text-muted">
                  {w.notesHint}
                </span>
              </label>
            )}
            <div>
              <SubmitButton>{w.submit}</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      )}
      <div>
        <ButtonLink href="/admin/account/themes">
          {w.yours}
        </ButtonLink>
      </div>
    </div>
  );
}
