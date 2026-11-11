import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { InstagramSettings, instagramReturned } from "@/components/admin/instagram-settings";
import { PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { instagramAppOn, instagramStatus } from "@/server/instagram";
import { memberCan, requirePermission } from "@/server/permissions";

import { connectInstagramAction, disconnectInstagramAction } from "./actions";

export const metadata: Metadata = { title: "Instagram" };

/** The store's Instagram account (D560), whose own posts its Instagram feed components show. */
export default async function StoreInstagramPage({ params, searchParams }: PageProps<"/admin/[store]/integrations/instagram">) {
  const member = await requirePermission((await params).store, "settings:read");
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "notifications").instagram;
  const status = await instagramStatus(store.id);
  return (
    <AdminTextScope texts={adminTexts(lang, ["notifications"])}>
      <div className="flex flex-col gap-6">
        <PageHeader back={{ href: `/admin/${store.slug}/integrations`, label: w.back }} title={w.title} description={<>{w.description}</>} />
        <InstagramSettings
          status={status}
          appOn={instagramAppOn()}
          canEdit={memberCan(member, "settings:write")}
          lang={lang}
          pictureBase={`/api/instagram/${store.id}`}
          returned={instagramReturned((await searchParams).instagram)}
          connect={connectInstagramAction.bind(null, store.slug)}
          disconnect={disconnectInstagramAction.bind(null, store.slug)}
        />
      </div>
    </AdminTextScope>
  );
}
