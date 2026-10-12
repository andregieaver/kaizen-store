"use client";

import dynamic from "next/dynamic";

import { lazyView } from "./lazy-view";

/**
 * Parts of the shop's working pages (the payment form, My account's forms, subscriptions, wishlists, bonus credits, subscription
 * boxes), each loaded only on a page that draws it (D211, `lazyView()`): imported as they are, they were in the first scripts of
 * every page a store builds, because the shop components can stand on any of them (`StorePartSection`). What a shopper came to a
 * page to fill in or press at once is not here, as what is typed before a part's own script runs is lost: the cart's checkout
 * button with its company and VAT fields, the discount codes, the gift box, the delivery choice, signing in and a booking's changes.
 */
export const CheckoutForm = lazyView(dynamic(() => import("../checkout-form").then((m) => m.CheckoutForm)));
export const DetailsForm = lazyView(dynamic(() => import("../account-forms").then((m) => m.DetailsForm)));
export const PasswordForm = lazyView(dynamic(() => import("../account-forms").then((m) => m.PasswordForm)));
export const SignOutButton = lazyView(dynamic(() => import("../account-forms").then((m) => m.SignOutButton)));
export const AvatarPicker = lazyView(dynamic(() => import("../avatar-picker").then((m) => m.AvatarPicker)));
export const SubscriptionButton = lazyView(dynamic(() => import("../subscription-button").then((m) => m.SubscriptionButton)));
export const SubscriptionContentsForm = lazyView(dynamic(() => import("../subscription-contents-form").then((m) => m.SubscriptionContentsForm)));
export const WishlistView = lazyView(dynamic(() => import("../wishlist-view").then((m) => m.WishlistView)));
export const BonusCreditsForm = lazyView(dynamic(() => import("../bonus-credits-form").then((m) => m.BonusCreditsForm)));
export const DeliverySetupForm = lazyView(dynamic(() => import("@/app/s/[store]/[market]/deliveries/delivery-forms").then((m) => m.DeliverySetupForm)));
export const DeliveryAddressForm = lazyView(dynamic(() => import("@/app/s/[store]/[market]/deliveries/delivery-forms").then((m) => m.DeliveryAddressForm)));
export const ConfirmButton = lazyView(dynamic(() => import("@/app/s/[store]/[market]/deliveries/delivery-forms").then((m) => m.ConfirmButton)));
