---
title: Search engines, redirects and domains
summary: Choose how your store shows up in search results and when shared, keep old links working with redirects, and use a domain of your own.
track: owners
section: website
kind: how-to
areas: [website, settings, marketing]
features: []
plans: []
admin: /admin/{store}/settings/seo
order: 50
checked: 2026-11-04
sources: [D168, D313, D315, D338, D339, D358, D385, D445]
---

## How search engines see your store

Open **Settings** in the menu and choose [SEO & Reach](/admin/{store}/settings/seo), under Site. The top of the page says whether
search engines can find your store. Kaizena Flow tells them about every product, in every country you sell to, with its price, stock,
shipping and your return policy, and keeps your **Sitemap**, your **Crawler rules (robots.txt)** and your **Summary for AI assistants
(llms.txt)** up to date. Press any of the three to look at it.

Everything on this page is optional. While your store is not open yet, search engines are kept out; they are welcome once you open it.

What you can add:

- **Your front page in search results**: a title and a description. Empty fields use your store's name and a line Kaizena Flow writes.
- **Share picture**: shown when someone shares your store on Facebook, LinkedIn, Messenger, Slack and the like. It is best at 1200 × 630
  pixels. Product pages use the product's own first picture.
- **Your business elsewhere**: your social profiles and listings, one address per line. They help search engines connect your store to
  your business.
- **AI assistants**: whether AI search and assistants may read your store to answer people's questions, and whether AI companies may
  train their models on its texts and pictures. Both are ticked until you untick them. **Your own words for AI assistants** are added
  to your llms.txt.

Press **Save search and sharing**.

Each page and article has its own search title and description under **Search and sharing** in the
[page builder](/docs/owners/website/the-page-builder). Product categories and tags have theirs too, in each of your languages, where you
edit them under Products.

> [!TIP]
> The page also counts the product pictures described only by the product's title. A few words on what each picture shows help people
> using screen readers, and image search.

### Advanced

- **Ask search engines to leave the store out**: for a store that should be reached only by its link. It takes effect as search engines
  visit again.
- **Extra crawler rules**: your own robots.txt lines (*User-agent*, *Allow* and *Disallow*), with paths from your store's front door.
  Carts and order pages are always left out.
- **Google Search Console code** and **Bing Webmaster Tools code**: paste the code those tools give you to prove the store is yours, then
  submit your sitemap there.

## Keep old links working

When an address changes, a redirect sends shoppers and search engines to the new one, in every country and language. Kaizena Flow makes
one itself when a product, category or tag changes its address, and when you publish a page or article at a new address.

To add your own, for example for an old shop's addresses:

1. Open **Website** in the menu and choose [Redirects](/admin/{store}/redirects).
2. Under **Add a redirect**, type **Redirect from** and **Redirect to**: paths in your store without the country, such as
   `/collections/shoes` and `/category/shoes`.
3. Press **Add the redirect**.

A redirect works only from an address that does not exist in your store, and only to your own store. Redirects are permanent: browsers
and search engines remember them, so change or remove one with care. The list shows how often each was used, and you can search,
**Edit** and **Delete** your own. One Kaizena Flow made cannot be edited: make your own from the same address to replace it.

### Find the links that lead nowhere

**Pages not found**, beside Redirects, lists the addresses shoppers and search engines asked for that your store did not have, most
asked first, over the last 7, 30 or 90 days. Where it finds a likely target among your products, categories, tags, pages and articles,
press **Redirect to …** to add the redirect in one press. Otherwise type a target of your own with **Redirect …** (or
**Another target …**). **Ignore** hides an address. Suggestions come from comparing words, never from an AI, so look at the target before
you press.

Only the address and the day are kept, for 90 days: no IP address, browser, cookie or anything else about the visitor.

### Many at once

**Import** brings redirects in from a CSV file with the columns *Redirect from* and *Redirect to*; a Shopify redirect file reads as it is.
You see what it would do, line by line, before anything changes, and an import never deletes a redirect. **Export** downloads yours, or
all of them.

Moving from another shop? **Old shop** reads your old shop's list of pages and fixes, in one press, every old link whose product, page or
post is here under the same name.

## Use your own domain

Open **Settings** in the menu and choose [Domains](/admin/{store}/settings/domains), under Store. Your store already has an address on
Kaizena Flow. Only the store's owners can add or buy a domain, and your plan sets how many a store can have.

### Connect a domain you own

1. Under **Your own domains**, type the domain, such as `shop.example.com` or `example.com`, and press **Add domain**.
2. It shows *Waiting for DNS*, with the records to create. Create them at the company where you manage the domain's DNS, and remove other
   A, AAAA or CNAME records on the same name. If the page offers **Connect automatically**, that company can add them for you: sign in
   there and approve.
3. Press **Check now**. The page also checks each time you open it; DNS changes can take a few hours to show.

When the records are in place, the domain becomes your store's address, with a certificate for https, and your other addresses lead
there. With more than one domain, **Make this the address** chooses which one.

### Buy a domain here

Under **Get a domain**, search for a name and buy it: your store moves to it by itself, with no DNS to set up. The domain is registered to
you or your company, never to Kaizena Flow. Until buying opens for your store, the page says so.

### More options

- **Use for one language** or **Use for one country** makes a domain show your store in that language, or for that country, without it
  in the addresses. A store gives domains to its languages or to its countries, not both.
- **Bring a domain here** moves a domain's DNS or its registration to Kaizena Flow; **Move this domain** takes one away, step by step.

## Private mode

While your store is private, visitors see only its landing page; orders already placed keep their pages. A new store is private until you
open it. Open **Settings** and choose [Private mode](/admin/{store}/settings/private), under Site:

- **Make the store private** or **Open the store to everyone**.
- **Password**: visitors who have it can come in. Without one, only your team can. **Sign everyone out** makes them type it again.
- **Landing page**: what visitors see, built in the page builder and chosen under Special pages on the Pages list.
- **Preview the store** shows it as it is, without the password, for 12 hours.

A private store is kept out of search engines.

## Make several changes live together

[Staging](/admin/{store}/staging), under Website, gathers changes to pages, the look and menus, so they go live with one press:

1. Press **Start a staging set** and give it a name.
2. Tick **Include** on pages with changes. You edit a copy: the page's own draft and what visitors see stay as they are.
3. Choose a theme you have installed but not made live, and **Stage a change** to a menu.
4. Look at **What changed**, then press **Make it all live**. Visitors see everything at once.

**Discard the set** leaves everything as it was. One set is open at a time, and products, orders and customers are never part of it.
