import { vi } from "vitest";

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
  EmbeddedVideo: await pick(() => import("@/components/video-view"), "EmbeddedVideo"),
  BackgroundVideo: await pick(() => import("@/components/background-video"), "BackgroundVideo"),
  HtmlFrame: await pick(() => import("@/components/html-frame"), "HtmlFrame"),
  PageModal: await pick(() => import("@/components/page-modal"), "PageModal"),
  RecommendedGrid: await pick(() => import("@/components/recommended-grid"), "RecommendedGrid"),
  SearchBox: await pick(() => import("@/components/search-box"), "SearchBox"),
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
  DeliverySetupForm: await pick(() => import("@/app/s/[store]/[market]/deliveries/delivery-forms"), "DeliverySetupForm"),
  DeliveryAddressForm: await pick(() => import("@/app/s/[store]/[market]/deliveries/delivery-forms"), "DeliveryAddressForm"),
  ConfirmButton: await pick(() => import("@/app/s/[store]/[market]/deliveries/delivery-forms"), "ConfirmButton"),
}));

vi.mock("@/components/lazy/extras", async () => ({
  ConsentManager: await pick(() => import("@/components/consent/consent-manager"), "ConsentManager"),
  StoreCustomCode: await pick(() => import("@/components/consent/store-custom-code"), "StoreCustomCode"),
  ChatWidget: await pick(() => import("@/components/chat-widget"), "ChatWidget"),
  AffiliateCapture: await pick(() => import("@/components/affiliate-capture"), "AffiliateCapture"),
}));
