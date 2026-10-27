import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { ButtonLink, Card, CARD_CLASS, Chip, List, ListRow, PageHeader, RowActions, RowFact, RowLead } from "@/components/admin/ui";
import { countWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { CONTENT_TYPE_PRESETS } from "@/lib/content-types";
import { listContentTypes } from "@/server/content-types";
import { requirePermission } from "@/server/permissions";

export const metadata: Metadata = { title: "Content" };

/** The store's content types (D326): each with its number of entries and a way to add one; with none, starting points to begin from. */
export default async function ContentPage({ params }: PageProps<"/admin/[store]/content">) {
  const { store, account } = await requirePermission((await params).store, "website:read");
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "content");
  const types = await listContentTypes(store.id);
  const base = `/admin/${store.slug}/content`;

  const presets = (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {CONTENT_TYPE_PRESETS.map((preset) => {
        const words = w.presets[preset.key as keyof typeof w.presets];
        return (
          <a key={preset.key} href={`${base}/new?preset=${preset.key}`} className={`flex flex-col gap-1 p-5 hover:bg-sunken ${CARD_CLASS}`}>
            <span className="text-body-strong text-ink">{words.name}</span>
            <span className="text-sm text-muted">{words.description}</span>
          </a>
        );
      })}
    </div>
  );

  return (
    <AdminTextScope texts={adminTexts(lang, ["content"])}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={w.list.title}
          description={w.list.description}
          actions={
            <ButtonLink href={`${base}/new`} kind="main" size="header">
              {w.list.create}
            </ButtonLink>
          }
        />
        {types.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">{w.list.empty}</p>
            {presets}
          </div>
        ) : (
          <>
            <Card compact>
              <List label={w.list.label}>
                {types.map((type) => (
                  <ListRow key={type.id}>
                    <RowLead
                      title={type.name}
                      href={`${base}/${type.id}`}
                      sub={<span className="font-mono">/{type.slug}</span>}
                    />
                    <RowFact className="hidden sm:block">{countWords(type.entries, w.list.entries)}</RowFact>
                    {type.hasPages && (
                      <RowFact className="hidden md:block">
                        <Chip>{w.list.withPages}</Chip>
                      </RowFact>
                    )}
                    <RowActions>
                      <ButtonLink href={`${base}/${type.id}/new`} kind="secondary" size="dense">
                        {w.list.addEntry}
                      </ButtonLink>
                    </RowActions>
                  </ListRow>
                ))}
              </List>
            </Card>
            <details>
              <summary className="cursor-pointer text-sm text-muted">{w.list.startFrom}</summary>
              <div className="mt-3">{presets}</div>
            </details>
          </>
        )}
      </div>
    </AdminTextScope>
  );
}
