"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

import { lazyView, showChildren } from "./lazy-view";

/**
 * The interactive parts of page components (a Before and after's slider, a gallery's lightbox and fade, a logo carousel, tabs, a table that scrolls, videos,
 * embedded HTML, a modal, the recommended grid and search), each loaded only on a page that draws it (D211, `lazyView()`).
 * Those wrapping the server's content show it while their script loads. A form is not here, nor a listing's filter button: what
 * a visitor types or presses before its script runs would be lost, so they are in the page's first scripts.
 */
export const GalleryLightbox = lazyView(dynamic(() => import("../gallery-lightbox").then((m) => m.GalleryLightbox)), showChildren);
export const BeforeAfterSlider = lazyView(dynamic(() => import("../before-after-slider").then((m) => m.BeforeAfterSlider)), showChildren);
export const GalleryFade = lazyView(dynamic(() => import("../gallery-fade").then((m) => m.GalleryFade)));
export const BrandsCarousel = lazyView(dynamic(() => import("../brands-carousel").then((m) => m.BrandsCarousel)));
export const TabsView = lazyView(dynamic(() => import("../tabs-view").then((m) => m.TabsView)));
export const TableScroll = lazyView(dynamic(() => import("../table-scroll").then((m) => m.TableScroll)), showChildren);
export const UploadedVideo = lazyView(dynamic(() => import("../video-view").then((m) => m.UploadedVideo)));
export const AnimationPlayer = lazyView(dynamic(() => import("../animation-view").then((m) => m.AnimationPlayer)));
export const EmbeddedVideo = lazyView(dynamic(() => import("../video-view").then((m) => m.EmbeddedVideo)));
export const BackgroundVideo = lazyView(dynamic(() => import("../background-video").then((m) => m.BackgroundVideo)));
export const HtmlFrame = lazyView(dynamic(() => import("../html-frame").then((m) => m.HtmlFrame)));
export const PageModal = lazyView(dynamic(() => import("../page-modal").then((m) => m.PageModal)));
export const RecommendedGrid = lazyView(dynamic(() => import("../recommended-grid").then((m) => m.RecommendedGrid)), showChildren);
export const SearchBox = lazyView(dynamic(() => import("../search-box").then((m) => m.SearchBox)));
export const DomainSearchBox = lazyView(dynamic(() => import("../domain-search-box").then((m) => m.DomainSearchBox)));
/** A product tile's stock and Add to cart (D557): loaded only on a page whose grids show them; nothing is drawn until the facts arrive. */
export const TileShop = lazyView(dynamic(() => import("../tile-shop").then((m) => m.TileShop)));
/** A countdown to a fixed moment (D561): drawn in the browser only, gone at zero. */
export const CountdownView = lazyView(dynamic(() => import("../countdown-view").then((m) => m.CountdownView)));
/** Figures that count up as they come into view (D561); the server's HTML holds them as typed. */
export const StatsView = lazyView(dynamic(() => import("../stats-view").then((m) => m.StatsView)));
/** The theme store's preview stage (D247): drawn only on the theme pages. */
export const ThemePreviewStage = lazyView(dynamic(() => import("../theme-preview-stage").then((m) => m.ThemePreviewStage)));
/** The language switch (D479, D312): drawn only where a site offers more than one language. */
export const LanguageSwitch = lazyView(dynamic(() => import("../language-switch").then((m) => m.LanguageSwitch)));
/** A carousel's controls (D155): the frame (`carousel.tsx`) draws the row and the arrows as the server does until they are here. */
export const CarouselControls = lazyView(
  dynamic(() => import("../carousel-controls").then((m) => m.CarouselControls)),
  ({ still }: { still?: ReactNode }) => still,
);
