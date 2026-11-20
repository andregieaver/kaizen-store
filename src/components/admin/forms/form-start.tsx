import { CATEGORY_ICONS, type FormTemplateItem } from "@/lib/form-templates";
import type { AdminLang } from "@/lib/admin-lang";
import { countWords, fillWords } from "@/lib/admin-fill";
import { FORM_TEMPLATES_WORDS } from "@/lib/admin-words/form-templates";
import { FORMS_WORDS } from "@/lib/admin-words/forms";
import { QuietActionForm } from "@/components/admin/quiet-action-form";

import { NavIcon, type NavIconName } from "../nav-icons";
import { CARD_CLASS } from "../ui";

type Card = { key: string; icon: NavIconName; name: string; text: string; kind: string; note?: string; starter?: string | null };

/**
 * Starting a form (D705): templates as cards, each one press from a form that is ready to place (it sends to the owner's own address).
 * Kaizena Flow's and the owner's own first, with a blank form; the marketplace's one step away (F4). `make` is the owner's action, bound
 * to the template's id (`blank` for the blank form); it opens the new form. A hidden template is not offered.
 */
export function FormStart({ lang, items, make }: { lang: AdminLang; items: (FormTemplateItem & { hidden: boolean })[]; make: (key: string) => Promise<void> }) {
  const w = FORMS_WORDS[lang];
  const t = FORM_TEMPLATES_WORDS[lang];
  const card = (item: FormTemplateItem): Card => ({
    key: item.id,
    icon: CATEGORY_ICONS[item.category] as NavIconName,
    name: item.name,
    text: item.description,
    kind: [w.kinds[item.kind], item.kind === "message" ? countWords(item.questions, t.questions) : null].filter(Boolean).join(" · "),
    note: item.publisher ? fillWords(t.by, { name: item.publisher }) : undefined,
    starter: item.starterKey,
  });
  const offered = items.filter((i) => !i.hidden);
  const kaizen = offered.filter((i) => i.source === "kaizen").map(card);
  const own = offered.filter((i) => i.source === "own" || i.source === "stores").map(card);
  const market = offered.filter((i) => i.source === "marketplace").map(card);
  const blank: Card = { key: "blank", icon: "files", name: w.start.blank, text: w.start.blankText, kind: w.kinds.message };
  return (
    <div className="flex flex-col gap-8">
      {own.length > 0 && <Cards title={t.own} cards={own} make={make} />}
      <Cards title={own.length > 0 ? t.kaizen : undefined} cards={[...kaizen, blank]} make={make} />
      {market.length > 0 && (
        <details className="group" data-form-marketplace>
          <summary className="cursor-pointer text-body-strong text-ink">{t.marketplace}</summary>
          <p className="mt-1 mb-4 text-body text-ink-2">{t.marketplaceHint}</p>
          <Cards cards={market} make={make} />
        </details>
      )}
    </div>
  );
}

function Cards({ title, cards, make }: { title?: string; cards: Card[]; make: (key: string) => Promise<void> }) {
  return (
    <section className="flex flex-col gap-3">
      {title && <h2 className="text-title text-ink">{title}</h2>}
      {/* Round 69 (D844): on a phone the templates are rows of one card (a small icon, the name, what it asks and its kind); from sm up the cards. */}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 max-sm:gap-0 max-sm:divide-y max-sm:divide-line max-sm:overflow-hidden max-sm:rounded-card max-sm:bg-card" data-form-starters>
        {cards.map((c) => (
          <li key={c.key}>
            <QuietActionForm action={make.bind(null, c.key)} className="h-full">
              <button
                type="submit"
                className={`${CARD_CLASS} flex h-full w-full flex-col items-start gap-2 p-5 text-left transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 max-sm:min-h-14 max-sm:flex-row max-sm:items-center max-sm:gap-3 max-sm:rounded-none max-sm:bg-transparent max-sm:px-4 max-sm:py-2 max-sm:hover:shadow-none`}
                data-starter={c.starter ?? (c.key === "blank" ? "blank" : undefined)}
                data-template={c.key}
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-panel bg-sunken text-ink-2 max-sm:size-8">
                  <NavIcon name={c.icon} className="size-5 max-sm:size-4" />
                </span>
                <span className="flex w-full min-w-0 flex-1 flex-col gap-2 max-sm:gap-0.5">
                  <span className="text-body-strong text-ink max-sm:text-body">{c.name}</span>
                  {c.text && (
                    <span className="text-body text-ink-2 max-sm:text-caption">
                      {c.text}
                      <span className="sm:hidden">
                        {" · "}
                        {c.kind}
                        {c.note && ` · ${c.note}`}
                      </span>
                    </span>
                  )}
                  <span className={`mt-auto pt-2 text-caption text-muted ${c.text ? "max-sm:hidden" : "max-sm:pt-0"}`}>
                    {c.kind}
                    {c.note && ` · ${c.note}`}
                  </span>
                </span>
              </button>
            </QuietActionForm>
          </li>
        ))}
      </ul>
    </section>
  );
}
