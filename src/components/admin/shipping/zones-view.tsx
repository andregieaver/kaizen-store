import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { Card } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { shippingEn, type ShippingMessages } from "@/lib/admin-messages/shipping.en";
import { PATTERN_CHARS_MAX, PATTERNS_MAX, ZONES_MAX } from "@/lib/shipping-limits";

/**
 * One country's zones (D237, `docs/wave-3-shipping-methods.md` 2.1): each with its name and postal codes and prefixes (typed as a list, cleaned by
 * the country's rule when saved), a form to add one, and *Check a postal code*, which says which zone a code falls in and which methods have a rate
 * there before anything is saved. Presentational: the page binds the actions.
 */

type Action = (state: FormState, form: FormData) => Promise<FormState>;

export type ZoneItem = { id: string; name: string; patterns: string[] };

const control = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";

export function ZonesView({
  market,
  zones,
  canWrite,
  save,
  remove,
  check,
  words: w = shippingEn.zones,
  locale = "en-GB",
}: {
  market: { code: string; name: string };
  zones: ZoneItem[];
  canWrite: boolean;
  save: (zoneId: string | null) => Action;
  remove: (zoneId: string) => Action;
  /** *Check a postal code*, for those who may change the settings; null hides it. */
  check: Action | null;
  /** The view's words and how numbers are written, in the admin's language (D312 A8); English unless given. */
  words?: ShippingMessages["zones"];
  locale?: string;
}) {
  const help = fillWords(w.help, { patterns: PATTERNS_MAX, chars: PATTERN_CHARS_MAX.toLocaleString(locale) });
  return (
    <div className="flex flex-col gap-6">
      {check && (
      <Card title={w.checkTitle} description={fillWords(w.checkDescription, { market: market.name })}>
        <ActionForm action={check} className="flex flex-wrap items-end gap-3" successMessage="">
          <label className="flex flex-col gap-1 text-sm">
            {w.postalCode}
            <input name="code" required maxLength={20} className={`${control} max-w-40`} autoComplete="off" />
          </label>
          <SubmitButton variant="secondary">{w.check}</SubmitButton>
        </ActionForm>
      </Card>
      )}

      <Card title={fillWords(w.title, { market: market.name })} count={zones.length} description={help}>
        {zones.length === 0 ? (
          <p className="text-sm text-muted">{fillWords(w.empty, { market: market.name })}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {zones.map((zone) => (
              <li key={zone.id} className="flex flex-col gap-3 py-4">
                <ActionForm action={save(zone.id)} className="flex flex-col gap-3">
                  <label className="flex flex-col gap-1 text-sm">
                    {w.name}
                    <input name="name" required maxLength={60} defaultValue={zone.name} className={`${control} max-w-md`} disabled={!canWrite} />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    {fillWords(w.patternsCount, { n: zone.patterns.length })}
                    <textarea name="patterns" required rows={3} defaultValue={zone.patterns.join(", ")} className={`${control} py-2 font-mono`} disabled={!canWrite} />
                  </label>
                  {canWrite && (
                    <div>
                      <SubmitButton variant="secondary">{w.save}</SubmitButton>
                    </div>
                  )}
                </ActionForm>
                {canWrite && (
                  <ActionForm action={remove(zone.id)} className="flex items-center gap-3">
                    <button type="submit" className="inline-flex h-8 items-center rounded-pill bg-danger-soft px-3 text-sm text-danger-text">
                      {fillWords(w.delete, { name: zone.name })}
                    </button>
                    <span className="text-sm text-muted">{w.deleteNote}</span>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canWrite &&
        (zones.length >= ZONES_MAX ? (
          <p className="text-sm text-muted">{fillWords(w.full, { market: market.name, max: ZONES_MAX })}</p>
        ) : (
          <Card title={w.addTitle} description={w.addDescription}>
            <ActionForm action={save(null)} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm">
                {w.name}
                <input name="name" required maxLength={60} placeholder={w.namePlaceholder} className={`${control} max-w-md`} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                {w.patterns}
                <textarea name="patterns" required rows={3} placeholder="8*, 9*" className={`${control} py-2 font-mono`} />
              </label>
              <div>
                <SubmitButton>{w.add}</SubmitButton>
              </div>
            </ActionForm>
          </Card>
        ))}
    </div>
  );
}
