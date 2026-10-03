import { connection } from "next/server";

import { chooseReviews } from "@/lib/google-reviews";
import { t } from "@/lib/i18n";
import type { TestimonialsBlock } from "@/lib/page-content";
import type { GridPlace } from "@/server/content-grid";
import { placeReviews } from "@/server/google-reviews";
import { storeSlugOf } from "@/server/menus";
import { getOpenStore } from "@/server/stores";

import { StarRating } from "./star-rating";
import { TestimonialCards } from "./testimonials-view";
import { marketIn } from "@/server/shop";

/**
 * Testimonials from Google (D91): the owner's business's rating and
 * reviews, asked of Google as the page is shown and never kept, in the
 * page's language, with Google named as their source and each reviewer's
 * name linking to their profile there. Reviewers' pictures are left out,
 * as loading them would tell Google about the visitor. Nothing shows when
 * Google is not set up or does not answer.
 */
export async function GoogleReviewsSection({ block, place }: { block: TestimonialsBlock; place: GridPlace }) {
  await connection();
  let locale = "en";
  if (place.owner) {
    const slug = await storeSlugOf(place.owner);
    const store = slug ? await getOpenStore(slug) : null;
    const market = store ? marketIn(store, place.market) : undefined;
    if (market) locale = market.locale;
  }
  const found = await placeReviews(place.owner, locale);
  if (!found) return null;
  const reviews = chooseReviews(found.reviews, { minRating: block.minRating, limit: block.limit });
  if (reviews.length === 0) return null;
  const m = t(locale.split("-")[0]);
  const rating = found.rating === null ? null : new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(found.rating);
  return (
    <div className="flex flex-col gap-5">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {found.rating !== null && <StarRating stars={found.rating} />}
        <span>{rating ? m.googleRating(rating, found.count) : m.googleReviews}</span>
        {found.mapsUrl && (
          <a href={found.mapsUrl} target="_blank" rel="noopener noreferrer" className="underline">
            {m.seeOnGoogle}
          </a>
        )}
      </p>
      <TestimonialCards
        entries={reviews.map((review) => ({
          key: review.key,
          quote: review.text,
          name: review.author,
          role: review.when,
          rating: review.rating,
          nameHref: review.authorUrl ?? undefined,
        }))}
        columns={block.columns}
        look={block.look}
        showRating={block.showRating !== false}
        carousel={block.display === "carousel"}
        carouselSettings={block.carousel}
      />
    </div>
  );
}
