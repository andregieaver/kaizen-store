import { Button, Card, Chip } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import type { DealsMessages } from "@/lib/admin-messages/deals.en";
import type { Lead } from "@/lib/leads";

/**
 * The leads inbox (S4, D475): one row a person who asked for something and is not a customer yet, the newest first, with what they asked
 * for and the latest words of it; Homer presses *Make a deal* (the deal opens) or *Dismiss*. A member who may only read sees the list.
 */
export function LeadsList({
  leads,
  words: w,
  when,
  actions,
}: {
  leads: Lead[];
  words: DealsMessages["leads"];
  /** A date as the viewer reads it. */
  when: (iso: string) => string;
  actions: { make: (email: string) => () => Promise<void>; dismiss: (email: string) => () => Promise<void> } | null;
}) {
  return (
    <Card title={w.tab} compact>
      <p className="mb-4 text-sm text-muted">{leads.length === 0 ? w.none : w.intro}</p>
      {leads.length > 0 && (
        <ul className="flex flex-col divide-y divide-line">
          {leads.map((lead) => {
            const name = lead.name || lead.email;
            const excerpt = lead.items.find((i) => i.excerpt)?.excerpt ?? null;
            return (
              <li key={lead.email} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="text-ink">
                    {name}
                    {lead.name && <span className="text-muted"> · {lead.email}</span>}
                  </p>
                  <p className="flex flex-wrap items-center gap-2 text-muted">
                    {[...new Set(lead.items.map((i) => i.kind))].map((kind) => (
                      <Chip key={kind}>{w.kinds[kind]}</Chip>
                    ))}
                    <span>{when(lead.latest)}</span>
                  </p>
                  {excerpt && <p className="line-clamp-2 text-ink-2">{excerpt}</p>}
                </div>
                {actions && (
                  <div className="flex flex-wrap gap-2">
                    <form action={actions.make(lead.email)}>
                      <Button type="submit" kind="main" size="dense" aria-label={fillWords(w.makeDealOf, { name })}>
                        {w.makeDeal}
                      </Button>
                    </form>
                    <form action={actions.dismiss(lead.email)}>
                      <Button type="submit" kind="secondary" size="dense" aria-label={fillWords(w.dismissOf, { name })}>
                        {w.dismiss}
                      </Button>
                    </form>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
