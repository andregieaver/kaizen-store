import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminTextScope } from "@/components/admin/admin-text";
import { ReviewImportForm } from "@/components/admin/review-import-form";
import { Card, PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { featureOn } from "@/lib/store-features";
import { memberCan, requirePermission } from "@/server/permissions";

import { importReviewsAction } from "./actions";

export const metadata: Metadata = { title: "Import reviews" };

/**
 * Importing reviews written on another service (D301 G3b, `docs/wave-5-marketing.md` 9.6): a CSV file, where they come from and whether they show at
 * once; a check of the file first if asked. Needs the right to change products, and the reviews feature on.
 */
export default async function ReviewImportPage({ params }: PageProps<"/admin/[store]/reviews/import">) {
  const member = await requirePermission((await params).store, "products:read");
  if (!memberCan(member, "products:write") || !featureOn(member.store, "reviews")) notFound();
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "reviews").import;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: `/admin/${member.store.slug}/reviews`, label: w.back }} title={w.title} description={w.description} />
      <Card compact>
        <AdminTextScope texts={adminTexts(lang, ["reviews"])}>
          <ReviewImportForm action={importReviewsAction.bind(null, member.store.slug)} />
        </AdminTextScope>
      </Card>
    </div>
  );
}
