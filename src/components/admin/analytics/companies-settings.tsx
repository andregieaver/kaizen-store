import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import type { CompaniesMessages } from "@/lib/admin-messages/companies.en";

import { TextInput, Field } from "../ui/field";
import { AdminLink } from "../ui/link";
import { StatusPill } from "./data-table";
import { AnalyticsSection, Note, WhatAndNot } from "./section";

/**
 * Which companies visited on Analytics → Settings (D890, `docs/analytics.md` "Companies"): one switch for Homer, what it does and does not
 * see, and, for a platform admin, Kaizena Flow's Leadfeeder connection (the key shown by its hint only). Drawn on the server from plain
 * props; every form posts.
 */

type FormAction = (state: FormState, form: FormData) => Promise<FormState>;

export type CompaniesSettings = {
  on: boolean;
  /** The store may switch it on (Kaizena Flow's own store, until it is opened to every store). */
  available: boolean;
  /** Visit counting is on: companies are found from counted visits. */
  visitCounting: boolean;
  /** Kaizena Flow's Leadfeeder connection, by its key's hint; null when none is saved. */
  connection: { keyHint: string; accountId: string } | null;
  /** The member is a platform admin, who alone sees and changes the connection. */
  platformAdmin: boolean;
  /** The Companies page. */
  pageHref: string;
};

export type CompaniesActions = { set: FormAction; saveConnection: FormAction; removeConnection: FormAction };

const card = "flex flex-col gap-4 rounded-lg border border-line bg-card p-5";

export function CompaniesSection({ companies, actions, words }: { companies: CompaniesSettings; actions: CompaniesActions | null; words: CompaniesMessages }) {
  const w = words.settings;
  const c = w.connection;
  const canSwitchOn = companies.available && companies.visitCounting;
  return (
    <AnalyticsSection id="companies" title={w.title} description={w.description}>
      <div className={card}>
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill tone={companies.on ? "good" : "neutral"}>{companies.on ? w.on : w.off}</StatusPill>
          <p className="text-sm">{companies.on ? w.stateOn : w.stateOff}</p>
          {companies.on ? (
            <AdminLink href={companies.pageHref} className="text-sm underline">
              {w.seePage}
            </AdminLink>
          ) : null}
        </div>

        <WhatAndNot whatTitle={w.whatTitle} what={w.what} notTitle={w.notTitle} not={w.not} />
        <p className="text-sm text-muted">{w.keep}</p>

        {!companies.available ? <Note>{w.notAvailable}</Note> : !companies.visitCounting && !companies.on ? <Note>{w.needsVisits}</Note> : null}

        {actions && (companies.on || canSwitchOn) ? (
          <ActionForm action={actions.set} className="flex flex-col gap-3">
            <div>
              <SubmitButton name="enabled" value={companies.on ? "off" : "on"} variant={companies.on ? "secondary" : "primary"}>
                {companies.on ? w.turnOff : w.turnOn}
              </SubmitButton>
            </div>
          </ActionForm>
        ) : null}

        {companies.platformAdmin && companies.available ? (
          <div className="flex flex-col gap-3 border-t border-line pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-body-strong text-ink">{c.title}</h3>
              <StatusPill tone={companies.connection ? "good" : "neutral"}>{companies.connection ? c.connected : c.notConnected}</StatusPill>
            </div>
            <p className="text-sm text-muted">{c.description}</p>
            {actions ? (
              <ActionForm action={actions.saveConnection} className="flex flex-col gap-4">
                <Field label={c.key} hint={companies.connection ? fillWords(c.keySaved, { hint: companies.connection.keyHint }) : c.keyHelp} className="max-w-96">
                  {(control) => <TextInput {...control} name="api_key" type="password" autoComplete="off" />}
                </Field>
                <Field label={c.account} hint={c.accountHelp} required className="max-w-48">
                  {(control) => <TextInput {...control} name="account_id" inputMode="numeric" pattern="[0-9]{1,20}" defaultValue={companies.connection?.accountId ?? ""} autoComplete="off" />}
                </Field>
                <div>
                  <SubmitButton variant={companies.connection ? "secondary" : "primary"}>{c.save}</SubmitButton>
                </div>
              </ActionForm>
            ) : null}
            {actions && companies.connection ? (
              <ActionForm action={actions.removeConnection}>
                <SubmitButton variant="secondary">{c.remove}</SubmitButton>
              </ActionForm>
            ) : null}
          </div>
        ) : null}
      </div>
    </AnalyticsSection>
  );
}
