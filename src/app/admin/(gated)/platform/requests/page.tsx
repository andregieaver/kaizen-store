import { adminDate, PLATFORM_TIME_ZONE } from "@/lib/admin-date";
import { storeBase, storeHref } from "@/lib/paths";
import type { Metadata } from "next";

import { PhoneRow, PhoneRows } from "@/components/admin/phone-row";
import Link from "next/link";
import { connection } from "next/server";
import { Fragment } from "react";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { suggestSlug } from "@/lib/slug";
import { designLookValue, type DesignCard } from "@/lib/design-presets";
import { requirePlatformReader } from "@/server/auth";
import { isSlugTaken, listAccessRequests, type AccessRequest } from "@/server/platform";
import { designChoices } from "@/server/design-presets";
import { CARD_CLASS, Card, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf, type AdminLang } from "@/lib/admin-lang";
import type { PlatformMessages } from "@/lib/admin-messages/platform.en";

type W = PlatformMessages["requests"];

import { decideAction, sandboxAction, selfServeAction } from "../actions";
import { selfServeOn, unconfirmedCount } from "@/server/self-signup";
import { sandboxCounts, sandboxSettings } from "@/server/sandbox";
import { SANDBOX_PATH } from "@/lib/sandbox";
import { PLATFORM_WORDS } from "@/lib/admin-words/platform";

export const metadata: Metadata = { title: "Access requests" };

const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";

/** Platform admins approve beta requests here; approval creates the store. */
export default async function PlatformPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const account = await requirePlatformReader();
  const lang = adminLangOf(account.adminLocale);
  const w = PLATFORM_WORDS[lang].requests;
  // The themes offered, each look with the demo store it starts a store with (D273); the first card is Standard.
  const [requests, { cards }, selfServe, unconfirmed, sandbox, sandboxes] = await Promise.all([
    listAccessRequests(),
    designChoices(),
    selfServeOn(),
    unconfirmedCount(),
    sandboxSettings(),
    sandboxCounts(),
  ]);
  const designs = cards.filter((card) => card.id);
  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending");

  return (
    <>
      <PageHeader
        title={w.title}
        description={
          <>
            <span className="sm:hidden">{w.phone.lead}</span>
            <span className="max-sm:hidden">{w.description}</span>
          </>
        }
      />

      {/* Round 66 (D835): on a phone the two switches are rows saying on or off, and each waiting request a row whose Approve opens its form. */}
      <PhoneRows>
      <PhoneRow flat title={w.selfServe.title} sub={selfServe ? w.phone.on : w.phone.off} change={w.phone.open} done={w.phone.close}>
      <Card title={w.selfServe.title} description={selfServe ? w.selfServe.on : w.selfServe.off}>
        <div className="flex flex-wrap items-center gap-3">
          <ActionForm action={selfServeAction}>
            {!selfServe && <input type="hidden" name="on" value="on" />}
            <SubmitButton variant="secondary">{selfServe ? w.selfServe.turnOff : w.selfServe.turnOn}</SubmitButton>
          </ActionForm>
          {unconfirmed > 0 && <span className="text-sm text-muted">{fillWords(w.selfServe.unconfirmed, { n: unconfirmed })}</span>}
        </div>
      </Card>
      </PhoneRow>
      <PhoneRow flat last title={w.sandbox.title} sub={sandbox.on ? w.phone.on : w.phone.off} change={w.phone.open} done={w.phone.close}>
      <Card title={w.sandbox.title} description={fillWords(sandbox.on ? w.sandbox.on : w.sandbox.off, { address: SANDBOX_PATH })}>
        <div className="flex flex-wrap items-center gap-3">
          <ActionForm action={sandboxAction}>
            {!sandbox.on && <input type="hidden" name="on" value="on" />}
            <SubmitButton variant="secondary">{sandbox.on ? w.sandbox.turnOff : w.sandbox.turnOn}</SubmitButton>
          </ActionForm>
          <span className="text-sm text-muted">{fillWords(w.sandbox.counts, { today: sandboxes.today, cap: sandbox.dailyCap, open: sandboxes.open })}</span>
        </div>
      </Card>
      </PhoneRow>
      </PhoneRows>

      <section aria-labelledby="pending-heading" className="flex flex-col gap-4">
        <h2 id="pending-heading" className="text-title text-ink">
          {fillWords(w.waiting, { n: pending.length })}
        </h2>
        {pending.length === 0 ? (
          <p className="text-sm text-muted">{w.none}</p>
        ) : (
          <div className="flex flex-col gap-4 max-sm:gap-0 max-sm:overflow-hidden max-sm:rounded-panel">
            {pending.map((request, index) => (
              <PendingRequest key={request.id} request={request} designs={designs} w={w} lang={lang} last={index === pending.length - 1} />
            ))}
          </div>
        )}
      </section>

      {decided.length > 0 && (
        <section aria-labelledby="decided-heading">
          <h2 id="decided-heading" className="mb-3 text-title text-ink">
            {w.decided}
          </h2>
          <ul className={`divide-y divide-line text-sm ${CARD_CLASS}`}>
            {decided.map((request) => (
              <li key={request.id} className="flex flex-wrap justify-between gap-2 px-4 py-2">
                <span>
                  {request.name} · {request.email} · {request.storeName}
                  {request.designTitle && <span className="text-muted">{fillWords(w.theme, { name: request.designTitle })}</span>}
                  {request.starterTitle && <span className="text-muted">{fillWords(w.demo, { name: request.starterTitle })}</span>}
                </span>
                <span className="text-muted">
                  {request.status === "approved" && request.storeSlug ? (
                    <Link href={storeHref(request.storeSlug, storeBase(request.storeSlug))} className="underline">
                      {fillWords(w.approved, { slug: request.storeSlug })}
                    </Link>
                  ) : (
                    (w.status[request.status as keyof W["status"]] ?? request.status)
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

async function PendingRequest({ request, designs, w, lang, last }: { request: AccessRequest; designs: DesignCard[]; w: W; lang: AdminLang; last: boolean }) {
  // A theme the requester chose that is no longer offered (unpublished or archived, D177) gives way to the Standard store, and is said.
  const designGone = request.designPresetId && !designs.some((d) => d.id === request.designPresetId);
  // Suggest a free address; the admin can still change it.
  const base = suggestSlug(request.storeName) || suggestSlug(request.name);
  let slug = base;
  for (let n = 2; slug && n < 10 && (await isSlugTaken(slug)); n += 1) {
    slug = `${base.slice(0, 37)}-${n}`;
  }

  return (
    <PhoneRow
      flat
      last={last}
      title={request.storeName}
      sub={`${request.name} · ${adminDate(PLATFORM_TIME_ZONE, request.createdAt, "day", lang)}`}
      change={w.phone.approve}
      done={w.phone.close}
    >
    <article
      aria-labelledby={`request-${request.id}`}
      className={`flex flex-col gap-4 p-5 ${CARD_CLASS}`}
    >
      <div>
        <h3 id={`request-${request.id}`} className="text-body-strong text-ink">
          {request.storeName}
        </h3>
        <p className="text-sm">
          {request.name} · <a href={`mailto:${request.email}`} className="underline">{request.email}</a> ·{" "}
          <time dateTime={request.createdAt} className="text-muted">
            {adminDate(PLATFORM_TIME_ZONE, request.createdAt, "day", lang)}
          </time>
          {request.hasAccount && <span className="text-muted">{w.hasAccount}</span>}
        </p>
        {request.message && <p className="mt-2 whitespace-pre-line text-sm text-muted">{request.message}</p>}
        {request.keepsSandbox && <p className="mt-2 text-sm text-insight-text">{w.keepsSandbox}</p>}
      </div>
      <ActionForm
        action={decideAction.bind(null, request.id)}
        className="flex flex-col gap-3"
        replaceOnSuccess
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium">
            {w.storeName}
            <input name="storeName" required defaultValue={request.storeName} className={control} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {w.storeAddress}
            <span className="flex items-center gap-1 font-normal">
              <span className="text-muted">/s/</span>
              <input
                name="slug"
                required
                pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]"
                defaultValue={slug}
                autoCapitalize="none"
                spellCheck={false}
                className={`${control} w-full`}
              />
            </span>
          </label>
        </div>
        <label className="flex max-w-md flex-col gap-1 text-sm font-medium">
          {w.themeField}
          <select
            name="design"
            defaultValue={designGone || !request.designPresetId ? "" : designLookValue(request.designPresetId, request.designVariation)}
            className={control}
          >
            <option value="">{w.standard}</option>
            {designs.map((design) => (
              <Fragment key={design.id}>
                <option value={design.id}>{lookOption(design.title, design.demo, w)}</option>
                {/* Its presets (`docs/theme-showcase-phase-1.md` step 4), each with the demo store it starts with (D273). */}
                {(design.looks ?? []).map((look) => (
                  <option key={look.key} value={designLookValue(design.id, look.key)}>
                    {lookOption(`${design.title} · ${look.name}`, look.demo, w)}
                  </option>
                ))}
              </Fragment>
            ))}
          </select>
          <span className="font-normal text-muted">
            {designGone
              ? fillWords(w.gone, { name: request.designTitle ?? w.aTheme })
              : request.designPresetId
                ? w.chosen
                : w.choseNone}
          </span>
        </label>
        <div className="flex flex-wrap gap-3">
          <SubmitButton name="decision" value="approve">
            {w.approve}
          </SubmitButton>
          <SubmitButton name="decision" value="decline" variant="secondary" skipValidation>
            {w.decline}
          </SubmitButton>
        </div>
      </ActionForm>
    </article>
    </PhoneRow>
  );
}

/** A look as the Theme field lists it: its name and the demo store it starts a store with (D273). */
const lookOption = (name: string, demo: string | null | undefined, w: W) => (demo ? fillWords(w.withDemo, { name, demo }) : name);
