"use client";

import Link from "next/link";

import { fillWords } from "@/lib/admin-fill";
import { EXTENSION_TRIAL_DAYS, type ExtensionId } from "@/lib/extensions";

import { ActionForm, SubmitButton, type FormState } from "./action-form";
import { useAdminText } from "./admin-text";

/**
 * An extension's marker (D748 E5, section 5 of the spec): what a page of a paid extension the account does not have shows in its place, in
 * the account's language from `common.extensions`. Words for what the owner gets, and one press to try it free (`tryAction`); for a member
 * who cannot buy, "Ask your account owner". Never a greyed-out copy of the page. After a trial the extension is read-only, not absent: its
 * pages open, and the store frame's banner offers Subscribe.
 */
export function ExtensionOffPanel({
  extension,
  owner,
  tryAction,
}: {
  extension: ExtensionId;
  owner: boolean;
  tryAction: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const w = useAdminText("common").extensions;
  const name = w.names[extension];
  return (
    <section aria-labelledby="extension-off-heading" className="flex flex-col gap-3 rounded-panel bg-sunken p-5">
      <h1 id="extension-off-heading" className="text-xl font-medium">
        {name}
      </h1>
      <p className="text-sm">{w.pitch[extension]}</p>
      {owner ? (
        <div className="flex flex-wrap items-center gap-3">
          <ActionForm action={tryAction}>
            <SubmitButton>{fillWords(w.tryFree, { days: EXTENSION_TRIAL_DAYS })}</SubmitButton>
          </ActionForm>
          <Link href="/admin/account/extensions" className="text-sm underline underline-offset-2">
            {w.allExtensions}
          </Link>
        </div>
      ) : (
        <p className="text-sm text-muted">{w.askOwner}</p>
      )}
      <p className="text-caption text-muted">{w.hidden}</p>
    </section>
  );
}
