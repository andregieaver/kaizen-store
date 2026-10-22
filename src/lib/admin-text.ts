import type { AdminLang } from "./admin-lang";
import { commonEn, type CommonMessages } from "./admin-messages/common.en";
import { commonNb } from "./admin-messages/common.nb";
import { domainsEn, type DomainsMessages } from "./admin-messages/domains.en";
import { domainsNb } from "./admin-messages/domains.nb";
import { ordersEn, type OrdersMessages } from "./admin-messages/orders.en";
import { ordersNb } from "./admin-messages/orders.nb";
import { orderEn, type OrderMessages } from "./admin-messages/order.en";
import { orderNb } from "./admin-messages/order.nb";
import { draftsEn, type DraftsMessages } from "./admin-messages/drafts.en";
import { draftsNb } from "./admin-messages/drafts.nb";
import { returnsEn, type ReturnsMessages } from "./admin-messages/returns.en";
import { returnsNb } from "./admin-messages/returns.nb";
import { invoicesEn, type InvoicesMessages } from "./admin-messages/invoices.en";
import { invoicesNb } from "./admin-messages/invoices.nb";
import { productsEn, type ProductsMessages } from "./admin-messages/products.en";
import { productsNb } from "./admin-messages/products.nb";
import { productEn, type ProductMessages } from "./admin-messages/product.en";
import { productNb } from "./admin-messages/product.nb";
import { inventoryEn, type InventoryMessages } from "./admin-messages/inventory.en";
import { inventoryNb } from "./admin-messages/inventory.nb";
import { giftCardsEn, type GiftCardsMessages } from "./admin-messages/gift-cards.en";
import { giftCardsNb } from "./admin-messages/gift-cards.nb";
import { reviewsEn, type ReviewsMessages } from "./admin-messages/reviews.en";
import { reviewsNb } from "./admin-messages/reviews.nb";
import { fieldsEn, type FieldsMessages } from "./admin-messages/fields.en";
import { fieldsNb } from "./admin-messages/fields.nb";
import { customersEn, type CustomersMessages } from "./admin-messages/customers.en";
import { customersNb } from "./admin-messages/customers.nb";
import { privacyEn, type PrivacyMessages } from "./admin-messages/privacy.en";
import { privacyNb } from "./admin-messages/privacy.nb";
import { marketingEn, type MarketingMessages } from "./admin-messages/marketing.en";
import { marketingNb } from "./admin-messages/marketing.nb";
import { discountsEn, type DiscountsMessages } from "./admin-messages/discounts.en";
import { discountsNb } from "./admin-messages/discounts.nb";
import { builderEn, type BuilderMessages } from "./admin-messages/builder.en";
import { builderNb } from "./admin-messages/builder.nb";
import { blocksEn, type BlocksMessages } from "./admin-messages/blocks.en";
import { blocksNb } from "./admin-messages/blocks.nb";
import { websiteEn, type WebsiteMessages } from "./admin-messages/website.en";
import { websiteNb } from "./admin-messages/website.nb";
import { designEn, type DesignMessages } from "./admin-messages/design.en";
import { designNb } from "./admin-messages/design.nb";
import { redirectsEn, type RedirectsMessages } from "./admin-messages/redirects.en";
import { redirectsNb } from "./admin-messages/redirects.nb";
import { experimentsEn, type ExperimentsMessages } from "./admin-messages/experiments.en";
import { experimentsNb } from "./admin-messages/experiments.nb";
import { settingsEn, type SettingsMessages } from "./admin-messages/settings.en";
import { settingsNb } from "./admin-messages/settings.nb";
import { taxEn, type TaxMessages } from "./admin-messages/tax.en";
import { taxNb } from "./admin-messages/tax.nb";
import { paymentsEn, type PaymentsMessages } from "./admin-messages/payments.en";
import { paymentsNb } from "./admin-messages/payments.nb";
import { shippingEn, type ShippingMessages } from "./admin-messages/shipping.en";
import { shippingNb } from "./admin-messages/shipping.nb";
import { notificationsEn, type NotificationsMessages } from "./admin-messages/notifications.en";
import { notificationsNb } from "./admin-messages/notifications.nb";
import { legalEn, type LegalMessages } from "./admin-messages/legal.en";
import { legalNb } from "./admin-messages/legal.nb";
import { staffEn, type StaffMessages } from "./admin-messages/staff.en";
import { staffNb } from "./admin-messages/staff.nb";
import { billingEn, type BillingMessages } from "./admin-messages/billing.en";
import { billingNb } from "./admin-messages/billing.nb";
import { loyaltyEn, type LoyaltyMessages } from "./admin-messages/loyalty.en";
import { loyaltyNb } from "./admin-messages/loyalty.nb";
import { homeEn, type HomeMessages } from "./admin-messages/home.en";
import { homeNb } from "./admin-messages/home.nb";
import { platformLegalEn, type PlatformLegalMessages } from "./admin-messages/platform-legal.en";
import { platformLegalNb } from "./admin-messages/platform-legal.nb";
import { shellEn, type ShellMessages } from "./admin-messages/shell.en";
import { shellNb } from "./admin-messages/shell.nb";
import { setupEn, type SetupMessages } from "./admin-messages/setup.en";
import { setupNb } from "./admin-messages/setup.nb";
import { signInEn, type SignInMessages } from "./admin-messages/sign-in.en";
import { signInNb } from "./admin-messages/sign-in.nb";

/**
 * The admin's words by area and language (D312, `docs/platform-admin-i18n.md` 3.3): one pair of catalogues per area in
 * `src/lib/admin-messages/{area}.{lang}.ts`, English the type. A new area is its two files and an entry here; an area is converted with
 * the screens that show it, and `admin-strings.scan.test.ts` holds what is converted.
 */
export type AdminAreaMessages = {
  common: CommonMessages;
  domains: DomainsMessages;
  home: HomeMessages;
  customers: CustomersMessages;
  privacy: PrivacyMessages;
  marketing: MarketingMessages;
  discounts: DiscountsMessages;
  loyalty: LoyaltyMessages;
  settings: SettingsMessages;
  tax: TaxMessages;
  payments: PaymentsMessages;
  shipping: ShippingMessages;
  notifications: NotificationsMessages;
  legal: LegalMessages;
  staff: StaffMessages;
  billing: BillingMessages;
  builder: BuilderMessages;
  blocks: BlocksMessages;
  website: WebsiteMessages;
  design: DesignMessages;
  redirects: RedirectsMessages;
  experiments: ExperimentsMessages;
  products: ProductsMessages;
  product: ProductMessages;
  inventory: InventoryMessages;
  giftCards: GiftCardsMessages;
  reviews: ReviewsMessages;
  fields: FieldsMessages;
  orders: OrdersMessages;
  order: OrderMessages;
  drafts: DraftsMessages;
  returns: ReturnsMessages;
  invoices: InvoicesMessages;
  platformLegal: PlatformLegalMessages;
  setup: SetupMessages;
  shell: ShellMessages;
  signIn: SignInMessages;
};

export type AdminArea = keyof AdminAreaMessages;

const CATALOGUES: { [A in AdminArea]: Record<AdminLang, AdminAreaMessages[A]> } = {
  common: { en: commonEn, nb: commonNb },
  domains: { en: domainsEn, nb: domainsNb },
  home: { en: homeEn, nb: homeNb },
  customers: { en: customersEn, nb: customersNb },
  privacy: { en: privacyEn, nb: privacyNb },
  marketing: { en: marketingEn, nb: marketingNb },
  discounts: { en: discountsEn, nb: discountsNb },
  loyalty: { en: loyaltyEn, nb: loyaltyNb },
  settings: { en: settingsEn, nb: settingsNb },
  tax: { en: taxEn, nb: taxNb },
  payments: { en: paymentsEn, nb: paymentsNb },
  shipping: { en: shippingEn, nb: shippingNb },
  notifications: { en: notificationsEn, nb: notificationsNb },
  legal: { en: legalEn, nb: legalNb },
  staff: { en: staffEn, nb: staffNb },
  billing: { en: billingEn, nb: billingNb },
  builder: { en: builderEn, nb: builderNb },
  blocks: { en: blocksEn, nb: blocksNb },
  website: { en: websiteEn, nb: websiteNb },
  design: { en: designEn, nb: designNb },
  redirects: { en: redirectsEn, nb: redirectsNb },
  experiments: { en: experimentsEn, nb: experimentsNb },
  products: { en: productsEn, nb: productsNb },
  product: { en: productEn, nb: productNb },
  inventory: { en: inventoryEn, nb: inventoryNb },
  giftCards: { en: giftCardsEn, nb: giftCardsNb },
  reviews: { en: reviewsEn, nb: reviewsNb },
  fields: { en: fieldsEn, nb: fieldsNb },
  orders: { en: ordersEn, nb: ordersNb },
  order: { en: orderEn, nb: orderNb },
  drafts: { en: draftsEn, nb: draftsNb },
  returns: { en: returnsEn, nb: returnsNb },
  invoices: { en: invoicesEn, nb: invoicesNb },
  platformLegal: { en: platformLegalEn, nb: platformLegalNb },
  setup: { en: setupEn, nb: setupNb },
  shell: { en: shellEn, nb: shellNb },
  signIn: { en: signInEn, nb: signInNb },
};

/** An area's words in `lang`, on the server; a client part reads its area's slice through `useAdminText()`. */
export function adminText<A extends AdminArea>(lang: AdminLang, area: A): AdminAreaMessages[A] {
  return CATALOGUES[area][lang];
}

/** The slices a layout hands to its client parts (`AdminTextProvider`): the areas named, in `lang`. */
export function adminTexts<A extends AdminArea>(lang: AdminLang, areas: readonly A[]): Pick<AdminAreaMessages, A> {
  return Object.fromEntries(areas.map((area) => [area, adminText(lang, area)])) as Pick<AdminAreaMessages, A>;
}

