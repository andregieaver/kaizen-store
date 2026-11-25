import type { Metadata } from "next";
import { connection } from "next/server";

import { Card, PageHeader, buttonClass } from "@/components/admin/ui";
import { Field, Select } from "@/components/admin/ui/field";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { PLUGINS_WORDS } from "@/lib/admin-words/plugins";
import { requireAccount } from "@/server/auth";
import { ownedStores, waitingSignIn } from "@/server/plugin-sign-in";

export const metadata: Metadata = { title: "Connect Figma", robots: { index: false, follow: false }, referrer: "no-referrer" };

const PROBLEMS = ["owner", "limit", "off", "gone"] as const;

/**
 * Where the Kaizena Flow plugin in Figma is approved (D898 F1, `PLUGIN_SIGN_IN_PAGE`): the plugin opens it with its code; the person checks
 * the code, picks one of the stores they own and presses *Connect Figma* (or *Do not connect*), a plain form to `/api/plugin/approve`.
 */
export default async function PluginSignInPage(props: { searchParams: Promise<{ code?: string; done?: string; store?: string; problem?: string }> }) {
  await connection();
  const query = await props.searchParams;
  const account = await requireAccount();
  const w = PLUGINS_WORDS[adminLangOf(account.adminLocale)];
  const [waiting, stores] = await Promise.all([waitingSignIn(query.code), ownedStores(account.id)]);
  const problem = PROBLEMS.find((p) => p === query.problem);
  const done = query.done === "connected" ? fillWords(w.connected, { store: stores.find((s) => s.slug === query.store)?.name ?? "" }) : query.done === "declined" ? w.declined : null;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <PageHeader title={w.title} description={w.lead} />
      {done ? (
        <Card>
          <p role="status" className="text-body text-ink" data-plugin-done>
            {done}
          </p>
        </Card>
      ) : !waiting ? (
        <Card>
          <p role="alert" className="text-body text-ink">
            {w.problems.gone}
          </p>
        </Card>
      ) : stores.length === 0 ? (
        <Card>
          <p className="text-body text-ink">{w.noStores}</p>
        </Card>
      ) : (
        <Card>
          <form method="post" action="/api/plugin/approve" className="flex flex-col gap-5" data-plugin-approve>
            <input type="hidden" name="code" value={waiting.code} />
            <div className="flex flex-col gap-1">
              <p className="text-sm text-muted">{w.check}</p>
              <p className="font-mono text-display tracking-[0.2em] text-ink" data-plugin-code>
                {waiting.code.slice(0, 4)}-{waiting.code.slice(4)}
              </p>
            </div>
            {stores.length > 1 ? (
              <Field label={w.store}>
                {(control) => (
                  <Select {...control} name="store" defaultValue={stores[0].slug}>
                    {stores.map((s) => (
                      <option key={s.slug} value={s.slug}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : (
              <>
                <input type="hidden" name="store" value={stores[0].slug} />
                <p className="text-body text-ink">
                  {w.store}: <strong>{stores[0].name}</strong>
                </p>
              </>
            )}
            <p className="text-sm text-muted">{w.warn}</p>
            {problem && (
              <p role="alert" className="text-sm text-danger-text">
                {w.problems[problem]}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="submit" name="decision" value="connect" className={buttonClass("main")}>
                {w.connect}
              </button>
              <button type="submit" name="decision" value="decline" className={buttonClass("secondary")}>
                {w.decline}
              </button>
            </div>
            <p className="text-xs text-muted">{w.where}</p>
          </form>
        </Card>
      )}
    </div>
  );
}
