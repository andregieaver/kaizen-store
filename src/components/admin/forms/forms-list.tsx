import { ClipboardList, Plus } from "lucide-react";

import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, type AdminLang } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import type { FormSummary, FormUse } from "@/server/forms-admin";

import { ButtonLink, Card, Chip, List, ListRow, RowActions, RowFact, RowLead } from "../ui";

/**
 * The owner's forms (D705): each with its kind, where it shows and its responses, and *New form* as the one main action. A form that cannot
 * deliver or is archived says so, since it shows nothing on the site.
 */
export function FormsList({ lang, base, forms, uses }: { lang: AdminLang; base: string; forms: FormSummary[]; uses: FormUse[] }) {
  const w = adminText(lang, "forms");
  const when = new Intl.DateTimeFormat(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "medium" });
  if (forms.length === 0) {
    return (
      <Card>
        <div className="flex flex-col items-start gap-3 py-6" data-forms-empty>
          <ClipboardList aria-hidden className="size-8 text-muted" />
          <h2 className="text-title text-ink">{w.empty.title}</h2>
          <p className="max-w-prose text-body text-ink-2">{w.empty.text}</p>
          <ButtonLink kind="main" href={`${base}/new`} icon={<Plus aria-hidden className="size-4" />}>
            {w.newForm}
          </ButtonLink>
        </div>
      </Card>
    );
  }
  return (
    <List label={w.title}>
      {forms.map((form) => {
        const shown = uses.filter((u) => u.formId === form.id);
        const sub = [
          w.kinds[form.kind],
          shown.length > 0 ? `${w.editor.placedOn}: ${shown.map((u) => u.title || "…").join(", ")}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <ListRow key={form.id} href={`${base}/${form.id}`}>
            <RowLead title={form.name} sub={sub} />
            <RowFact sub={form.lastAt ? fillWords(w.list.lastAt, { when: when.format(new Date(form.lastAt)) }) : w.list.never}>
              {form.responses} {w.list.responses.toLowerCase()}
            </RowFact>
            <RowActions>
              {form.status === "archived" ? (
                <Chip>{w.list.archived}</Chip>
              ) : form.recipients === 0 ? (
                <Chip signal="warning">{w.list.noAddress}</Chip>
              ) : form.unread > 0 ? (
                <Chip signal="insight" dot>
                  {countWords(form.unread, w.list.unread)}
                </Chip>
              ) : null}
            </RowActions>
          </ListRow>
        );
      })}
    </List>
  );
}
