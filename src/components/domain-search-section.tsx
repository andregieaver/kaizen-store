import type { DomainSearchBlock } from "@/lib/page-content";
import { platformPath } from "@/lib/platform-lang";
import { platformText } from "@/lib/platform-text";
import { SUGGESTED_TLDS } from "@/lib/domain-search";
import type { GridPlace } from "@/server/content-grid";

import { buttonLook } from "./button-look";
import { DomainSearchBox } from "./lazy/blocks";

/**
 * The domain search component on Kaizena Flow's own pages (D315, `docs/domains.md` 16): the page's own words, else the language's
 * (`platformText(lang).domainSearch`), prices in the block's currency, else NOK in Norwegian and EUR otherwise, and each free name's button
 * to sign-up with the name kept.
 */
export function DomainSearchSection({ block, place }: { block: DomainSearchBlock; place: GridPlace }) {
  const lang = place.lang ?? "en";
  const w = platformText(lang).domainSearch;
  const look = buttonLook(undefined);
  return (
    <DomainSearchBox
      words={{
        heading: block.heading ?? "",
        placeholder: block.placeholder || w.placeholder,
        search: block.buttonLabel || w.search,
        searching: w.searching,
        states: w.states,
        firstYear: w.firstYear,
        thenYearly: w.thenYearly,
        cta: block.ctaLabel || w.cta,
        unavailable: w.unavailable,
        note: w.note,
        label: w.label,
      }}
      tlds={block.tlds && block.tlds.length > 0 ? block.tlds : SUGGESTED_TLDS}
      currency={block.currency ?? (lang === "nb" ? "NOK" : "EUR")}
      locale={lang === "nb" ? "nb-NO" : "en-GB"}
      ctaHref={block.ctaHref || platformPath(lang, "/sign-up")}
      button={{ className: look.className, style: look.style }}
    />
  );
}
