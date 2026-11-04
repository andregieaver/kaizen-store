---
title: Give the AI manager your own tools
summary: Connect your own MCP server to a store so its AI manager can call your tools for the owner: what the server must answer, what Kaizena Flow sends it, how each tool runs or waits for a yes, and the limits.
track: developers
section: mcp
kind: how-to
areas: [mcp, ai, integrations]
features: []
plans: []
admin: /admin/{store}/settings/api
order: 30
checked: 2026-11-04
sources: [D363]
tools: []
---

## What you get

A store's owner can connect an MCP server of their own, such as a warehouse system's or an internal tool's, to the store's AI manager.
The owner chooses which of its tools the AI manager may use, and how each one runs: at once, or only after the owner's yes. The AI manager
then calls them when the owner asks it for something they help with.

Here Kaizena Flow is the MCP client and your server answers it. This is the other way round from the
[owner MCP server](/docs/developers/mcp/owner-mcp), where an outside assistant calls Kaizena Flow.

## Before you start

- You are the store's owner. Only an owner connects apps, and only owners' conversations with the AI manager offer their tools.
- Your server has an address that Kaizena Flow can reach: `https://`, a host name (not an IP address), the standard port 443, no user
  name or password in it, at most 500 characters, and a public network address.
- A store can connect up to 5 apps.

## Make your server answer

Kaizena Flow speaks JSON-RPC 2.0 over HTTP `POST` to the address, as MCP's Streamable HTTP transport does. Each exchange starts afresh:

1. `initialize`. Any answer with a `2xx` status will do. If it carries an `Mcp-Session-Id` header (1 to 200 visible ASCII characters),
   that session is sent with the rest of this exchange.
2. `notifications/initialized`, only when your server gave a session.
3. The method itself: `tools/list` or `tools/call`.

Kaizena Flow keeps no session from one exchange to the next. The first request of an exchange looks like this:

```http
POST /mcp HTTP/1.1
Host: tools.example.com
Content-Type: application/json
Accept: application/json, text/event-stream
Authorization: Bearer <the token the owner gave>

{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"Kaizena Flow","version":"1"}}}
```

The `Authorization` header is sent only when the owner gave a token. It is the only credential Kaizena Flow sends: there is no signature
and no OAuth. Check the token on every request.

Then come the method's requests:

```json
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
```

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"stock_at_warehouse","arguments":{"sku":"SOCK-42"}}}
```

How your answers are read:

- Answer with a `2xx` status, within ten seconds, in at most 1 MB. A redirect is not followed: it fails the call.
- Answer either `application/json` with the JSON-RPC response, or `text/event-stream`. From an event stream, the last `data:` line that
  holds a message with an `id` is read.
- A JSON-RPC `error` is shown with its `message`, cut to 300 characters: *The app said: …*.

## Describe your tools

Your `tools/list` result is read as MCP's `{ "tools": [ … ] }`, each with a `name`, a `description` and an `inputSchema`:

```json
{
  "tools": [
    {
      "name": "stock_at_warehouse",
      "description": "How many of a SKU are on the shelf at our warehouse now.",
      "inputSchema": { "type": "object", "properties": { "sku": { "type": "string" } }, "required": ["sku"] }
    }
  ]
}
```

- A name is 1 to 40 letters, digits, `_` or `-`. A tool with any other name, or a name already listed, is left out.
- A description is cut to 1,000 characters.
- An `inputSchema` must be an object schema (`"type": "object"`). Any other schema is replaced by an empty one. A tool whose schema is
  over 20,000 characters is left out.
- At most 50 tools are kept.

The AI manager knows a tool as `app__{app}__{tool}`, at most 64 characters, where `{app}` comes from the name the owner gave the app (lower
case letters, digits and hyphens, at most 16). Its description reaches the model marked as the owner's own app's words, not Kaizena Flow's.

## Answer a call

A `tools/call` gets your tool's `name` and the model's `arguments`, as an object. Answer MCP's tool result:

```json
{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"SOCK-42: 118 on the shelf."}]}}
```

- Only `text` items of `content` are read, joined by new lines. Any other kind, such as a picture, is passed on as its type in brackets,
  `[image]`. `structuredContent` is not read.
- The text is cut to 8,000 characters.
- `"isError": true` marks the call as failed.

Your answer reaches the model as data from outside Kaizena Flow, never as instructions. Do not rely on it to make the AI manager do
something.

## Connect it in the admin

1. Open [Settings, Apps and API](/admin/{store}/settings/api) and go to *Your apps for the AI manager*.
2. Fill in *Name*, *MCP address (https)* and, if your server checks one, *Bearer token (optional)*. Press *Connect app*.
3. Kaizena Flow reads the tools at once. If it cannot, it says why: *The app's tools could not be read: …*.
4. Every tool starts *Off*. For each one you want, choose how it runs.

| Choice | What the AI manager does |
|---|---|
| *Off* | Never offers it |
| *On: reads only, runs at once* | Calls it when it needs to |
| *On: changes the site, asks first* | Keeps the call for the owner's yes |
| *On: sends something, asks first* | Keeps the call for the owner's yes |
| *On: costs money, asks first* | Keeps the call for the owner's yes |

The address and the token are kept encrypted. The page shows them back only as the host and the token's last characters.

## How calls are approved

A tool that asks first is never called when the AI manager decides to use it. The call is kept, and the owner sees it under the AI
manager's answer as *Ask {app} to run {tool} with …*, followed by the arguments. Your server is called only when the owner presses
*Approve*, and only if they are still an owner and the tool is still switched on with one of the asking choices. A kept call with no
answer in seven days is not done.

The AI manager never offers your tools in the autopilot's own work, nor in a conversation an outside assistant asks it through the owner
MCP server. Every call, run at once or approved, goes to your server as it was made: check what your tool is given, as you would for any
caller.

## Keep it working

- *Read tools again* reads your `tools/list` once more. A tool that is no longer listed is switched off.
- The app's card counts its calls and how many failed. A call fails when your server cannot be reached, answers an error or marks its
  result `isError`.
- *Remove* takes the app and its tools out of the AI manager at once.

## Limits

| What | Limit |
|---|---|
| Apps per store | 5 |
| Tools kept per app | 50 |
| Your tools offered to the AI manager at once, from every app together | 20: the first ones switched on, oldest app first |
| The bearer token | 2,000 characters |
| Time for each request | 10 seconds |
| An answer's size | 1 MB |
| An answer's text the model reads | 8,000 characters |
| A tool's description | 1,000 characters |
| A tool's input schema | 20,000 characters |
