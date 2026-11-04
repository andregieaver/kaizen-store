---
title: Staff and permissions
summary: Invite people to work in your store, choose what each role can see and change, give an agency access for a while, and see who changed what.
track: owners
section: team-and-settings
kind: how-to
areas: [team, settings]
features: []
plans: []
admin: /admin/{store}/staff
order: 10
checked: 2026-11-04
sources: [D107, D158, D314]
---

## Invite someone

1. Open **Settings** and choose [Team](/admin/{store}/staff), under Account. Only owners can open it.
2. Under **Invite someone**, type their **Email** and choose a **Role**.
3. Press **Invite**.

Kaizena Flow does not send an invitation email: tell the person to sign in at the admin's sign-in page, `/admin/sign-in`, with that
email address. They can ask for a sign-in link by email, and set a password afterwards on **Your account**. Staff keep their access
until you remove it.

The roles you can give are:

- **Owner**: everything, including the team and the plan. A store can have several owners.
- **Admin (everything except the team and the plan)**.
- One of the store's roles, below.

> [!TIP]
> Your plan may limit how many people work in your store. See [Choose a plan](/docs/owners/getting-started/choose-a-plan).

## The roles to start from

Every store starts with these roles, which you can change or delete:

| Role | What it can do |
|---|---|
| Orders | Handles orders and returns, and can look up customers and products. |
| Products | Keeps the catalogue: products, prices, stock and layouts. |
| Marketing | Runs campaigns, coupons, tests and emails, and reads the figures. |
| Content | Writes and designs the site: pages, blog, menus, pictures and translations. |
| Analytics | Reads the figures and what lies behind them. |
| Support agent | Answers customers in the support inbox, and can look up their orders, accounts and products. |
| Read-only | Can look at everything except billing and the team, and change nothing. |

On the team list, choose a new role beside a person and press **Change role**, or press **Remove access** to take their access away.
You cannot remove your own access.

## Make your own role

1. On **Team**, press **Roles**.
2. Under **Make a role**, give it a **Name**.
3. For each part of the admin (Orders, Products, Customers, Marketing, Analytics, Website, Bookings, Support, Settings), choose **No
   access**, **Can view** or **Can change**. *Can change* includes *can view*. The team and the plan say *Owners only: a role cannot give
   this*.
4. Press **Make role**.

A page a role cannot open is hidden from that person's menu. Changing a role changes what everyone who holds it can do, at once. A role
can be deleted only when nobody holds it.

## Give an agency access for a while

A collaborator, such as an agency or a freelancer, gets a role and an end date. A collaborator is never an owner and never sees the
team or the plan.

1. On **Team**, under **Invite a collaborator**, type the **Email** and choose a **Role**.
2. Set **Access lasts (days)**: 1 to 365.
3. Press **Invite collaborator**.

The team list shows *Collaborator until* the end date. Type a number in **Days from today** and press **Extend** to give more time, or
remove access earlier. When the time is up, the access ends by itself.

## See who changed what

Open **Settings** and choose [Activity log](/admin/{store}/activity), under Account. It lists what people changed in the store, and
when: products, prices, pages, coupons, shipping, the team and the payment settings. Changes the AI manager made for someone say so.

- Filter by **Person**, **Area**, **Action** and the days **From** and **To**, then press **Filter**.
- Owners see every entry. Everyone else sees their own entries and those of the parts of the admin they can open.
- Entries are kept for 24 months and cannot be changed.
- Owners can download the log: choose the **First day** and **Last day** under **Download as a spreadsheet (CSV)** and press
  **Download CSV**. One file holds up to 50,000 entries.

## More options

### Working in several stores

Each store has its own team and roles, so someone can be an owner in one store and have a role in another. Your sign-in is the same
for all of them.

- **As an owner**, the admin opens on the [Control center](/admin): every store you work in at a glance, what needs you first, the
  week's sales and the latest orders. **Stores** lists your stores, where you can make or duplicate one.
- **As staff**, the admin opens on your store, or on the list of stores when you work in several.
- Move between stores with the switcher at the top of the admin.

Each store has its own plan and billing. **Billing** in your account shows the plan of every store you own, and
[Usage and limits](/admin/account/limits) what each has used. Requiring two-step sign-in is chosen store by store: see
[Security](/docs/owners/team-and-settings/security).
