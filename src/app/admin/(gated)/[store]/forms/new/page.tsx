import type { Metadata } from "next";

import { FormStart } from "@/components/admin/forms/form-start";
import { PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { requirePermission } from "@/server/permissions";

import { makeFormAction } from "../actions";

export const metadata: Metadata = { title: "New form" };

/** Starting one of the store's forms (D705) from a ready-made one, in the store's main language. */
export default async function NewFormPage({ params }: PageProps<"/admin/[store]/forms/new">) {
  const { store, account } = await requirePermission((await params).store, "website:read");
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "forms");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: `/admin/${store.slug}/forms`, label: w.start.back }} title={w.start.title} description={w.start.description} />
      <FormStart lang={lang} siteLang={store.markets[0]?.lang ?? "en"} make={makeFormAction.bind(null, store.slug)} />
    </div>
  );
}
