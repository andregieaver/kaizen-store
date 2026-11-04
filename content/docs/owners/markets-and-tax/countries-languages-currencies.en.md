---
title: Countries, languages and currencies
summary: Choose the countries you sell to, the languages and currencies shoppers can pick, and the exchange rates prices are converted at.
track: owners
section: markets-and-tax
kind: how-to
areas: [markets, settings]
features: [countries, languages, currencies]
plans: []
admin: /admin/{store}/settings/countries
order: 10
checked: 2026-11-04
sources: [D109, D110, D111, D178, D335, D338]
---

## How it works

Each country you sell to is its own storefront, with its own address, prices, shipping and VAT. A country starts in its own language
and currency. A product shows in a country once it has a price there.

One country is your own: your business's country under [Company](/admin/{store}/settings/company) when you sell there, else the first
country on your list. Amounts in your reports are in its currency.

## Sell in another country

Selling in more than one country is a feature you switch on first.

1. Open **Settings** in the menu and choose [Features](/admin/{store}/settings/features). Under *Countries and languages*, switch on
   **Several countries**. Only an owner can switch features on or off.
2. Open [Countries](/admin/{store}/settings/countries), under Store. Tick the country under **Countries you sell to** and press
   **Save countries**.
3. Give your products a price in the new country, in each product's editor. Or let the country's prices be worked out from another
   country's, under **Prices in each country** on the same page: see [Prices](/docs/owners/products/prices).
4. Set what shipping costs there: see [Shipping rates](/docs/owners/shipping/shipping-rates).

To stop selling in a country, untick it and press **Save countries**. A country taken off the list keeps its prices and settings, and
comes back as it was when you add it again.

While **Several countries** is off, the page asks for **The country you sell in**: one country. Choosing another makes it the only one;
the others keep their prices and settings.

> [!NOTE]
> Switching **Several countries** off again stops offering your other countries. Their addresses lead to your own country, and orders
> already placed there keep their pages and links.

## Languages and currencies

Language and currency are chosen apart from the country. A shopper in Norway can read your store in English and see prices in euro.
Shoppers choose both in the header, and the choice is in the address: `/no-en-eur` is Norway, in English, in euro.

Other languages are offered only while **Several languages** is on, and other currencies only while **Several currencies** is on. Both
are switched on under Settings, Features. Then open [Languages and currencies](/admin/{store}/settings/localization), under Store.
Only an owner can change this page; other members can read it.

### Languages

Tick **Offer** for each language you want, choose the **Main** one and press **Save languages**.

- The main language is the one you write in first. Products, pages, menus and emails can be written in each of the others too.
- Under **Each country's language**, choose what each country shows at its own address. Shoppers can still switch to any other language
  you offer.
- A language a country shows by default is marked *a country's language* and cannot be removed.
- Each language says how far the store's own buttons, cart, checkout and emails are in it. Norwegian, Swedish, Danish and English are
  written by hand. Another language shows English until Kaizena Flow translates it.

While **Several languages** is off, you choose only the **Main language** and **Each country's language**, and press **Save language**.

### Currencies

Tick **Offer** for each currency you want, and press **Save currencies**.

- Prices are kept in each country's own currency and converted when a shopper chooses another. A shopper who pays in euro is charged in
  euro.
- **Rate per 1 EUR** is how many units of the currency one euro buys, as the European Central Bank (ECB) publishes them. A currency
  needs a rate, and so does each country's own, before amounts can be shown in it.
- **Round to** rounds converted prices to a step, so they look like prices. **No rounding** keeps them exact.
- A country's own currency is marked *a country's currency* and is always offered.
- Subscriptions and subscription boxes are sold only in a country's own currency.

### Exchange rates

Tick **Keep the rates up to date from the ECB every day**, or press **Fetch the ECB's rates now** for today's rates. You can also type
your own rate in **Rate per 1 EUR**. The page says when the rates were last updated from the ECB.

## More options

### Each country's own content

- **A page or article for some countries only.** In the page builder, under **Who may read it**, choose **Only some countries** under
  **Countries**. In the other countries the page is not shown, listed or in the sitemap.
- **Another description in one country.** In a product's editor, open **A different description in one country**: for example a German
  text for Austria beside Germany's. The title stays the same everywhere.
- **Another menu label in one country.** In the menu editor, a link has **A different label in one country**.
- **Not sold in one country.** In a product's editor, untick the country under **Sold in**. Its price there is kept for when you tick
  it again.

A visitor from another of your countries is offered a link to the same page in their country. They are never moved there.

### A domain for a country

A store that sells in several countries can give one of them its own domain. Under [Domains](/admin/{store}/settings/domains), open
**Use for one country** under a domain and choose the country. Your own country keeps the store's main address. A store gives domains to
its countries or to its languages, not both. See [SEO, redirects and domains](/docs/owners/website/seo-redirects-and-domains).

### Translate the store with AI

[Translate the store](/admin/{store}/translate), under Website, translates products, menus, pages, articles and more into another of your
languages in one go. The AI suggests; you read each text and tick the ones to keep, and nothing is written until you save.

- Pages are saved as drafts, so nothing is published for you. Products, menus and custom fields are live once saved.
- Legal texts (terms, privacy, returns, withdrawal and safety information) start unticked: read them yourself.
- Texts written for one country are never translated: each is the country's own.
- The store needs an AI text model, chosen under Settings, AI.

See [AI texts and pictures](/docs/owners/ai/ai-texts-and-pictures).
