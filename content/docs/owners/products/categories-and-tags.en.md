---
title: Categories and tags
summary: Sort products into categories, label them with tags, give a category its own page, and choose the standard category that shoppers' filters and Google read.
track: owners
section: products
kind: how-to
areas: [products]
features: [shop]
plans: []
admin: /admin/{store}/products/categories
order: 60
checked: 2026-11-04
sources: [D50, D79, D160, D168, D319, D327]
---

## Categories and tags in short

- **Categories** group your products, such as *Coffee* and *Tea*. A category can hold subcategories, such as *Green tea* inside
  *Tea*. A grid that shows a category shows its subcategories' products too.
- **Tags** label products across categories, such as *Organic*. Tags are one flat list.

A product can be in several categories and have several tags. Shoppers find products through them in your menus, content grids and
filters, and each category and tag has its own page in your shop.

## Choose a product's categories and tags

Open the product. Under **Categories and tags**, tick the ones it belongs to, then press **Save**.

To make a new one on the way, type its name in the box under the list (**New category** or **New tag**) and press **Add**. It is made
and ticked at once. A category made here goes at the top level; move it inside another one on the categories page.

## Manage them

Open **Products** and press **Categories and tags**, or open [Categories and tags](/admin/{store}/products/categories) here. The page
has a card for categories and one for tags.

1. **Add one.** Type a name under **New category** or **New tag**. For a subcategory, choose its parent under **Inside**. Press **Add
   category** or **Add tag**.
2. **Change one.** Press **Change** to rename it, move it under **Inside**, or change its **Address**. If you change the address, the
   old address redirects to the new one. Press **Save**.
3. **Delete one.** Press **Delete**, then **Delete** again to confirm, or **Keep**. A deleted category's subcategories move up.

### A category's own page

Each category and tag has a page in your shop that lists its products. Press **Change** and fill in **Its own page**:

- a picture (**Add a picture**) and a **Description**, shown above its products and, without a search text of its own, in search
  results;
- its name and description in your other languages. Empty uses the main language's.

Press **Order products** to put its products in the order you want: drag them, or use the arrows, and press **Save the order**. The
page's first sort, *Featured*, follows this order. Products added later come last until you place them.

### Filled by rules

A category or tag can fill itself instead of being ticked on each product. Press **Change** and tick **Fill this automatically**.
Then choose whether **Products match** all of the conditions or any of them, and press **Add a condition**: in a category or tag,
price, in stock, manufacturer, variant option, custom field, kind of product, or new arrivals. The page counts the products that match
as you go.

Products that meet the rules join by themselves and leave when they no longer do. When you switch rules on, the products placed in it
by hand are taken out when you save. When you switch them off, you can tick **Keep the products that match now, placed in it by
hand**. A category filled by rules cannot be ticked on a product, and its page lists the newest products first.

## The standard product category

Apart from your own categories, a product can have a category from a shared list that marketplaces and Google read: Shopify's open
Standard Product Taxonomy. Shoppers do not see it as pages of your shop.

1. Open the product, then **Advanced**, and find **Product category**.
2. Under **What is it?**, type a word or two, such as *t-shirt* or *coffee grinder*, and choose from the list. Or press **Suggest with
   AI**: it proposes a category from the product's title and description, and you press **Use it** to take it. Nothing is chosen by
   itself.
3. Under **Attributes**, tick what fits, such as colour or material. The category decides which attributes it has.
4. Press **Save**.

What it does:

- **Filters.** Lists of products in your shop can be filtered by these attributes. A list offers up to eight of them, those most of
  its products carry, named in the shopper's language.
- **Feeds.** Your product feeds send Google's product category, and colour, material and pattern from the attributes.
- **Search engines** read the category on the product page.
- **Product files.** Shopify's *Product Category* column sets it on import. See
  [Import and export](/docs/owners/products/import-and-export).

The list's names are in English, Norwegian, Swedish and Danish; a page in another language shows the English names.

## A layout for a category

A product page's layout can follow its category or tag. On [Product layouts](/admin/{store}/product-layouts), press **Where it's
used** beside a layout and tick the categories and tags it is for, then **Save**. A product uses its own layout first (**Page layout**
under **Categories and tags** in the product editor), else its nearest category's, else one of its tags', else the store's standard
layout. A category's layout also applies to the categories below it that have none of their own. To build a layout, see
[The page builder](/docs/owners/website/the-page-builder).

## More options

- **Many products at once.** Tick products under [Products](/admin/{store}/products) and press **Add to a category or tag** or
  **Remove from a category or tag**.
- **Search results.** Under **Change**, **Search results** gives a category or tag its own title and description for search engines,
  in each language.
- **Price per kg or litre.** Tick **Products in this category need a price per kg or litre** when you add or change a category. Its
  products, and its subcategories', then need their content for each variant that is shipped and for sale. Nothing changes in the
  shop at once: the page counts the active products still without it (**Show them**), and one is refused the next time it is saved.
  The content is set per variant: see [Variants and options](/docs/owners/products/variants-and-options).
- **Categories and tags are part of the online shop**, which every new store starts with. It is switched on and off under Settings,
  Features.
