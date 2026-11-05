import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Card, PageHeader } from "@/components/admin/ui";
import { adminText } from "@/lib/admin-text";
import { PLATFORM_LEGAL_SLUGS } from "@/lib/platform-legal-slugs";
import { platformPath } from "@/lib/platform-lang";
import { requestAdminLang } from "@/server/admin-request-lang";
import { selfServeOn } from "@/server/self-signup";

import { keepSandboxAction } from "../actions";
import { sandboxOf } from "../sandbox";

export const metadata: Metadata = { title: "Keep this store" };

const FIELD = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";

/**
 * *Keep this store* (D457 S2, `docs/builder-sandbox.md` 4.7): the sign-up's three answers (the store's name, filled in; the person's name and
 * email) under the sentence that links the terms and the privacy notice, as on `/sign-up`. With self-serve sign-up on, a link is emailed and
 * its press makes the store theirs; off, the request waits for a platform admin, whose approval does the same.
 */
export default async function KeepPage({ params }: PageProps<"/admin/try/[sandbox]/keep">) {
  const { sandbox: id } = await params;
  const sandbox = await sandboxOf(id);
  if (!sandbox) return null;
  const [lang, selfServe] = await Promise.all([requestAdminLang(), selfServeOn()]);
  const w = adminText(lang, "sandbox").keep;
  const send = selfServe ? w.send : w.sendWaiting;
  const parts = w.acceptance
    .replace("{button}", send)
    .split(/(\{terms\}|\{privacy\})/)
    .filter((part) => part !== "");
  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-6 pt-6">
      <PageHeader title={w.title} description={selfServe ? w.lead : w.leadWaiting} />
      <Card>
        <ActionForm action={keepSandboxAction.bind(null, sandbox.id)} replaceOnSuccess className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm font-medium">
            {w.storeName}
            <input name="storeName" required maxLength={80} defaultValue={sandbox.store.name} className={FIELD} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {w.name}
            <input name="name" required maxLength={100} autoComplete="name" className={FIELD} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {w.email}
            <input type="email" name="email" required autoComplete="email" className={FIELD} />
          </label>
          {/* What sending agrees to (PSI REG-02): the terms and the privacy notice, linked, as on the sign-up page. */}
          <p className="text-sm text-muted">
            {parts.map((part, i) =>
              part === "{terms}" ? (
                <Link key={i} href={platformPath(lang, `/${PLATFORM_LEGAL_SLUGS.terms}`)} className="underline">
                  {w.termsLink}
                </Link>
              ) : part === "{privacy}" ? (
                <Link key={i} href={platformPath(lang, `/${PLATFORM_LEGAL_SLUGS.privacy}`)} className="underline">
                  {w.privacyLink}
                </Link>
              ) : (
                <span key={i}>{part}</span>
              ),
            )}
          </p>
          <SubmitButton>{send}</SubmitButton>
          {/* Hidden from people and screen readers; a filled-in value marks a bot. */}
          <div aria-hidden="true" className="hidden">
            <input name="website" tabIndex={-1} autoComplete="off" />
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
