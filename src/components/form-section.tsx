import { formAsBlock, formTakesAnswers } from "@/lib/form-records";
import { publicForm } from "@/lib/forms";
import type { EmailFormBlock, FormBlock, NewsletterBlock } from "@/lib/page-content";
import type { GridPlace } from "@/server/content-grid";
import { t } from "@/lib/i18n";
import { formPaymentOffer } from "@/server/form-payments";
import { siteForm } from "@/server/form-site";
import { storeSlugOf } from "@/server/menus";
import { getOpenStore } from "@/server/stores";

import { SiteForm } from "./site-form";
import { marketIn } from "@/server/shop";

/**
 * A page's form on the site (D93): drawn in the page's language, sending
 * for the page's owner. Only what the visitor needs reaches the browser
 * (`publicForm()`): where it sends stays on the server. A `form` component
 * (D705) draws the owner's form it names, read through the forms cache, and
 * nothing while it is archived, gone or cannot deliver.
 */
export async function FormSection({ block, place }: { block: EmailFormBlock | NewsletterBlock | FormBlock; place: GridPlace }) {
  let lang = "en";
  if (place.owner) {
    const slug = await storeSlugOf(place.owner);
    const store = slug ? await getOpenStore(slug) : null;
    const market = store ? marketIn(store, place.market) : undefined;
    if (market) lang = market.lang;
  }
  if (block.type !== "form") return <SiteForm form={publicForm(block)} store={place.owner} lang={lang} />;
  const form = block.formId ? await siteForm(place.owner, block.formId) : null;
  if (!form || !formTakesAnswers(form)) return null;
  // A form with a payment (D738 F6c) says what is paid and its price in this market, worded here so visitors' scripts carry no more words.
  const offer = place.owner && form.paymentVariantId ? await formPaymentOffer(place.owner, form.paymentVariantId, place.market) : null;
  return (
    <div>
      {/* A saved form's views (M4.3, D871): a lazy one-pixel image, fetched by the browser only as the form comes near view (and not while
          its popup is closed), counted by `/api/forms/seen`. No script, cookie or storage. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- a counter, not a picture: next/image would cache and resize it. */}
      <img
        src={`/api/forms/seen?form=${form.id}${place.owner ? `&store=${place.owner}` : ""}`}
        alt=""
        aria-hidden
        loading="lazy"
        width={1}
        height={1}
        className="pointer-events-none absolute size-px opacity-0"
      />
      <SiteForm
        form={publicForm(formAsBlock(form, lang, { button: block.button, layout: block.layout, fieldStyle: block.fieldStyle }))}
        store={place.owner}
        lang={lang}
        market={place.market}
        payNote={offer ? t(lang).form.payNote(offer.title, offer.price) : undefined}
      />
    </div>
  );
}
