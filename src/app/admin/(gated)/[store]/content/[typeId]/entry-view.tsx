import { notFound } from "next/navigation";

import { AdminTextScope } from "@/components/admin/admin-text";
import { EntryEditor } from "@/components/admin/entry-editor";
import { Chip, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { entryStatus, entryTitle, type EntryStatus } from "@/lib/content-types";
import { getEntry } from "@/server/content-entries";
import { getContentType } from "@/server/content-types";
import { fieldLookups } from "@/server/custom-fields";
import { uploadsEnabled } from "@/server/media";
import type { Membership } from "@/server/auth";

import { startFieldFileUploadAction } from "../../fields/actions";
import { storeLanguages } from "../../fields/data";
import { deleteEntryAction, publishEntryAction, saveEntryAction, unpublishEntryAction } from "../actions";

const SIGNAL: Record<EntryStatus, "neutral" | "positive" | "warning"> = { draft: "neutral", published: "positive", changed: "warning" };

/** An entry of a content type (D326), or a new one (`entryId` null): its fields, address and search texts, and publishing. */
export async function EntryView({ member, typeId, entryId }: { member: Membership; typeId: string; entryId: string | null }) {
  const { store, account } = member;
  const type = await getContentType(store.id, typeId);
  if (!type) notFound();
  const entry = entryId ? await getEntry(store.id, entryId) : null;
  if (entryId && (!entry || entry.typeId !== type.id)) notFound();
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "content");
  const main = store.localization.locales[0];
  const languages = storeLanguages(store, lang === "nb" ? "nb" : "en");
  const status = entry ? entryStatus(entry) : null;
  const title = entry ? entryTitle(type, entry.draft.data, main, main) || w.entries.untitled : fillWords(w.entry.newTitle, { type: type.name });
  const base = `/admin/${store.slug}/content/${type.id}`;
  const lookups = await fieldLookups(store.id);

  return (
    <AdminTextScope texts={adminTexts(lang, ["content", "fields"])}>
      <div className="flex flex-col gap-6">
        <PageHeader
          back={{ href: base, label: fillWords(w.entry.back, { type: type.name }) }}
          title={title}
          status={status ? <Chip signal={SIGNAL[status]}>{w.status[status]}</Chip> : undefined}
        />
        <EntryEditor
          type={{ id: type.id, name: type.name, slug: type.slug, fields: type.fields, titleField: type.titleField, hasPages: type.hasPages }}
          entry={entry && status ? { id: entry.id, slug: entry.slug, draft: entry.draft, status } : null}
          locales={store.localization.locales}
          languageNames={Object.fromEntries(languages.map((l) => [l.locale, l.name]))}
          lookups={lookups}
          storeSlug={store.slug}
          uploads={uploadsEnabled()}
          startFile={startFieldFileUploadAction.bind(null, store.slug)}
          save={saveEntryAction.bind(null, store.slug)}
          publish={publishEntryAction.bind(null, store.slug)}
          unpublish={unpublishEntryAction.bind(null, store.slug)}
          remove={deleteEntryAction.bind(null, store.slug, type.id)}
          base={base}
        />
      </div>
    </AdminTextScope>
  );
}
