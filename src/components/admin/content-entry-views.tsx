import { notFound } from "next/navigation";

import { AdminTextScope } from "@/components/admin/admin-text";
import { SIGNAL } from "@/components/admin/content-views";
import type { ContentSite } from "@/components/admin/content-site";
import { EntryEditor } from "@/components/admin/entry-editor";
import { Chip, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { adminText, adminTexts } from "@/lib/admin-text";
import { entryStatus, entryTitle } from "@/lib/content-types";
import { getContentType } from "@/server/content-types";
import { getEntry } from "@/server/content-entries";

/** The entry screen that draws the entry's editor (D326), apart from the lists (`content-views.tsx`): a route loads every client component its modules import (bloat review step 0.10). */

/** An entry of a content type, or a new one (`entryId` null): its fields, address and search texts, and publishing. */
export async function EntryView({ site, typeId, entryId }: { site: ContentSite; typeId: string; entryId: string | null }) {
  const type = await getContentType(site.owner, typeId);
  if (!type) notFound();
  const entry = entryId ? await getEntry(site.owner, entryId) : null;
  if (entryId && (!entry || entry.typeId !== type.id)) notFound();
  const w = adminText(site.lang, "content");
  const locales = site.languages.map((l) => l.locale);
  const main = locales[0] ?? "en";
  const status = entry ? entryStatus(entry) : null;
  const title = entry ? entryTitle(type, entry.draft.data, main, main) || w.entries.untitled : fillWords(w.entry.newTitle, { type: type.name });
  const base = `${site.base}/${type.id}`;

  return (
    <AdminTextScope texts={adminTexts(site.lang, ["content", "fields", "builder", "website"])}>
      <div className="flex flex-col gap-6">
        <PageHeader
          back={{ href: base, label: fillWords(w.entry.back, { type: type.name }) }}
          title={title}
          status={status ? <Chip signal={SIGNAL[status]}>{w.status[status]}</Chip> : undefined}
        />
        <EntryEditor
          type={{ id: type.id, name: type.name, slug: type.slug, fields: type.fields, titleField: type.titleField, hasPages: type.hasPages }}
          entry={entry && status ? { id: entry.id, slug: entry.slug, draft: entry.draft, status } : null}
          locales={locales}
          languageNames={Object.fromEntries(site.languages.map((l) => [l.locale, l.name]))}
          lookups={await site.lookups()}
          uploadImage={site.uploadImage}
          startFile={site.startFile}
          save={site.actions.saveEntry}
          publish={site.actions.publish}
          unpublish={site.actions.unpublish}
          remove={site.actions.removeEntry(type.id)}
          base={base}
        />
      </div>
    </AdminTextScope>
  );
}
