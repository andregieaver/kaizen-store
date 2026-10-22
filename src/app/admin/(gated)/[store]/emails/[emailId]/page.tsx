import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { EmailView } from "@/components/admin/email-log";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { requirePermission } from "@/server/permissions";
import { getEmail } from "@/server/email";

export const metadata: Metadata = { title: "Email" };

export default async function StoreEmailPage({ params }: PageProps<"/admin/[store]/emails/[emailId]">) {
  const { store: slug, emailId } = await params;
  const member = await requirePermission(slug, "orders:read");
  const { store } = member;
  const words = adminText(adminLangOf(member.account.adminLocale), "notifications");
  const email = z.uuid().safeParse(emailId).success ? await getEmail(emailId, store.id) : null;
  if (!email) notFound();
  return (
    <div className="flex flex-col gap-4">
      <Link href={`/admin/${store.slug}/emails`} className="text-sm underline">
        {words.log.back}
      </Link>
      <EmailView email={email} words={words} />
    </div>
  );
}
