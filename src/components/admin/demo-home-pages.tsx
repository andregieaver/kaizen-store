import type { FormState } from "@/components/admin/action-form";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { ButtonLink, Card, List, ListRow, RowActions, RowLead } from "@/components/admin/ui";

import { DemoHomeTakeLine, type DemoHomeTake } from "./demo-home-take";

export type DemoHomeOffer = { pack: string; name: string; trade: string; previewHref: string };

/**
 * Home pages from the demo stores on a store's Pages list (`docs/theme-showcase-phase-1.md` step 4c): each content pack's home page, to look
 * at and to take as the front page in one press, and, after taking one, *Put back your front page* (`DemoHomeTakeLine`). Each press is a form.
 */
export function DemoHomePages({
  offers,
  take,
  editBase,
  use,
  undo,
}: {
  offers: DemoHomeOffer[];
  take: DemoHomeTake | null;
  /** The store's pages in the admin, to edit the page taken. */
  editBase: string;
  use: (state: FormState, data: FormData) => Promise<FormState>;
  undo: (state: FormState, data: FormData) => Promise<FormState>;
}) {
  if (offers.length === 0 && !take) return null;
  return (
    <Card
      title="Home pages from the demo stores"
      description="Start your front page from the home page of one of Kaizena Flow's demo stores. It follows your theme; its words and pictures are the demo store's until you change them. Your front page now stays among your pages, and you can put it back."
      compact
    >
      <DemoHomeTakeLine take={take} editBase={editBase} undo={undo} />
      {offers.length > 0 && (
        <List label="Demo stores' home pages">
          {offers.map((offer) => (
            <ListRow key={offer.pack}>
              <RowLead title={offer.name} sub={offer.trade} />
              <RowActions>
                <ButtonLink href={offer.previewHref} target="_blank" rel="noopener">
                  Look at it<span className="sr-only"> ({offer.name}, opens in a new window)</span>
                </ButtonLink>
                <ActionForm action={use}>
                  <input type="hidden" name="pack" value={offer.pack} />
                  <SubmitButton variant="secondary">
                    Use this home page<span className="sr-only"> from {offer.name}</span>
                  </SubmitButton>
                </ActionForm>
              </RowActions>
            </ListRow>
          ))}
        </List>
      )}
    </Card>
  );
}
