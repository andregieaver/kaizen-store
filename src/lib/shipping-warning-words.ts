import { countWords, fillWords } from "./admin-fill";
import type { ShippingMessages } from "./admin-messages/shipping.en";
import type { ShippingWarning } from "./shipping-methods";

/**
 * A Shipping hub's warning in words, naming the country: the hub draws it, and the AI manager's shipping tool says it in English
 * (`SHIPPING_WARNING_WORDS`). Here rather than beside the hub's view (D873): the tool is server code that the storefront's routes reach
 * through `import()`, and through the view they reached the admin kit, whose client parts Next then put in every visitor's first scripts.
 */
export function warningWords(warning: ShippingWarning, marketName: (code: string) => string, words: ShippingMessages["hub"]["warnings"]): string {
  const w = words;
  switch (warning.code) {
    case "no_flat_with_methods":
    case "zones_without_rest":
    case "subscriptions_need_flat":
      return fillWords(w[warning.code], { market: marketName(warning.marketCode) });
    case "default_weight_used":
      return countWords(warning.variants, w.default_weight_used);
  }
}
