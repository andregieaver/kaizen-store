import type { Metadata } from "next";
import Link from "next/link";

import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { FieldsToolbar } from "@/components/admin/fields-toolbar";
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
  const { store } = await requirePermission((await params).store, "products:read");
  const [groups, terms] = await Promise.all([listFieldGroups(store.id), editorTerms(store.id)]);
  const roles = roleOptions();
  const lookup = {
    term: (id: string) => terms.find((t) => t.id === id)?.name,
    role: (role: string) => roles.find((r) => r.value === role)?.label,
  };
  const base = `/admin/${store.slug}/fields`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageHeader
          title="Custom fields"
          description={<>Add your own fields to products, pages and articles: a size guide, ingredients, a warranty, a designer&apos;s name. Group the fields, choose where each group shows, and staff fill them in where they edit. New fields are private until you make them public.</>}
        />
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Groups can also be on the store itself (opening hours, a brand story: fill them in under{" "}
          <Link href={`${base}/store`} className="underline">
            Store details
          </Link>
          ), and on customers and orders, which are for staff only and never shown on the site.
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
          No groups yet. Start from a preset such as Specifications or Size guide, or make your own.
        </p>
      ) : (
        <Card compact>
          <List label="Groups of custom fields, in the order editors show them">
            {groups.map((group, index) => (
              <ListRow key={group.id}>
                <RowLead
                  title={group.name}
                  href={`${base}/${group.id}`}
                  sub={
                    <>
                      <span className="font-mono">{group.slug}</span> · {entitiesText(group.entities)} ·{" "}
                      {group.location.length === 0 ? "Everywhere" : describeLocation(group.location, lookup)}
                    </>
                  }
                />
                <RowFact className="hidden sm:block" sub={group.position === "side" ? "Side column" : "Main column"}>
                  {group.fields.length === 1 ? "1 field" : `${group.fields.length} fields`}
                </RowFact>
                <Chip signal={group.active ? "positive" : "neutral"} dot>
                  {group.active ? "On" : "Off"}
                </Chip>
                <RowActions>
                  <form action={moveFieldGroupAction.bind(null, store.slug, group.id, "up")}>
                    <Button type="submit" kind="quiet" size="dense" disabled={index === 0}>
                      Move up<span className="sr-only"> {group.name}</span>
                    </Button>
                  </form>
                  <form action={moveFieldGroupAction.bind(null, store.slug, group.id, "down")}>
                    <Button type="submit" kind="quiet" size="dense" disabled={index === groups.length - 1}>
                      Move down<span className="sr-only"> {group.name}</span>
                    </Button>
                  </form>
                  <form action={setFieldGroupActiveAction.bind(null, store.slug, group.id, !group.active)}>
                    <Button type="submit" kind="quiet" size="dense">
                      {group.active ? "Switch off" : "Switch on"}
                      <span className="sr-only"> {group.name}</span>
                    </Button>
                  </form>
                  <ButtonLink href={`${base}/${group.id}`} kind="quiet" size="dense">
                    Edit<span className="sr-only"> {group.name}</span>
                  </ButtonLink>
                  <a href={`${base}/export?group=${group.id}`} download className={buttonClass("quiet", "dense")}>
                    Export<span className="sr-only"> {group.name}</span>
                  </a>
                  <DeleteDiscountButton
                    action={deleteFieldGroupAction.bind(null, store.slug, group.id)}
                    code={group.name}
                    compact
                    question={`Delete the group ${group.name}? What was entered in its ${group.fields.length === 1 ? "field" : "fields"} is deleted too, for every product, page and article. This cannot be undone.`}
                  />
                </RowActions>
              </ListRow>
            ))}
          </List>
        </Card>
      )}
    </div>
  );
}
