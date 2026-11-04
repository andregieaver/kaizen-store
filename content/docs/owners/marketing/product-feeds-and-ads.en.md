---
title: Product feeds, ads and conversions
summary: Show your products on Google Shopping, Meta, TikTok and Pinterest with a product feed, and tell your ad platforms about checkouts and purchases from shoppers who allowed marketing cookies.
track: owners
section: marketing
kind: how-to
areas: [marketing, integrations]
features: []
plans: []
admin: /admin/{store}/feeds
order: 60
checked: 2026-11-04
sources: [D58, D302, D303, D353]
---

## Product feeds

A product feed is your products as a file that Google Merchant Center, Meta, TikTok or Pinterest reads by itself. You paste its address
into the channel once, and the channel fetches it on its own schedule.

1. Open **Marketing** in the menu and choose [Product feeds](/admin/{store}/feeds). Press **Turn on product feeds**.
2. Each country you sell in has its own **Addresses to paste**: **Google Merchant Center**, **Meta (Facebook and Instagram)**,
   **TikTok** and **Pinterest**. Press **Copy** beside the one you need.
3. Paste the address into the channel's own account, as the channel asks for a feed address.

Each variant is one item, with its price as that country's storefront shows it, VAT included, its stock, GTIN, brand, pictures, and your
flat shipping rate. When a price is genuinely reduced, Google's feed gives the lowest price of the last 30 days as the price and the new
one as the sale price. Prices and stock in the feeds are at most 15 minutes old. Channels can fetch the feeds only while your store is
open.

### Products left out

Under **Not in the feeds**, each country lists the products left out and why: *not goods or a download*, *sold only by subscription*,
*for businesses only*, *no picture*, *no price* or *price on request*. Add a picture or a price and the product comes in by itself.

### Keep the address to yourself

The address is secret: anyone who has it can read the feed. If it gets out, press **Make a new address**. The old one stops at once, so
paste the new one into each channel. **Turn off** stops all feeds.

> [!NOTE]
> The same page has **Shopping agents**, which lets AI assistants that shop for people search your products and put a cart together for
> the shopper to pay in your own checkout, and a **ChatGPT shopping feed**. Both are off until you switch them on.

## Ad tags in the browser

Open **Settings** and choose [Cookies and tracking](/admin/{store}/settings/cookies). Under **Analytics and marketing tools**, paste the
id of each tool you use: **Google Analytics 4**, **Google Tag Manager**, **Meta Pixel**, **Google Ads**, **TikTok Pixel** or
**Pinterest Tag**, and press **Save tools**. Leave a field empty to switch the tool off.

Each tool loads only after a visitor allows it in the cookie banner, which appears by itself once a tool is on. With consent, the tools
hear product views, list views, searches and adds to the cart, with product ids and prices only. Checkouts and purchases are not sent
from the browser: they go from the server, as below.

## Conversions from the server

Sales sent from the server are counted even when a shopper uses an ad blocker.

1. Open **Marketing** and choose [Ads and conversions](/admin/{store}/ads).
2. Under the platform, paste its id and token: for **Meta (Facebook and Instagram)** the **Pixel id** and a
   **Conversions API access token**; for **Google Analytics 4** the **Measurement id (G-…)** and a **Measurement Protocol API secret**;
   for **TikTok** the **Pixel code** and an **Events API access token**; for **Pinterest** the **Ad account id** and a
   **Conversions token**.
3. Choose **What to send**: **Standard**, the order and the ad's click id with nothing personal, or **Enhanced**, which also sends the
   shopper's email and phone, hashed, so more sales are matched to ads.
4. Tick **Send events** and press **Save**. A **Test event code (optional)** from the platform lets you check events there first.

From then on, each order made and each payment taken is sent within a minute, but only for shoppers who allowed marketing cookies. A
purchase paid in test mode is never sent. The page shows the last 7 days: how many were sent, not sent and failed, with the reason.

The shopper's IP address and browser details are never sent, as Kaizena Flow keeps neither. Refunds are not sent. Purchases reach Google
Ads through its link with Google Analytics. Only the store's owner can connect a platform, change it or press **Disconnect**.

## Cookie consent

Your store asks visitors about cookies only when something needs their consent, such as a tool above. The banner offers *Reject all* and
*Accept all* equally, with a choice per kind of cookie, and visitors can change their choice later from your cookie page. A visitor who
says no to marketing is not tracked by ad tags and sends no conversions, and a referral or creator link they opened is remembered only
until they leave the site.

To see which channels and campaigns bring sales, open **Analytics**, **Marketing** ([Analytics](/docs/owners/analytics/analytics)).
