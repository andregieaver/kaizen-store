import { FORM_STARTERS, starterDescription, starterName } from "@/lib/form-records";
import type { AdminLang } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

import { NavIcon, type NavIconName } from "../nav-icons";
import { CARD_CLASS } from "../ui";

/**
 * Starting a form (D705): Kaizena Flow's starters as cards and a blank form, each one press from a form that is ready to place (it sends to the
 * owner's own address). `make` is the owner's action, bound to the starter's key (`blank` for the blank form); it opens the new form.
 */
export function FormStart({ lang, siteLang, make }: { lang: AdminLang; siteLang: string; make: (key: string) => Promise<void> }) {
  const w = adminText(lang, "forms");
  const cards = [
    ...FORM_STARTERS.map((s) => ({ key: s.key, icon: s.icon as NavIconName, name: starterName(s, siteLang), text: starterDescription(s, siteLang), kind: w.kinds[s.kind] })),
    { key: "blank", icon: "files" as NavIconName, name: w.start.blank, text: w.start.blankText, kind: w.kinds.message },
  ];
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-form-starters>
      {cards.map((card) => (
        <li key={card.key}>
          <form action={make.bind(null, card.key)} className="h-full">
            <button
              type="submit"
              className={`${CARD_CLASS} flex h-full w-full flex-col items-start gap-2 p-5 text-left transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2`}
              data-starter={card.key}
            >
              <span className="flex size-10 items-center justify-center rounded-panel bg-sunken text-ink-2">
                <NavIcon name={card.icon} className="size-5" />
              </span>
              <span className="text-body-strong text-ink">{card.name}</span>
              <span className="text-body text-ink-2">{card.text}</span>
              <span className="mt-auto pt-2 text-caption text-muted">{card.kind}</span>
            </button>
          </form>
        </li>
      ))}
    </ul>
  );
}
