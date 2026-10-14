import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { Card } from "@/components/admin/ui";
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
}: {
  market: { code: string; name: string };
  zones: ZoneItem[];
  canWrite: boolean;
  save: (zoneId: string | null) => Action;
  remove: (zoneId: string) => Action;
  /** *Check a postal code*, for those who may change the settings; null hides it. */
  check: Action | null;
}) {
  const help = `Postal codes like 0150, or prefixes like 01* for every code starting with 01, separated by commas, spaces or lines. A code belongs to the zone with the most specific pattern; codes in no zone are Rest of country. At most ${PATTERNS_MAX} codes and ${PATTERN_CHARS_MAX.toLocaleString("en-GB")} characters a zone.`;
  return (
    <div className="flex flex-col gap-6">
      {check && (
      <Card title="Check a postal code" description={`Which zone a code in ${market.name} falls in, and which methods have a rate there.`}>
        <ActionForm action={check} className="flex flex-wrap items-end gap-3" successMessage="">
          <label className="flex flex-col gap-1 text-sm">
            Postal code
            <input name="code" required maxLength={20} className={`${control} max-w-40`} autoComplete="off" />
          </label>
          <SubmitButton variant="secondary">Check</SubmitButton>
        </ActionForm>
      </Card>
      )}

      <Card title={`Zones in ${market.name}`} count={zones.length} description={help}>
        {zones.length === 0 ? (
          <p className="text-sm text-muted">No zones: every postal code in {market.name} is Rest of country.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {zones.map((zone) => (
              <li key={zone.id} className="flex flex-col gap-3 py-4">
                <ActionForm action={save(zone.id)} className="flex flex-col gap-3">
                  <label className="flex flex-col gap-1 text-sm">
                    Name
                    <input name="name" required maxLength={60} defaultValue={zone.name} className={`${control} max-w-md`} disabled={!canWrite} />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    Postal codes and prefixes ({zone.patterns.length})
                    <textarea name="patterns" required rows={3} defaultValue={zone.patterns.join(", ")} className={`${control} py-2 font-mono`} disabled={!canWrite} />
                  </label>
                  {canWrite && (
                    <div>
                      <SubmitButton variant="secondary">Save zone</SubmitButton>
                    </div>
                  )}
                </ActionForm>
                {canWrite && (
                  <ActionForm action={remove(zone.id)} className="flex items-center gap-3">
                    <button type="submit" className="inline-flex h-8 items-center rounded-pill bg-danger-soft px-3 text-sm text-danger-text">
                      Delete {zone.name}
                    </button>
                    <span className="text-sm text-muted">Its rates go with it, and its codes become Rest of country.</span>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canWrite &&
        (zones.length >= ZONES_MAX ? (
          <p className="text-sm text-muted">{market.name} has {ZONES_MAX} zones, the most a country can have.</p>
        ) : (
          <Card title="Add a zone" description="Then give it rates on each method's page; a method with no rate for a zone is not offered there.">
            <ActionForm action={save(null)} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm">
                Name
                <input name="name" required maxLength={60} placeholder="Northern Norway" className={`${control} max-w-md`} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Postal codes and prefixes
                <textarea name="patterns" required rows={3} placeholder="8*, 9*" className={`${control} py-2 font-mono`} />
              </label>
              <div>
                <SubmitButton>Add zone</SubmitButton>
              </div>
            </ActionForm>
          </Card>
        ))}
    </div>
  );
}
