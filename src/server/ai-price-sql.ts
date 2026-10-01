import "server-only";

import { sql } from "drizzle-orm";

/**
 * What a call costs, in SQL (D145, D146), written once for every report: the usage pages, the unpriced list and the
 * recommendations' monthly figure. `callCost()` in `src/lib/ai-cost.ts` works the same sums in code, and a test holds the two
 * together. All join `commerce.ai_usage` as `u` and the price as `p`.
 */

/**
 * The price in force for a call: the provider's price for the model (exactly, or as the start of a dated version's name
 * before a dash) that had begun when the call was made, the most specific model first and the latest start.
 * `matchPrice()` in `src/lib/ai-cost.ts` reads prices the same way.
 */
export const priceFor = sql`
  left join lateral (
    select pr.id, pr.input_per_million, pr.output_per_million, pr.per_image, pr.per_audio_minute, pr.per_million_characters
    from commerce.ai_model_prices pr
    where pr.provider = u.provider and (pr.model = u.model or left(u.model, length(pr.model) + 1) = pr.model || '-') and pr.effective_from <= u.created_at
    order by length(pr.model) desc, pr.effective_from desc
    limit 1
  ) p on true
`;

/**
 * A call's cost in millionths of a dollar. Dollars per million tokens (or characters) is the same number as millionths per
 * token (or character); a picture's and a minute's prices are in dollars. Null without a price.
 */
export const costMicrosSql = sql`round(
  u.input_tokens * p.input_per_million + u.output_tokens * p.output_per_million
  + u.images * coalesce(p.per_image, 0) * 1000000
  + u.audio_seconds * coalesce(p.per_audio_minute, 0) * 1000000 / 60
  + u.characters * coalesce(p.per_million_characters, 0)
)`;

/**
 * A call that did something but cannot be priced: its model has no price, or it made pictures, spoke or listened with no
 * price for that. A unit counts only where the call reported no tokens (a model billed by tokens for its pictures or audio is
 * priced by them), so the cost is not left short by what the call has no other way to measure.
 */
export const unpricedSql = sql`(
  u.input_tokens + u.output_tokens + u.images + u.audio_seconds + u.characters > 0
  and (
    p.id is null
    or (u.input_tokens + u.output_tokens = 0 and (
      (u.images > 0 and p.per_image is null)
      or (u.audio_seconds > 0 and p.per_audio_minute is null)
      or (u.characters > 0 and p.per_million_characters is null)
    ))
  )
)`;
