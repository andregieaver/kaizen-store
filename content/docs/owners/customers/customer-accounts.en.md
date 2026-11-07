---
title: Customer accounts and your customers
summary: Choose whether shoppers can, must or cannot have an account, then find, add, tag, merge and import your customers.
track: owners
section: customers
kind: how-to
areas: [customers, settings]
features: []
plans: []
admin: /admin/{store}/customers
order: 10
checked: 2026-11-05
sources: [D32, D296, D304, D364, D365, D366, D375, D480]
---

## Choose how accounts work

Shoppers can open an account in your store, or tick to make one when they check out. **My account** opens on an overview of their
latest orders and what runs now, with tabs for **Orders**, **Profile** (their details and saved addresses) and **Settings** (password,
your emails and their data). You choose whether an account is optional, required or not offered at all.

1. Open **Settings** and choose [Checkout rules](/admin/{store}/settings/checkout), under Selling.
2. Under **Customer accounts**, choose one:
   - **Optional**, the default: shoppers check out as guests or with an account, and can open one with their order.
   - **Required**: shoppers sign in before they check out. The cart shows *Sign in to check out* in place of its checkout button, and
     every order joins the shopper's account.
   - **Off**: the store shows no sign-in and no account. The links you send after a sale, to pay, see an invoice or write a review,
     still work.
3. Press **Save**.

> [!NOTE]
> Subscriptions, the bonus program and the referral program need customer accounts, and so do company accounts. While one of them is
> on, or a company account buys in your store, you cannot choose **Off**: the message says what to switch off first.

## Find a customer

Open **Customers** in the menu. The list holds everyone with an account or a paid order, one per email address. Guests who bought
without an account are there too.

- **Search by name or email**, then press **Search**.
- **Filter by a tag**: choose it in the list beside the search. **Show everyone** clears both.

Open a customer to see their orders, subscriptions, the emails the store sent them, their contact details and address, their tags,
their customer group and their wishlist. When the bonus program is on, their bonus credits are there too.

## Add or change a customer

Press **Add customer**, fill in the email and whatever else you know (name, phone, address, company), and press **Add customer**.

- The customer gets an account without a password. They sign in with a code sent to their email.
- Nothing is emailed when you add them, and nobody is put on your marketing list.

To change someone, open them and use **Edit details**, then **Save details**. A changed email must be confirmed again by the customer;
their tags and notes move with it. For a person who bought as a guest, **Give them an account** keeps their details, tags and orders
together.

### Notes for the team

Under **Notes**, write something the team should know and press **Add note**. Only staff see notes. They are included when the customer
asks for a copy of their data, so write nothing you would not show them.

## Tag customers

On a customer's page, type a tag under **Tags** and press **Add**. Tags help you find people and build
[segments for your emails](/docs/owners/marketing/email-marketing).

To tag many at once, search or filter the list first, then use **Tag everyone in this list**: write the tag and press **Add the tag**
or **Take the tag off**. It works on up to 1,000 people at a time.

## More options

### Merge two customers

When one person has two accounts, open the one you want to keep and press **Merge with another customer**. Type the email of the other
account and press **Show what moves**: you see its orders, subscriptions, wishlists, saved addresses, tags, notes and bonus credits.
Press **Merge into this customer** to move them. The other account is deleted and signed out. This cannot be undone.

A merge is refused before anything changes when it would lose something, for example when the other account holds gift cards, has
written reviews or belongs to a company this one is not in. The message says why.

### Import and export customers

Only owners see these buttons on the customer list.

- **Import** brings customers in from a CSV file, such as Shopify's customer export. Check the file first, then import it. A row finds
  its customer by email; an empty cell keeps what the store has; tags are added, never removed. An import never sets a password and
  never subscribes anyone to marketing.
- **Export** downloads your customers as a spreadsheet: name, email, phone, address, company, customer group, language, when they
  joined, how many paid orders they have and whether their address unsubscribed.

Moving from another shop? See [Import and export](/docs/owners/products/import-and-export).

### Store credit

When you refund an order, you can choose **Refund to** **Store credit** instead of the original payment. The amount becomes a gift
card of your store, emailed to the order's address, and the code is shown to you once. See
[Refunds and exchanges](/docs/owners/orders/refunds-and-exchanges).

### Saved addresses

Signed-in shoppers keep up to 20 addresses under **My account**, **Profile**, **Saved addresses**, with one for delivery and one for billing that
checkout starts with. Checkout offers them when it asks for the address itself; Stripe's payment page asks for its own. The address you
type under **Edit details** is the customer's default.

### Sign in with Google

Where Kaizena Flow offers it, your store's sign-in form shows **Sign in with Google**. It signs in only a shopper who already has an
account in your store with the same email: it makes no new account and keeps nothing from Google. It is not shown while customer
accounts are **Off**.

### Wishlists

Shoppers save products with the heart, signed in or not. **Customers**, [Wishlists](/admin/{store}/wishlists) shows their lists, the
most wished-for products, and what went from a list to the cart and was bought.

> [!TIP]
> Who may see and change customers is set by their role: see [Staff and permissions](/docs/owners/team-and-settings/staff-and-permissions).
> A person asking for their data, or for it to be erased, is handled under [Personal data](/docs/owners/customers/personal-data).
