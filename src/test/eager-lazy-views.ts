import { vi } from "vitest";

import { settleSiteWords } from "@/components/admin/site-words";

/** A component of a module, or nothing when the module cannot load in a unit test (one that reaches server-only code). */
async function pick(load: () => Promise<Record<string, unknown>>, name: string): Promise<unknown> {
  try {
    return (await load())[name];
  } catch {
    return undefined;
  }
}

/**
 * Unit tests draw pages with `renderToStaticMarkup()`, which cannot wait for a part loaded with `next/dynamic` (D211,
 * `components/lazy/`) and would draw its fallback instead. Here every stand-in is the component itself, so the tests see what the
 * server streams. Whether the visitor's scripts leave them out is `storefront-bundle.scan.test.ts`'s and `e2e/performance.spec.ts`'s.
 */
vi.mock("@/components/lazy/blocks", async () => ({
  GalleryLightbox: await pick(() => import("@/components/gallery-lightbox"), "GalleryLightbox"),
  GalleryFade: await pick(() => import("@/components/gallery-fade"), "GalleryFade"),
  BrandsCarousel: await pick(() => import("@/components/brands-carousel"), "BrandsCarousel"),
  TabsView: await pick(() => import("@/components/tabs-view"), "TabsView"),
  TableScroll: await pick(() => import("@/components/table-scroll"), "TableScroll"),
  UploadedVideo: await pick(() => import("@/components/video-view"), "UploadedVideo"),
  AnimationPlayer: await pick(() => import("@/components/animation-view"), "AnimationPlayer"),
  EmbeddedVideo: await pick(() => import("@/components/video-view"), "EmbeddedVideo"),
  BackgroundVideo: await pick(() => import("@/components/background-video"), "BackgroundVideo"),
  HtmlFrame: await pick(() => import("@/components/html-frame"), "HtmlFrame"),
  PageModal: await pick(() => import("@/components/page-modal"), "PageModal"),
  RecommendedGrid: await pick(() => import("@/components/recommended-grid"), "RecommendedGrid"),
  SearchBox: await pick(() => import("@/components/search-box"), "SearchBox"),
  ThemePreviewStage: await pick(() => import("@/components/theme-preview-stage"), "ThemePreviewStage"),
  LanguageSwitch: await pick(() => import("@/components/language-switch"), "LanguageSwitch"),
  CarouselControls: await pick(() => import("@/components/carousel-controls"), "CarouselControls"),
}));

vi.mock("@/components/lazy/shop", async () => ({
  CheckoutForm: await pick(() => import("@/components/checkout-form"), "CheckoutForm"),
  DetailsForm: await pick(() => import("@/components/account-forms"), "DetailsForm"),
  PasswordForm: await pick(() => import("@/components/account-forms"), "PasswordForm"),
  SignOutButton: await pick(() => import("@/components/account-forms"), "SignOutButton"),
  AvatarPicker: await pick(() => import("@/components/avatar-picker"), "AvatarPicker"),
  SubscriptionButton: await pick(() => import("@/components/subscription-button"), "SubscriptionButton"),
  SubscriptionContentsForm: await pick(() => import("@/components/subscription-contents-form"), "SubscriptionContentsForm"),
  WishlistView: await pick(() => import("@/components/wishlist-view"), "WishlistView"),
  BonusCreditsForm: await pick(() => import("@/components/bonus-credits-form"), "BonusCreditsForm"),
  DeliverySetupForm: await pick(() => import("@/app/s/[store]/[market]/(shop)/deliveries/delivery-forms"), "DeliverySetupForm"),
  DeliveryAddressForm: await pick(() => import("@/app/s/[store]/[market]/(shop)/deliveries/delivery-forms"), "DeliveryAddressForm"),
  ConfirmButton: await pick(() => import("@/app/s/[store]/[market]/(shop)/deliveries/delivery-forms"), "ConfirmButton"),
}));

vi.mock("@/components/lazy/extras", async () => ({
  ConsentManager: await pick(() => import("@/components/consent/consent-manager"), "ConsentManager"),
  StoreCustomCode: await pick(() => import("@/components/consent/store-custom-code"), "StoreCustomCode"),
  ChatWidget: await pick(() => import("@/components/chat-widget"), "ChatWidget"),
  AffiliateCapture: await pick(() => import("@/components/affiliate-capture"), "AffiliateCapture"),
}));

/**
 * The field card imports the fields form, which imports these stand-ins: awaiting the card inside this factory would wait for itself. So the
 * card is loaded without waiting and the stand-in draws it once it is there (nothing here when the card cannot load in a unit test).
 */
vi.mock("@/components/admin/lazy/editors", async () => {
  let card: ((props: never) => unknown) | undefined;
  void pick(() => import("@/components/admin/entity-fields-card"), "EntityFieldsCard").then((c) => {
    card = c as ((props: never) => unknown) | undefined;
  });
  return {
    RichTextEditor: await pick(() => import("@/components/admin/rich-text-editor"), "RichTextEditor"),
    EntityFieldsCard: (props: never) => card?.(props) ?? null,
    MarkupInput: await pick(() => import("@/components/admin/markup-input"), "MarkupInput"),
    InlineMarkupEditor: await pick(() => import("@/components/inline-edit/markup-editor"), "InlineMarkupEditor"),
    InlineRichEditor: await pick(() => import("@/components/inline-edit/rich-text-inline"), "InlineRichEditor"),
    warmEditors: () => {},
  };
});

/**
 * The builder's previews read one storefront language with `useSiteWords()`, which gives nothing until the language has been fetched
 * (`components/admin/site-words.ts`): a unit test cannot wait, so the four languages are settled here and a preview draws their words at once.
 */
for (const [lang, load] of [
  ["en", () => import("@/lib/messages/en").then((m) => m.en)],
  ["nb", () => import("@/lib/messages/nb").then((m) => m.nb)],
  ["sv", () => import("@/lib/messages/sv").then((m) => m.sv)],
  ["da", () => import("@/lib/messages/da").then((m) => m.da)],
] as const) {
  try {
    settleSiteWords(lang, await load());
  } catch {
    // A language that cannot load in a unit test stays unsettled: a preview of it draws nothing.
  }
}
