import type { Metadata } from "next";
import Link from "next/link";

import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { FieldsToolbar } from "@/components/admin/fields-toolbar";
import { describeLocation, entitiesText } from "@/lib/field-group-editor";
import { requirePermission } from "@/server/permissions";
import { listFieldGroups } from "@/server/custom-fields";

import {
  createFromPresetAction,
  deleteFieldGroupAction,
  importFieldGroupsAction,
  moveFieldGroupAction,
  setFieldGroupActiveAction,
} from "./actions";
import { editorTerms, roleOptions } from "./data";

export const metadata: Metadata = { title: "Custom fields" };

const small = "flex min-h-10 items-center rounded-md px-3 text-sm hover:bg-surface disabled:opacity-40";

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
        <h1 className="text-2xl font-semibold">Custom fields</h1>
        <p className="max-w-2xl text-sm text-muted">
          Add your own fields to products, pages and articles: a size guide, ingredients, a warranty, a designer&apos;s
          name. Group the fields, choose where each group shows, and staff fill them in where they edit. New fields are
          private until you make them public.
        </p>
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
        <p className="rounded-lg border border-dashed border-border bg-background p-8 text-center text-sm text-muted">
          No groups yet. Start from a preset such as Specifications or Size guide, or make your own.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-background">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Groups of custom fields, in the order editors show them</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="px-4 py-2 font-medium">
                  Group
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  On
                </th>
                <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">
                  Fields
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Status
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group, index) => (
                <tr key={group.id} className="border-b border-border align-top last:border-0">
                  <td className="px-4 py-2">
                    <Link href={`${base}/${group.id}`} className="font-medium underline-offset-2 hover:underline">
                      {group.name}
                    </Link>
                    <span className="block font-mono text-xs text-muted">{group.slug}</span>
                  </td>
                  <td className="px-4 py-2">
                    {entitiesText(group.entities)}
                    <span className="block max-w-sm text-xs text-muted">
                      {group.location.length === 0 ? "Everywhere" : describeLocation(group.location, lookup)}
                    </span>
                  </td>
                  <td className="hidden px-4 py-2 sm:table-cell">{group.fields.length}</td>
                  <td className="px-4 py-2">
                    {group.active ? "On" : "Off"}
                    <span className="block text-xs text-muted">
                      {group.position === "side" ? "Side column" : "Main column"}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap items-center justify-end gap-1">
                      <form action={moveFieldGroupAction.bind(null, store.slug, group.id, "up")}>
                        <button type="submit" disabled={index === 0} className={small}>
                          Move up<span className="sr-only"> {group.name}</span>
                        </button>
                      </form>
                      <form action={moveFieldGroupAction.bind(null, store.slug, group.id, "down")}>
                        <button type="submit" disabled={index === groups.length - 1} className={small}>
                          Move down<span className="sr-only"> {group.name}</span>
                        </button>
                      </form>
                      <form action={setFieldGroupActiveAction.bind(null, store.slug, group.id, !group.active)}>
                        <button type="submit" className={small}>
                          {group.active ? "Switch off" : "Switch on"}
                          <span className="sr-only"> {group.name}</span>
                        </button>
                      </form>
                      <Link href={`${base}/${group.id}`} className={small}>
                        Edit<span className="sr-only"> {group.name}</span>
                      </Link>
                      <a href={`${base}/export?group=${group.id}`} download className={small}>
                        Export<span className="sr-only"> {group.name}</span>
                      </a>
                      <DeleteDiscountButton
                        action={deleteFieldGroupAction.bind(null, store.slug, group.id)}
                        code={group.name}
                        compact
                        question={`Delete the group ${group.name}? What was entered in its ${group.fields.length === 1 ? "field" : "fields"} is deleted too, for every product, page and article. This cannot be undone.`}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
