import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { CanvaAccountCard } from "@/components/admin/canva-media";
import { PageHeader } from "@/components/admin/ui";
import { areaTexts } from "@/lib/admin-area";
import { adminLangOf } from "@/lib/admin-lang";
import { NOTIFICATIONS_WORDS } from "@/lib/admin-words/notifications";
import { CANVA_WORDS } from "@/lib/admin-words/canva";
import { canvaAccount, canvaOffered } from "@/server/canva";
import { requirePermission } from "@/server/permissions";

export const metadata: Metadata = { title: "Canva" };

/**
 * Canva on a store's Integrations (D898): the person's own Canva, which *Edit in Canva* and *Import from Canva* in the media library use. Each
 * person connects their own, so this page is every member's, not only the owner's.
 */
export default async function StoreCanvaPage({ params, searchParams }: PageProps<"/admin/[store]/integrations/canva">) {
  const member = await requirePermission((await params).store, "settings:read");
  const { store, account } = member;
  const lang = adminLangOf(account.adminLocale);
  const w = NOTIFICATIONS_WORDS[lang].integrations;
  const outcome = (await searchParams).canva;
  const said = outcome === "connected" || outcome === "declined" || outcome === "failed" ? outcome : null;
  const here = `/admin/${store.slug}/integrations/canva`;
  const connected = canvaOffered() ? await canvaAccount(account.id) : null;
  return (
    <AdminTextScope texts={areaTexts(lang, { canva: CANVA_WORDS })}>
      <div className="flex max-w-3xl flex-col gap-6">
        <PageHeader back={{ href: `/admin/${store.slug}/integrations`, label: w.canvaPage.back }} title={w.canvaTitle} description={<>{w.canvaPage.description}</>} />
        {said && (
          <p role="status" className={`text-sm ${said === "connected" ? "text-positive-text" : "text-danger-text"}`}>
            {CANVA_WORDS[lang].outcome[said]}
          </p>
        )}
        {canvaOffered() ? (
          <CanvaAccountCard
            account={connected ? { name: connected.name, problem: connected.problem !== null } : null}
            back={here}
            library={{ href: `/admin/${store.slug}/media`, label: w.canvaPage.library }}
          />
        ) : (
          <p className="text-body text-ink-2">{w.canvaPage.notSetUp}</p>
        )}
      </div>
    </AdminTextScope>
  );
}
