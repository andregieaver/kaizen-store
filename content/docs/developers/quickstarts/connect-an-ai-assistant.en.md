---
title: Connect an AI assistant to a store
summary: Add Kaizena Flow's MCP server to an AI assistant, sign in and choose what it may do, ask it a first question, approve a change it proposes, and disconnect it.
track: developers
section: quickstarts
kind: tutorial
areas: [mcp, ai, authentication]
features: []
plans: []
admin: /admin/account/connected
order: 40
checked: 2026-11-04
sources: [D439]
tools: [list_stores, sales_summary, add_order_note]
---

## What you will do

You connect an AI assistant to your store through Kaizena Flow's owner MCP server. You sign in on Kaizena Flow's own page and choose the
stores and what the assistant may do. Then you ask it something, let it propose a change, approve that change in the admin, and end the
connection.

You need:

- a Kaizena Flow account that owns a store. Someone on a store's team can connect too, but only an owner can approve changes;
- an AI assistant or MCP client that can add a remote MCP server and sign in to it with OAuth. Where that is in its settings depends on
  the client: look in its own help for adding a remote or custom MCP server;
- for the examples below, a store with its online shop on and an order in it.

## 1. Add the server

In your assistant, add a remote MCP server with this address:

```text
https://kaizenaflow.com/api/mcp
```

There is no key or token to paste. When the assistant first calls the server, the server answers that it needs a token and says where to
get one. The assistant then finds Kaizena Flow's sign-in by itself and opens it in your browser.

If your client asks how it signs in, choose OAuth. You do not need a client id or secret from Kaizena Flow: it takes clients that
register themselves, with no secret, and clients that publish their own description at an address. How a client does this is on
[The owner MCP server](/docs/developers/mcp/owner-mcp#clients).

## 2. Sign in and choose what it may do

Your browser opens Kaizena Flow's page *Connect an app*. If you are not signed in, sign in first; you come back to the page after.

At the top, check who is asking:

- the heading names the assistant: *{name} wants to work with your stores*;
- *From* shows the host it comes from, and *It sends you back to* shows another host when the answer goes elsewhere;
- *Verified by Kaizena Flow* means Kaizena Flow has checked this client. *Not verified by Kaizena Flow* means it has not: connect it only
  if you know where it comes from.

Then choose:

1. **Stores to connect.** Your stores are ticked. Untick the ones the assistant should not reach. A store that asks for two-step sign-in
   can be ticked only once you signed in with your second step.
2. **What it may do.** Leave it at *Read and propose changes* for this tutorial. The assistant can read your stores and propose changes,
   and nothing changes until you say yes in Kaizena Flow. *Read only* lets it change nothing. *Read and change* lets it make the changes
   you could make yourself; anything that sends, publishes or costs money still waits for your yes.
3. **Choose permissions** is folded away. Open it to untick single permissions, such as *Change customers*. Leave it as it is for now.

Press **Allow**. Your browser goes back to the assistant, and the assistant is connected. It never reaches more than your role allows in
each store, and it loses what your role loses.

> [!NOTE]
> Pressing *Cancel* sends the assistant a refusal and connects nothing. You can connect it again later.

## 3. Ask a first question

Ask your assistant something that only reads, for example:

```text
Which of my Kaizena Flow stores can you reach? How much did the first one sell in the last 7 days?
```

The assistant calls `list_stores`, which answers each store's slug and name, and then a reading tool with that slug, here most likely
`sales_summary`. It answers from the store's own figures: orders, the total taken, refunds, the average order and the best sellers.
Nothing in the store changes.

The tools your assistant sees are only those your connection can use. [The MCP reference](/docs/reference/mcp) lists them all.

## 4. Let it propose a change

Ask for a small change, with a real order number of yours:

```text
Add a note to order 1042 in that store: "Customer asked for gift wrap."
```

The assistant calls `add_order_note`. At *Read and propose changes*, the note is not added yet. The assistant is told the change is kept
for your approval, with a link to where it waits. A good assistant says so and gives you the link.

Now approve it in Kaizena Flow:

1. Open the link, or open [AI manager notices](/admin/account/notices) and the notice *Waiting for your yes*. You can also open the
   store's [AI manager](/admin/{store}/assistant) and the conversation called *From* and the assistant's name.
2. The change is there, named after the assistant: *{name} asks: …*.
3. Press **Approve**. The note is added to the order now. *Decline* would drop it.

Only you can give the yes, in the admin. Nothing the assistant writes counts as one. A change with no answer in seven days is not done.

## 5. See and end the connection

Open [Connected apps and assistants](/admin/account/connected) in your account. The assistant is listed with its stores, its access and
when it was last used.

Press **Disconnect**. The connection ends at once: its tokens stop working, and a change of it still waiting for your yes can no longer
be approved. The next time the assistant calls the server, it is told it needs a token again, and connecting means asking you again.

A store's owner can also end any connection that reaches their store, whoever made it, under
[Settings, Apps and API](/admin/{store}/settings/api): *Cut off* takes the store out of that connection. The store then stays out, even
if that person connects the assistant again, until an owner lets it in again on the same page.

## Next

- [The owner MCP server](/docs/developers/mcp/owner-mcp): discovery, scopes, tokens and limits, for building a client.
- [Give the AI manager your own tools](/docs/developers/mcp/your-own-tools): the other way round, your MCP server called by the AI manager.
