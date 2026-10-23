import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { EmailView } from "@/components/admin/email-log";
import { getEmail } from "@/server/email";
import { requirePlatformAdmin } from "@/server/auth";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

export const metadata: Metadata = { title: "Email" };

export default async function PlatformEmailPage({ params }: PageProps<"/admin/platform/emails/[emailId]">) {
  const account = await requirePlatformAdmin();
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "platform").emailDetail;
  const { emailId } = await params;
  const email = z.uuid().safeParse(emailId).success ? await getEmail(emailId, null) : null;
  if (!email) notFound();
  return (
    <div className="flex flex-col gap-4">
      <Link href="/admin/platform/emails" className="text-sm underline">
        {w.back}
      </Link>
      <EmailView email={email} words={adminText(lang, "notifications")} />
    </div>
  );
}
