import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireFeature } from "@/components/admin/feature-off";
import { languageLabel } from "@/components/admin/notifications/language-label";
import { NotificationEditor, type EditorLanguage } from "@/components/admin/notifications/notification-editor";
import { notificationWords } from "@/components/admin/notifications/notification-list";
import { AdminTextScope } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { Chip, PageHeader } from "@/components/admin/ui";
import { notificationFromPath, notificationOf } from "@/lib/notifications";
import { getTemplate, listNotifications, previewNotification } from "@/server/notifications";
import { memberCan, requirePermission } from "@/server/permissions";

import { previewNotificationAction, resetTemplateAction, saveTemplateAction, sendTestNotificationAction } from "../actions";

export const metadata: Metadata = { title: "Edit a customer email" };

/**
 * One customer email (wave 3, D238, `docs/wave-3-notifications.md` 2.1 points 2 to 6): its words per language of the store beside a preview with a sample
 * order. `settings:read` sees it and previews; `settings:write` saves, resets and sends a test (each action asks again). An address that names no email of
 * the catalogue is a 404.
 */
export default async function NotificationEditorPage({ params, searchParams }: PageProps<"/admin/[store]/settings/notifications/[notification]">) {
  const { store: slug, notification: segment } = await params;
  const member = await requirePermission(slug, "settings:read");
  const shopOff = requireFeature(member, "shop");
  if (shopOff) return shopOff;
  const id = notificationFromPath(segment);
  const def = id ? notificationOf(id) : null;
  if (!id || !def) notFound();
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const words = adminText(lang, "notifications");
  const shown = notificationWords(def, words);
  const display = ADMIN_LANG_FACTS[lang].tag;
  const item = (await listNotifications(store.id)).find((n) => n.def.id === id);
  const langs = (item?.languages ?? []).filter((l) => l.offered || l.own);
  const languages: EditorLanguage[] = (
    await Promise.all(
      langs.map(async (l) => {
        const [saved, preview] = await Promise.all([def.editable ? getTemplate(store.id, id, l.lang) : null, previewNotification(store.id, id, l.lang)]);
        if (!preview) return null;
        return { language: { lang: l.lang, label: languageLabel(l.lang, display), offered: l.offered, saved, standard: preview.standard }, preview };
      }),
    )
  )
    .filter((x) => x !== null)
    .map((x) => x.language);
  const asked = (await searchParams).lang;
  const initialLang = typeof asked === "string" && languages.some((l) => l.lang === asked) ? asked : (languages.find((l) => l.offered)?.lang ?? languages[0]?.lang ?? "en");
  const first = await previewNotification(store.id, id, initialLang);
  const canWrite = memberCan(member, "settings:write");
  const status = item?.status ?? "on";
  return (
    <AdminTextScope texts={adminTexts(lang, ["notifications"])}>
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: `/admin/${store.slug}/settings/notifications`, label: words.emails.title }}
        title={shown.label}
        status={<Chip signal={status === "off" ? "neutral" : status === "on" ? "positive" : "insight"} dot>{words.emails.status[status]}</Chip>}
        description={
          <>
            {shown.when}
            {def.required && shown.why ? ` ${fillWords(words.emails.alwaysSent, { why: shown.why })}` : ""}
          </>
        }
      />
      <NotificationEditor
        id={id}
        languages={languages}
        initialLang={initialLang}
        initialPreview={first ? { subject: first.email.subject, html: first.email.html } : null}
        actions={{
          preview: previewNotificationAction.bind(null, store.slug, id),
          save: canWrite && def.editable ? saveTemplateAction.bind(null, store.slug, id) : null,
          reset: canWrite && def.editable ? resetTemplateAction.bind(null, store.slug, id) : null,
          test: canWrite ? sendTestNotificationAction.bind(null, store.slug, id) : null,
        }}
      />
    </div>
    </AdminTextScope>
  );
}
