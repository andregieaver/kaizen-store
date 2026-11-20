import { AdminLink, PageHeader } from "@/components/admin/ui";
import { CARD_CLASS } from "@/components/admin/ui/card";
import type { HomeMessages } from "@/lib/admin-messages/home.en";
import { storeExtensionsOn } from "@/lib/extensions";
import { workBase } from "@/lib/work-paths";
import { WORKSPACE_EXTENSIONS, WORKSPACE_STARTS } from "@/lib/workspace-admin";

type Props = {
  store: { slug: string; name: string; extensionFacts?: unknown };
  /** The account's owner: they get Add to your account and the AI manager. */
  owner: boolean;
  words: HomeMessages["workspace"];
  now: Date;
};

const tile = `${CARD_CLASS} flex min-h-32 flex-col gap-2 p-5 hover:bg-sunken focus-visible:outline-2`;

/**
 * A standalone account's workspace Home (D748 E7 part three, `docs/extensions.md` 7): one card per extension the account has, each opening
 * its first page (Work at the account's level, D123), the AI manager, and Add to your account. Nothing of a store: no setup, sales or orders.
 * When nothing runs (every trial ended), one line leads to Extensions to choose what to keep.
 */
export function WorkspaceHome({ store, owner, words: w, now }: Props) {
  const base = `/admin/${store.slug}`;
  const on = storeExtensionsOn(store, now).filter((id) => WORKSPACE_EXTENSIONS.includes(id)) as (keyof typeof WORKSPACE_STARTS)[];
  const href = (id: keyof typeof WORKSPACE_STARTS) => (id === "work" ? workBase(store.slug) : `${base}${WORKSPACE_STARTS[id]}`);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={w.eyebrow} title={store.name} description={w.description} />
      {on.length === 0 && (
        <p className="rounded-panel border border-line bg-card p-4 text-body">
          {w.none}{" "}
          <AdminLink href="/admin/account/extensions" className="font-medium underline underline-offset-2">
            {w.noneLink}
          </AdminLink>
        </p>
      )}
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {on.map((id) => (
          <li key={id}>
            <AdminLink href={href(id)} className={tile}>
              <span className="text-title text-ink">{w.extensions[id].title}</span>
              <span className="text-body text-muted">{w.extensions[id].text}</span>
              <span className="mt-auto text-body-strong">{w.open} →</span>
            </AdminLink>
          </li>
        ))}
        {owner && (
          <li>
            <AdminLink href={`${base}/assistant`} className={tile}>
              <span className="text-title text-ink">{w.assistant}</span>
              <span className="text-body text-muted">{w.assistantText}</span>
              <span className="mt-auto text-body-strong">{w.open} →</span>
            </AdminLink>
          </li>
        )}
        {owner && (
          <li>
            <AdminLink href="/admin/account/add" className={`${tile} border border-dashed border-edge`}>
              <span className="text-title text-ink">{w.add}</span>
              <span className="text-body text-muted">{w.addText}</span>
              <span className="mt-auto text-body-strong">{w.open} →</span>
            </AdminLink>
          </li>
        )}
      </ul>
    </div>
  );
}
