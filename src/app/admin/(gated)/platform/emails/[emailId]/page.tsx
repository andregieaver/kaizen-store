import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { EmailView } from "@/components/admin/email-log";
import { getEmail } from "@/server/email";
import { requirePlatformAdmin } from "@/server/auth";

export const metadata: Metadata = { title: "Email" };

export default async function PlatformEmailPage({ params }: PageProps<"/admin/platform/emails/[emailId]">) {
  await requirePlatformAdmin();
  const { emailId } = await params;
  const email = z.uuid().safeParse(emailId).success ? await getEmail(emailId, null) : null;
  if (!email) notFound();
  return (
    <div className="flex flex-col gap-4">
      <Link href="/admin/platform/emails" className="text-sm underline">
        Emails
      </Link>
      <EmailView email={email} />
    </div>
  );
}
