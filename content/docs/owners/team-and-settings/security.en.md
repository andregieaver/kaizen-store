---
title: Sign in safely
summary: Turn on two-step sign-in, require it of everyone in your store, keep your recovery codes, and know what to do when a password leaks.
track: owners
section: team-and-settings
kind: how-to
areas: [team, settings]
features: []
plans: []
admin: /admin/account
order: 20
checked: 2026-11-04
sources: [D158, D171, D377, D439]
---

## Turn on two-step sign-in

With two-step sign-in, Kaizena Flow asks for a six-digit code from an app on your phone as well as your password or sign-in link.
Someone who learns your password still cannot get in.

1. Open the account menu at the top of the admin and choose [Your account](/admin/account).
2. Under **Two-step sign-in**, press **Set up two-step sign-in**, then **Set up an authenticator app**.
3. Open an authenticator app, such as 1Password, Google Authenticator or Authy, and scan the code on the screen. You can also type the
   key shown under it by hand.
4. Type the six digits the app shows now and press **Turn on two-step sign-in**.
5. Save your ten recovery codes: **Copy codes**, **Download as a file** or **Print**. This is the only time they are shown. Keep them
   apart from your phone, tick **I have saved these codes somewhere safe.** and press **Continue**.

From now on, after your password or link, open the app and type the code it shows for Kaizena Flow.

## Require it of your team

1. Open **Settings** and choose [Team](/admin/{store}/staff), under Account. The list says who has *Two-step on*.
2. Under **Two-step sign-in**, tick **Require two-step sign-in of everyone who works in this store.** You need it on yourself first.
3. Press **Save**.

Anyone without it is taken to set it up before they reach the store. Your other stores are not affected: each store chooses for
itself.

## Signing in and out

- **Sign in** with your email and password, or press **Email me a sign-in link instead**. A link works once and expires within the
  hour: open it in the same browser.
- **Forgot your password?** Press **Forgot password?** on the sign-in page. The email's link signs you in and opens your account, where
  you choose a new one. This also works if you have never had a password.
- **Too many wrong passwords** pause password sign-in for that address for a few minutes. A sign-in link still works.
- **Sign out** from the account menu, **Sign out**.
- **Some actions ask you to sign in again**: closing a store and deleting your account need a sign-in from the last ten minutes.

AI assistants and apps you let work with your stores keep their access until you end it: open
[Connected apps and assistants](/admin/account/connected) and press **Disconnect**.

## If your password leaks

1. **Set a new password.** On [Your account](/admin/account), under **Password**, type a **New password** of at least 12 characters
   and press **Save password**. A password that is too easy to guess, or that has appeared in a data breach, may be refused. If you are
   asked to, sign in again with an email link first.
2. **Connect your apps again.** A new password disconnects every AI assistant and app you connected, so they ask again.
3. **Turn on two-step sign-in**, if it is not on yet.
4. **Look at the [Activity log](/admin/{store}/activity)** for changes you did not make.
5. **Was it a team member's password?** On **Team**, press **Remove access** for them until it is changed, or require two-step sign-in
   of everyone.

> [!WARNING]
> Kaizena Flow emails you when a recovery code is used on your account, and when your two-step sign-in is switched off or reset. If it
> was not you, sign in, change your password at once, set up two-step sign-in again and tell your store's owner.

## More options

### Lost your phone

On the sign-in's second step, press **Use a recovery code**, type one of your codes and press **Use this code**. Each code works once.
Using one takes your two-step sign-in away and signs you out everywhere, and Kaizena Flow emails you to say so. Then sign in again and
set it up anew. Without your phone and without a code, only a platform admin at Kaizena Flow can reset your two-step sign-in.

On **Your account** you see how many recovery codes are left. **Make new recovery codes** gives a new set and ends the old ones.
**Switch off two-step sign-in** turns it off; a store that requires it asks you to set it up again.

### Closing a store

An owner can close a store under **Settings**, [Close store](/admin/{store}/settings/close). Sales stop and the shop goes off the web;
the plan ends with its period, the store's own domains are released and orders waiting for payment are cancelled. Nothing is deleted,
and you can reopen the store yourself for 30 days. Closing is not possible while paid orders wait to be sent, or while subscriptions or subscription boxes run. Under
**Take your store with you** on the same page you can download the store as a file, with its products, stock, orders and customers.

### Deleting your own account

On [Delete your account](/admin/account/delete), from **Your account**, you erase your sign-in, name, email and picture, your access to
every store, and the AI manager's conversations and memories. What you did in a store stays there without your name. It is refused,
with the reason, while for example you are the only owner of a store that is not closed, or you hold a domain. It needs a sign-in from
the last ten minutes and your email typed again.
