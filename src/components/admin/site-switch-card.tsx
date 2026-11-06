import Link from "next/link";
import type { ComponentProps } from "react";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Card } from "@/components/admin/ui";
import { ADMIN_LANG_FACTS, type AdminLang } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import { adminText } from "@/lib/admin-text";
import { HOUSE_STORE_SLUG } from "@/lib/platform-nav";
import type { SiteSwitch } from "@/server/house-switch";

type SwitchAction = ComponentProps<typeof ActionForm>["action"];

/**
 * The switch that serves kaizenaflow.com from Kaizena Flow's own store (D484, step 5 of `docs/platform-parity-plan.md`), on Platform →
 * Website under the copy (step 3). Off, the three steps and one button, which asks only that the copy was looked at; on, since when, a link
 * to edit the site in the store and the button that switches back. Nothing is deleted either way.
 */
export function SiteSwitchCard({ lang, state, on, off }: { lang: AdminLang; state: SiteSwitch; on: SwitchAction; off: SwitchAction }) {
  const w = adminText(lang, "console").siteSwitch;
  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" }) : "";
  if (state.on) {
    return (
      <Card title={w.title}>
        <ActionForm action={off} className="flex flex-col gap-4">
          <p className="text-sm font-medium">
            {state.by ? fillWords(w.onBy, { when: when(state.at), by: state.by }) : fillWords(w.on, { when: when(state.at) })}
          </p>
          <p>
            <Link href={`/admin/${state.store ?? HOUSE_STORE_SLUG}/pages`} className="inline-flex min-h-10 items-center rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink">
              {w.edit}
            </Link>
          </p>
          <p className="text-sm text-ink-2">{w.back}</p>
          <div>
            <SubmitButton variant="secondary">{w.switchOff}</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    );
  }
  const copied = state.copiedAt !== null;
  return (
    <Card title={w.title} description={w.description}>
      <ActionForm action={on} className="flex flex-col gap-4">
        <p className="text-sm text-ink-2">{w.off}</p>
        <ol className="list-decimal pl-5 text-sm">
          <li>{w.steps.copy}</li>
          <li>
            <Link href={`/admin/${state.store ?? HOUSE_STORE_SLUG}/pages`} className="underline">
              {w.steps.look}
            </Link>
          </li>
          <li>{w.steps.press}</li>
        </ol>
        {copied ? (
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input type="checkbox" name="looked" required className="size-4" />
            {w.looked}
          </label>
        ) : (
          <p className="text-sm text-ink-2">{w.copyFirst}</p>
        )}
        <div>
          <SubmitButton disabled={!copied}>{w.switchOn}</SubmitButton>
        </div>
      </ActionForm>
    </Card>
  );
}
