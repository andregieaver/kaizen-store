import Link from "next/link";
import { connection } from "next/server";

import { AdminTextScope } from "@/components/admin/admin-text";
import { PAGE_TYPE_COPY } from "@/components/admin/page-type-copy";
import { TermsManager } from "@/components/admin/terms";
import { PageHeader } from "@/components/admin/ui";
import { adminTexts } from "@/lib/admin-text";
import { termContentOf, type PageType } from "@/lib/page-content";
import { requirePlatformReader } from "@/server/auth";
import { platformSiteWords } from "@/server/platform-site-words";
import { listTerms } from "@/server/taxonomy";

import { createPageTermAction, deletePageTermAction, updatePageTermAction } from "./actions";
import { typeWords } from "./type-words";

export async function PageTermsView({ type }: { type: PageType }) {
  await connection();
  await requirePlatformReader();
  const { lang, w } = await platformSiteWords();
  const tw = typeWords(w, type);
  const copy = PAGE_TYPE_COPY[type];
  const terms = await listTerms({ storeId: null, contentType: termContentOf(type) });
  return (
    <AdminTextScope texts={adminTexts(lang, ["products", "platformSite"])}>
      <div className="flex flex-col gap-1">
        <Link href={`/admin/platform/${copy.segment}`} className="w-fit text-sm underline">
          {tw.list}
        </Link>
        <PageHeader title={w.pages.categories} description={tw.terms} />
        </div>
      <TermsManager
        initial={terms}
        usedBy={copy.many}
        actions={{
          create: createPageTermAction.bind(null, type),
          update: updatePageTermAction.bind(null, type),
          remove: deletePageTermAction.bind(null, type),
        }}
      />
    </AdminTextScope>
  );
}
