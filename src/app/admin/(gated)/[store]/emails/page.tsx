import type { Metadata } from "next";

import { EmailLog } from "@/components/admin/email-log";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { requirePermission } from "@/server/permissions";
import { listEmails } from "@/server/email";
import { Card, PageHeader } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Emails" };

/** The emails the store has sent its customers (D26). */
export default async function StoreEmailsPage({ params }: PageProps<"/admin/[store]/emails">) {
  const member = await requirePermission((await params).store, "orders:read");
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const words = adminText(lang, "notifications");
  const emails = await listEmails({ storeId: store.id, limit: 200 });
  // By day, as the platform's (round 16, D650).
  const drawnAt = new Date();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={words.log.title} />
      <Card compact>
        <EmailLog timeZone={store.timeZone} emails={emails} base={`/admin/${store.slug}/emails`} locale={ADMIN_LANG_FACTS[lang].locale} words={words} now={drawnAt.getTime()} />
      </Card>
    </div>
  );
}
