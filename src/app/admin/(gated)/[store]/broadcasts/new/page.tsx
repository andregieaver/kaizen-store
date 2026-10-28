import type { Metadata } from "next";
import Link from "next/link";

import { AdminTextScope } from "@/components/admin/admin-text";
import { BroadcastEditor } from "@/components/admin/broadcast-editor";
import { Card, PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { BROADCAST_TEMPLATE_KEYS } from "@/lib/broadcast-templates";
import { listOwnTemplates, startingContent } from "@/server/broadcast-templates";
import { memberCan, requirePermission } from "@/server/permissions";
import { uploadsEnabled } from "@/server/media";

import { audienceCountAction, deleteTemplateAction, saveBroadcastAction, findBroadcastFactsAction, suggestBroadcastAction, uploadBroadcastPictureAction } from "../actions";
import { broadcastChoices } from "../editor-props";

export const metadata: Metadata = { title: "New broadcast" };

/** A new broadcast (D297): written and saved as a draft, then tested and sent from its own page. */
export default async function NewBroadcastPage({ params, searchParams }: PageProps<"/admin/[store]/broadcasts/new">) {
  const member = await requirePermission((await params).store, "marketing:read");
  const { store } = member;
  const base = `/admin/${store.slug}/broadcasts`;
  const lang = adminLangOf(member.account.adminLocale);
  const wb = adminText(lang, "marketing").broadcasts;
  if (!memberCan(member, "marketing:write")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader back={{ href: base, label: wb.title }} title={wb.newBroadcast} />
        <p className="text-body text-muted">{wb.mayNotWrite}</p>
      </div>
    );
  }
  const from = (await searchParams).from;
  const choice = typeof from === "string" ? from : null;
  const [choices, own, content] = await Promise.all([
    broadcastChoices(store, lang),
    listOwnTemplates(store.id),
    startingContent(store.id, store.localization.keptLocales, choice),
  ]);
  // Start from (D368): the hand-written templates and the store's own; the editor opens with the one chosen, unsaved.
  const link = (key: string | null, label: string) => (
    <Link
      key={key ?? "blank"}
      href={key ? `${base}/new?from=${key}` : `${base}/new`}
      aria-current={(choice ?? null) === key ? "page" : undefined}
      className="rounded-pill border border-line px-3 py-1 text-body aria-[current=page]:border-edge aria-[current=page]:bg-sunken"
    >
      {label}
    </Link>
  );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: base, label: wb.title }} title={wb.newBroadcast} description={wb.newDescription} />
      <Card title={wb.startFrom} compact>
        <nav aria-label={wb.startFrom} className="flex flex-wrap gap-2">
          {link(null, wb.blank)}
          {BROADCAST_TEMPLATE_KEYS.map((key) => link(key, wb.templates[key]))}
        </nav>
        {own.length > 0 && (
          <div className="mt-4 flex flex-col gap-2">
            <h3 className="text-eyebrow text-muted">{wb.yourTemplates}</h3>
            <ul className="flex flex-wrap gap-2">
              {own.map((t) => (
                <li key={t.id} className="flex items-center gap-1">
                  {link(t.id, t.title)}
                  <form action={deleteTemplateAction.bind(null, store.slug, t.id)}>
                    <button type="submit" aria-label={`${wb.deleteTemplate}: ${t.title}`} className="rounded-pill px-2 text-muted hover:text-danger-text">
                      ×
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
      <Card compact>
        <AdminTextScope texts={adminTexts(lang, ["marketing"])}>
        <BroadcastEditor
          key={choice ?? "blank"}
          storeSlug={store.slug}
          broadcastId={null}
          initial={{ title: "", audience: "everyone", segmentId: null, content }}
          {...choices}
          save={saveBroadcastAction}
          count={audienceCountAction}
          suggest={suggestBroadcastAction}
            facts={findBroadcastFactsAction}
          upload={uploadsEnabled() ? uploadBroadcastPictureAction : null}
        />
        </AdminTextScope>
      </Card>
    </div>
  );
}
