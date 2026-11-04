---
title: Import and export products
summary: Download your products as a CSV file, bring products in from a file after a check that changes nothing, and move in from Shopify or WooCommerce.
track: owners
section: products
kind: how-to
areas: [products]
features: [shop]
plans: []
admin: /admin/{store}/products/import
order: 70
checked: 2026-11-04
sources: [D165, D327, D384, D445]
---

## Export your products

1. Open **Products** and press **Export**.
2. Under **Which products**, keep **All products, including drafts and archived**, or choose only those that are published, drafts or
   archived, or only those in one category or tag.
3. Choose the **File format**: *Excel (Nordic)* to open the file in Excel in Norwegian, Swedish or Danish, so æ, ø, å and the
   numbers come out right; *Standard* for other systems.
4. Keep **Include the pictures' addresses** ticked, or untick it for a smaller file.
5. Press **Export products**.

The file has one row for each variant, with its texts in every language, options, prices for each country, stock, cost, product
safety details, categories, tags and pictures. A store with up to 2,000 rows gets the file at once. A larger one gets it as a job on
the same page, with a **Download** button when it is ready; the file is kept for 7 days.

The file does not carry purchase options (subscriptions), download files, booking settings, or custom fields that are not plain
values (pictures, files, links and the like). An import leaves those as they are.

## Import products

1. Open **Products** and press **Import**.
2. Choose your file under **A CSV file of products** and press **Upload and read the file**. A file can be up to 15 MB, with at most
   5,000 products and 60,000 rows.
3. Under **What should the import do**, choose:
   - **What to do**: create new products and update existing ones, only create, or only update. A product is found by its handle
     (the end of its web address) and a variant by its SKU.
   - **A product that cannot be published**: save it as a draft and list why, or skip it.
   - **Manufacturer for new physical products with none in the file**.
   - **Variants of an existing product that are not in the file**: keep them as they are, or switch them off. They are never
     deleted.
4. Press **Check the file**. The check reads every row against your store as it is now and lists what the import would do: how many
   products to create, to update and unchanged, and each row's problems. **It changes nothing.** Press **Download the problems as
   CSV** to fix them in your spreadsheet.
5. Press **Import …**, read what it will do, and press **Yes, import**.

Products are saved one at a time. A product with an error is skipped and left as it was, and the others go on. The result says what
was created, updated, saved as drafts or skipped, how many prices changed and how many pictures were fetched.

> [!TIP]
> Start from an export. It shows the columns, and the file reads back into Kaizena Flow as it is.

If you change an option after the check, press **Check the file again** before you import: the import uses the options it was last
checked with. Only one product import is open at a time, and importing takes the right to change products.

### What a file changes

- **An empty cell clears that value**, and a column that is not in the file is left alone. A blank stock cell keeps the stock.
- **Prices** are read in each country's own currency and never converted. A price that is the same as today's is not written; a
  changed one is in the product's price history.
- **Pictures** at other websites are fetched and kept in your media library.
- **Stock** is set from the file when the store has one stock location. With several, the file's stock is not imported, since it
  cannot say which location it is for: use the stock file on Inventory (see [Stock and locations](/docs/owners/stock/stock-and-locations)).

### What an import never does

- delete a product, or change a product's handle;
- move a SKU from one product to another: a SKU that belongs to another product is an error;
- import a compare-at price: a reduction is shown to shoppers only against the lowest price of the last 30 days, which Kaizena Flow
  takes from its own price history;
- take a Shopify *Vendor* as the manufacturer, which is a choice you make on purpose under product safety, or make *Charge tax* the
  VAT category *Exempt from VAT*.

You cannot undo an import as a whole. **Cancel the import** on its page stops it: what was written before it stopped is kept. Your
file is kept privately for 30 days after the import ends, then deleted.

## Move in from another shop

A product export from **Shopify** or **WooCommerce** reads as it is: upload it under **Import** and Kaizena Flow recognises it.
It then asks a few more things before the check:

- **Do the prices in the file include VAT?** There is no default: a wrong answer would change every price.
- **The market of the Price column**, when you sell in more than one country. Prices are read in that country's currency.
- **Leave a redirect from each product's old address (…) to its page here**, ticked to begin with, so links to the old shop's
  product pages keep working. A redirect already there is kept, and an address in use here is never taken.

From Shopify, the *Product Category* column sets the product's standard category (see
[Categories and tags](/docs/owners/products/categories-and-tags)).

From WooCommerce, a variable product becomes one product with its variations as variants and its attributes as options. The price is
the sale price while its dates hold, else the regular price. Categories keep their levels. A product published there is published
here; anything else comes in as a draft. Grouped and external products are skipped, and the check lists every column it did not read,
with why.

Moving a whole shop from Shopify? [Moving in](/admin/{store}/settings/moving), under Settings, connects your Shopify shop (it only
reads it), shows what it holds, checks its old links and leads you to the imports. Only the store's owner can use it.

Customers and past orders have files of their own: [Import customers](/admin/{store}/customers/import) and
[Import order history](/admin/{store}/orders/history-import), both for the store's owner.

## More options

- **Change many products without a file.** Tick products under [Products](/admin/{store}/products) and press a bulk action: set the
  status, archive, add to or remove from a category or tag, change the price, or set the stock (with one stock location). **Edit in a
  grid** edits prices, SKUs, stock and cost in a table. You review every change before it is written, and a bulk change can be undone for 7 days.
- **Products are part of the online shop**, which every new store starts with. It is switched on and off under Settings, Features.
