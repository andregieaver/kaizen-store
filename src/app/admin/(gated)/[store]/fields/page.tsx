import type { Metadata } from "next";
import Link from "next/link";

import { AdminTextScope } from "@/components/admin/admin-text";
import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { FieldsToolbar } from "@/components/admin/fields-toolbar";
import { countWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { describeLocation, entitiesText } from "@/lib/field-group-editor";
import { requirePermission } from "@/server/permissions";
import { listFieldGroups } from "@/server/custom-fields";
import { Button, buttonClass, ButtonLink, Card, CARD_CLASS, Chip, List, ListRow, PageHeader, RowActions, RowFact, RowLead } from "@/components/admin/ui";

import {
  createFromPresetAction,
  deleteFieldGroupAction,
  importFieldGroupsAction,
  moveFieldGroupAction,
  setFieldGroupActiveAction,
} from "./actions";
import { editorTerms, roleOptions } from "./data";

export const metadata: Metadata = { title: "Custom fields" };


/** A store's groups of custom fields (D118): what each is on, whether it is on, and their order in the editors. */
export default async function FieldsPage({ params }: PageProps<"/admin/[store]/fields">) {
  const { store, account } = await requirePermission((await params).store, "products:read");
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "fields");
  const t = w.list;
  const [groups, terms] = await Promise.all([listFieldGroups(store.id), editorTerms(store.id)]);
  const roles = roleOptions();
  const lookup = {
    term: (id: string) => terms.find((t) => t.id === id)?.name,
    role: (role: string) => roles.find((r) => r.value === role)?.label,
  };
  const base = `/admin/${store.slug}/fields`;

  return (
    <AdminTextScope texts={adminTexts(lang, ["fields"])}>
    <div className="flex flex-col gap-6">
      <div>
        <PageHeader title={t.title} description={t.description} />
        <p className="mt-2 max-w-2xl text-sm text-muted">
          {t.alsoBefore}
          <Link href={`${base}/store`} className="underline">
            {t.storeDetails}
          </Link>
          {t.alsoAfter}
        </p>
      </div>
      <FieldsToolbar
        base={base}
        hasGroups={groups.length > 0}
        createFromPreset={createFromPresetAction.bind(null, store.slug)}
        importGroups={importFieldGroupsAction.bind(null, store.slug)}
      />
      {groups.length === 0 ? (
        <p className={`p-8 text-center text-sm text-muted ${CARD_CLASS}`}>
          {t.empty}
        </p>
      ) : (
        <Card compact>
          <List label={t.label}>
            {groups.map((group, index) => (
              <ListRow key={group.id}>
                <RowLead
                  title={group.name}
                  href={`${base}/${group.id}`}
                  sub={
                    <>
                      <span className="font-mono">{group.slug}</span> · {entitiesText(group.entities, w)} ·{" "}
                      {group.location.length === 0 ? t.everywhere : describeLocation(group.location, lookup, w)}
                    </>
                  }
                />
                <RowFact className="hidden sm:block" sub={w.positions[group.position]}>
                  {countWords(group.fields.length, t.fieldCount)}
                </RowFact>
                <Chip signal={group.active ? "positive" : "neutral"} dot>
                  {group.active ? t.on : t.off}
                </Chip>
                <RowActions>
                  <form action={moveFieldGroupAction.bind(null, store.slug, group.id, "up")}>
                    <Button type="submit" kind="quiet" size="dense" disabled={index === 0}>
                      {t.moveUp}<span className="sr-only"> {group.name}</span>
                    </Button>
                  </form>
                  <form action={moveFieldGroupAction.bind(null, store.slug, group.id, "down")}>
                    <Button type="submit" kind="quiet" size="dense" disabled={index === groups.length - 1}>
                      {t.moveDown}<span className="sr-only"> {group.name}</span>
                    </Button>
                  </form>
                  <form action={setFieldGroupActiveAction.bind(null, store.slug, group.id, !group.active)}>
                    <Button type="submit" kind="quiet" size="dense">
                      {group.active ? t.switchOff : t.switchOn}
                      <span className="sr-only"> {group.name}</span>
                    </Button>
                  </form>
                  <ButtonLink href={`${base}/${group.id}`} kind="quiet" size="dense">
                    {t.edit}<span className="sr-only"> {group.name}</span>
                  </ButtonLink>
                  <a href={`${base}/export?group=${group.id}`} download className={buttonClass("quiet", "dense")}>
                    {t.export}<span className="sr-only"> {group.name}</span>
                  </a>
                  <DeleteDiscountButton
                    action={deleteFieldGroupAction.bind(null, store.slug, group.id)}
                    code={group.name}
                    compact
                    question={countWords(group.fields.length, t.deleteQuestion, { name: group.name })}
                  />
                </RowActions>
              </ListRow>
            ))}
          </List>
        </Card>
      )}
    </div>
    </AdminTextScope>
  );
}
