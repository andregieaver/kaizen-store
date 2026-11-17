import { AdminLink, Button, Card, Chip } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import type { DealsMessages } from "@/lib/admin-messages/deals.en";
import { leadKindLinks, type Lead, type LeadSource } from "@/lib/leads";

/**
 * The leads inbox (S4, D475): one row a person who asked for something and is not a customer yet, the newest first, with what they asked
 * for and the latest words of it; Homer presses *Make a deal* (the deal opens) or *Dismiss*. A member who may only read sees the list.
 * What they asked for opens where it is kept (ecosystem plan E2.8, D713): the quote's draft, the conversation, the form's responses, the
 * subscriber, for a viewer who may open that page (`open`).
 */
export function LeadsList({
  leads,
  words: w,
  when,
  actions,
  base,
  open,
}: {
  leads: Lead[];
  words: DealsMessages["leads"];
  /** A date as the viewer reads it. */
  when: (iso: string) => string;
  actions: { make: (email: string) => () => Promise<void>; dismiss: (email: string) => () => Promise<void> } | null;
  /** The store's admin address. */
  base: string;
  /** The sources whose pages the viewer may open. */
  open: Partial<Record<LeadSource, boolean>>;
}) {
  return (
    <Card compact>
      {leads.length === 0 ? (
        <p className="text-sm text-muted">{w.none}</p>
      ) : (
        <ul aria-label={w.title} className="flex flex-col divide-y divide-line">
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
                    {leadKindLinks(lead, base, open).map(({ kind, href }) =>
                      href ? (
                        <AdminLink key={kind} href={href} className="rounded-pill hover:opacity-80" aria-label={fillWords(w.openKinds[kind], { name })}>
                          <Chip>{w.kinds[kind]} →</Chip>
                        </AdminLink>
                      ) : (
                        <Chip key={kind}>{w.kinds[kind]}</Chip>
                      ),
                    )}
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
