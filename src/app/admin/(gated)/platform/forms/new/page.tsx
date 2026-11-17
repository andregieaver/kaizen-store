import type { Metadata } from "next";

import { FormStart } from "@/components/admin/forms/form-start";
import { PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { requirePlatform } from "@/server/auth";

import { makePlatformFormAction } from "../actions";

export const metadata: Metadata = { title: "New form" };

/** Starting one of Kaizena Flow's forms (D705) from a ready-made one. */
export default async function NewPlatformFormPage() {
  const account = await requirePlatform("website");
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "forms");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: "/admin/platform/forms", label: w.start.back }} title={w.start.title} description={w.start.description} />
      <FormStart lang={lang} siteLang="en" make={makePlatformFormAction} />
    </div>
  );
}
