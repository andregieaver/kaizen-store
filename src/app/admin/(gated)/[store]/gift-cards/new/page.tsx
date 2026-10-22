import type { Metadata } from "next";

import { Card, PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { languageName } from "@/lib/localization";
import { memberCan, requirePermission } from "@/server/permissions";

import { issueGiftCardAction } from "../actions";
import { IssueGiftCardForm } from "./issue-form";

export const metadata: Metadata = { title: "Issue a gift card" };

/** Issuing a gift card by hand (D300 F4): the page is the Products section's, and issuing needs the right to change products. */
export default async function IssueGiftCardPage({ params }: PageProps<"/admin/[store]/gift-cards/new">) {
  const member = await requirePermission((await params).store, "products:read");
  const { store } = member;
  const base = `/admin/${store.slug}/gift-cards`;
  const w = adminText(adminLangOf(member.account.adminLocale), "giftCards").issue;
  const currencies = store.localization.currencies.map((c) => c.currency);
  const languages = [...new Set(store.localization.locales.map((l) => l.slice(0, 2)))].map((code) => ({ code, label: languageName(code) }));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: base, label: w.back }} title={w.title} description={w.description} />
      <Card compact>
        {memberCan(member, "products:write") ? (
          <IssueGiftCardForm action={issueGiftCardAction.bind(null, store.slug)} currencies={currencies} languages={languages} base={base} words={w} />
        ) : (
          <p className="text-body text-ink-2">{w.noRight}</p>
        )}
      </Card>
    </div>
  );
}
