"use client";

import Link from "next/link";
import { useState } from "react";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { useAdminText } from "@/components/admin/admin-text";
import { buttonClass } from "@/components/admin/ui/button";
import { numberShownByDefault, REGISTRATION_LIMITS, type Registration, type RegistrationKind, type SchemeId } from "@/lib/producer-registrations";

/**
 * Adding or changing a producer responsibility registration (wave 7 unit H, D342). Homer picks the scheme and the country, types the number and
 * who gave it, and saves; the first day is today and the number's place on product pages is ticked where we know a country asks for it.
 * Saying that no registration is needed in a country is one choice away, with the reason in the owner's words.
 */

/** A server action bound to the store, as `ActionForm` takes it. */
type FormAction = Parameters<typeof ActionForm>[0]["action"];

type Props = {
  action: FormAction;
  schemes: { id: SchemeId; label: string }[];
  markets: { code: string; name: string }[];
  today: string;
  /** The registration being changed; absent to add one. `scheme` and `market` start a new one for what is missing. */
  editing?: Registration | null;
  start?: { scheme: SchemeId; market: string } | null;
  cancelHref?: string;
  disabled?: boolean;
};

const FIELD = "min-h-10 rounded-md border border-line bg-card px-3";

export function ProducerRegistrationForm({ action, schemes, markets, today, editing = null, start = null, cancelHref, disabled = false }: Props) {
  const w = useAdminText("settingsProducer").producer;
  const [scheme, setScheme] = useState<SchemeId>(editing?.scheme ?? start?.scheme ?? schemes[0]?.id ?? "packaging");
  const [market, setMarket] = useState(editing?.market ?? start?.market ?? markets[0]?.code ?? "");
  const [kind, setKind] = useState<RegistrationKind>(editing?.kind ?? "registered");
  // The tick follows the scheme and country until the owner sets it themselves.
  const [shownTouched, setShownTouched] = useState(editing !== null);
  const [shown, setShown] = useState(editing ? editing.showNumber : numberShownByDefault(scheme, market));
  const showNumber = shownTouched ? shown : numberShownByDefault(scheme, market);
  /** On a phone (round 43, D740) whether registered, showing the number and the last day wait behind More; an edit starts with them open. */
  const [more, setMore] = useState(editing !== null);
  const later = more ? "" : "max-sm:hidden";
  const p = w.phone;

  return (
    <ActionForm action={action} className="flex flex-col gap-4" successMessage={w.saved}>
      {editing && <input type="hidden" name="id" value={editing.id} />}
      {/* A field the browser finds empty opens the phone's More, so its message can point at it. */}
      <fieldset disabled={disabled} className="flex flex-col gap-4" onInvalidCapture={() => setMore(true)}>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex min-w-0 flex-col gap-1 text-sm">
            <span className="text-body-strong">{w.scheme}</span>
            <select name="scheme" value={scheme} onChange={(e) => setScheme(e.target.value as SchemeId)} className={FIELD}>
              {schemes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-sm">
            <span className="text-body-strong">{w.country}</span>
            <select name="market" value={market} onChange={(e) => setMarket(e.target.value)} className={FIELD}>
              {markets.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <fieldset className={`flex flex-col gap-2 text-sm ${later}`}>
          <legend className="mb-1 text-body-strong">{w.kind}</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="kind" value="registered" checked={kind === "registered"} onChange={() => setKind("registered")} />
            {w.kindRegistered}
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="kind" value="exempt" checked={kind === "exempt"} onChange={() => setKind("exempt")} />
            {w.kindExempt}
          </label>
        </fieldset>

        {kind === "registered" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-body-strong">{w.number}</span>
              <input name="number" required maxLength={REGISTRATION_LIMITS.number} defaultValue={editing?.number ?? ""} className={FIELD} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-body-strong">{w.authority}</span>
              <input name="authority" required maxLength={REGISTRATION_LIMITS.authority} defaultValue={editing?.authority ?? ""} className={FIELD} />
              <span className="text-caption text-muted max-sm:hidden">{w.authorityHint}</span>
            </label>
            <label className={`flex items-start gap-2 text-sm sm:col-span-2 ${later}`}>
              <input
                type="checkbox"
                name="showNumber"
                checked={showNumber}
                onChange={(e) => {
                  setShownTouched(true);
                  setShown(e.target.checked);
                }}
                className="mt-1"
              />
              <span>
                {w.showNumber}
                <span className="block text-caption text-muted">{w.showNumberHint}</span>
              </span>
            </label>
          </div>
        ) : (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-body-strong">{w.exemption}</span>
            <textarea name="exemption" required rows={2} maxLength={REGISTRATION_LIMITS.exemption} defaultValue={editing?.exemption ?? ""} className="rounded-md border border-line bg-card px-3 py-2" />
            <span className="text-caption text-muted">{w.exemptionHint}</span>
          </label>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-body-strong">{w.validFrom}</span>
            <input type="date" name="validFrom" required defaultValue={editing?.validFrom ?? today} className={FIELD} />
          </label>
          <label className={`flex flex-col gap-1 text-sm ${later}`}>
            <span className="text-body-strong">{w.validTo}</span>
            <input type="date" name="validTo" defaultValue={editing?.validTo ?? ""} className={FIELD} />
            <span className="text-caption text-muted">{w.validToHint}</span>
          </label>
        </div>

        <button
          type="button"
          aria-expanded={more}
          onClick={() => setMore((open) => !open)}
          className="flex min-h-14 items-center justify-between gap-3 border-t border-line py-2 text-left sm:hidden"
        >
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-body text-ink">{p.more}</span>
            <span className="text-caption text-ink-2">
              {[kind === "registered" ? w.kindRegistered : w.kindExempt, kind === "registered" ? (showNumber ? p.shown : p.notShown) : null, p.noEnd].filter(Boolean).join(" · ")}
            </span>
          </span>
          <span className="shrink-0 text-sm font-medium text-ink underline underline-offset-2">{more ? p.done : p.change}</span>
        </button>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton>{w.save}</SubmitButton>
          {cancelHref && (
            <Link href={cancelHref} className={buttonClass("secondary", "card")}>
              {w.cancel}
            </Link>
          )}
        </div>
      </fieldset>
    </ActionForm>
  );
}

/** One registration's Remove button. */
export function RemoveRegistration({ action, id }: { action: FormAction; id: string }) {
  const w = useAdminText("settingsProducer").producer;
  return (
    <ActionForm action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="secondary">{w.remove}</SubmitButton>
    </ActionForm>
  );
}
