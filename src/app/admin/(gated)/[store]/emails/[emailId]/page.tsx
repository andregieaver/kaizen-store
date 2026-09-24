import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { EmailView } from "@/components/admin/email-log";
import { requireMember } from "@/server/auth";
import { getEmail } from "@/server/email";

export const metadata: Metadata = { title: "Email" };

export default async function StoreEmailPage({ params }: PageProps<"/admin/[store]/emails/[emailId]">) {
  const { store: slug, emailId } = await params;
  const { store } = await requireMember(slug);
  const email = z.uuid().safeParse(emailId).success ? await getEmail(emailId, store.id) : null;
  if (!email) notFound();
  return (
    <div className="flex flex-col gap-4">
      <Link href={`/admin/${store.slug}/emails`} className="text-sm underline">
        Emails to customers
      </Link>
      <EmailView email={email} />
    </div>
  );
}
