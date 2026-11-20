import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { EmailView } from "@/components/admin/email-log";
import { getEmail } from "@/server/email";
import { requirePlatformReader } from "@/server/auth";
import { adminLangOf } from "@/lib/admin-lang";
import { NOTIFICATIONS_WORDS } from "@/lib/admin-words/notifications";
import { PLATFORM_WORDS } from "@/lib/admin-words/platform";

export const metadata: Metadata = { title: "Email" };

export default async function PlatformEmailPage({ params }: PageProps<"/admin/platform/emails/[emailId]">) {
  const account = await requirePlatformReader();
  const lang = adminLangOf(account.adminLocale);
  const w = PLATFORM_WORDS[lang].emailDetail;
  const { emailId } = await params;
  const email = z.uuid().safeParse(emailId).success ? await getEmail(emailId, null) : null;
  if (!email) notFound();
  return (
    <div className="flex flex-col gap-4">
      <Link href="/admin/platform/emails" className="text-sm underline">
        {w.back}
      </Link>
      <EmailView email={email} words={NOTIFICATIONS_WORDS[lang]} />
    </div>
  );
}
