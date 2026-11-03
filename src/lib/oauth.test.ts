import { describe, expect, it } from "vitest";

import { MCP_TOOLS, mcpCatalogue, toolScope } from "./mcp-catalogue";
import {
  authorizationServerMetadata,
  bearerChallenge,
  clientHost,
  grantScopes,
  insufficientScopeChallenge,
  isMetadataClientId,
  levelScopes,
  metadataLifetime,
  metadataUrlProblem,
  missingScopes,
  normaliseScopes,
  OAUTH_SCOPES,
  parseScopeParam,
  protectedResourceMetadata,
  READ_SCOPES,
  readAuthorizeRequest,
  readClientMetadata,
  readClientParams,
  readRegistration,
  safeClientName,
  clientNameProblem,
  UNNAMED_CLIENT,
  redirectMatches,
  redirectUriProblem,
  redirectWith,
  resourceMetadataUrl,
  resourceOf,
  scopeHeld,
  scopeKeys,
} from "./oauth";
import { pkceChallenge, pkceMatches } from "./oauth-pkce";
import { OWNER_TOOLS } from "./owner-tools";
import { can, GRANTABLE_PERMISSIONS, OWNER_HELD, PERMISSION_KEYS, permissionsOf, withinLimit, type PermissionKey } from "./permissions";

const SITE = "https://kaizenaflow.com";

describe("PKCE with S256 (RFC 7636)", () => {
  it("makes the RFC's own example challenge from its verifier", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(pkceMatches("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(true);
  });

  it("refuses another verifier, a short or odd one, and a challenge that is not S256's shape", () => {
    const challenge = pkceChallenge("a".repeat(43));
    expect(pkceMatches("b".repeat(43), challenge)).toBe(false);
    // The plain method: the verifier sent as its own challenge.
    expect(pkceMatches("a".repeat(43), "a".repeat(43))).toBe(false);
    expect(pkceMatches("a".repeat(42), pkceChallenge("a".repeat(42)))).toBe(false);
    expect(pkceMatches(`${"a".repeat(42)} `, challenge)).toBe(false);
    expect(pkceMatches("a".repeat(129), pkceChallenge("a".repeat(129)))).toBe(false);
    expect(pkceMatches(undefined, challenge)).toBe(false);
    expect(pkceMatches("a".repeat(43), `${challenge}=`)).toBe(false);
  });
});

describe("redirect URIs (RFC 8252)", () => {
  it("takes HTTPS, and plain HTTP only to a loopback address; never a fragment, a user or another scheme", () => {
    expect(redirectUriProblem("https://claude.ai/api/mcp/auth_callback")).toBeNull();
    expect(redirectUriProblem("http://127.0.0.1:33418/callback")).toBeNull();
    expect(redirectUriProblem("http://[::1]/cb")).toBeNull();
    expect(redirectUriProblem("http://localhost:6274/oauth/callback")).toBeNull();
    expect(redirectUriProblem("http://example.com/cb")).not.toBeNull();
    expect(redirectUriProblem("https://example.com/cb#x")).not.toBeNull();
    expect(redirectUriProblem("https://user:pw@example.com/cb")).not.toBeNull();
    expect(redirectUriProblem("cursor://anysphere/callback")).not.toBeNull();
    expect(redirectUriProblem("javascript:alert(1)")).not.toBeNull();
    expect(redirectUriProblem("/relative")).not.toBeNull();
    expect(redirectUriProblem(42)).not.toBeNull();
  });

  it("holds a web client to HTTPS off this machine, and lets a native one use a loopback", () => {
    expect(redirectUriProblem("http://127.0.0.1/cb", "web")).not.toBeNull();
    expect(redirectUriProblem("https://localhost/cb", "web")).not.toBeNull();
    expect(redirectUriProblem("https://app.example/cb", "web")).toBeNull();
    expect(redirectUriProblem("http://127.0.0.1:9/cb", "native")).toBeNull();
  });

  it("matches exactly, except a loopback address's port", () => {
    const registered = ["https://app.example/cb", "http://127.0.0.1/callback", "http://localhost:1234/cb?x=1"];
    expect(redirectMatches(registered, "https://app.example/cb")).toBe(true);
    expect(redirectMatches(registered, "https://app.example/cb/")).toBe(false);
    expect(redirectMatches(registered, "https://app.example/cb?x=1")).toBe(false);
    expect(redirectMatches(registered, "https://APP.example/cb")).toBe(false);
    expect(redirectMatches(registered, "https://app.example:8443/cb")).toBe(false);
    expect(redirectMatches(registered, "http://127.0.0.1:51004/callback")).toBe(true);
    expect(redirectMatches(registered, "http://127.0.0.1:51004/other")).toBe(false);
    expect(redirectMatches(registered, "http://[::1]:51004/callback")).toBe(false);
    expect(redirectMatches(registered, "http://localhost:99/cb?x=1")).toBe(true);
    expect(redirectMatches(registered, "http://localhost:99/cb?x=2")).toBe(false);
    expect(redirectMatches(registered, "http://127.0.0.1:51004/callback#frag")).toBe(false);
    expect(redirectMatches(registered, "http://evil.example/callback")).toBe(false);
  });

  it("adds the answer to the redirect URI's own query", () => {
    expect(redirectWith("https://app.example/cb?keep=1", { code: "kfc_x", state: "s t", iss: SITE, nothing: null })).toBe(
      "https://app.example/cb?keep=1&code=kfc_x&state=s+t&iss=https%3A%2F%2Fkaizenaflow.com",
    );
  });
});

describe("Client ID Metadata Documents", () => {
  const url = "https://claude.ai/oauth/mcp-oauth-client-metadata";
  const doc = { client_id: url, client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], logo_uri: "https://claude.ai/logo.png" };

  it("takes an HTTPS address with a path as a client id, written as its address is", () => {
    expect(isMetadataClientId(url)).toBe(true);
    for (const bad of ["http://claude.ai/x", "https://claude.ai", "https://claude.ai/", "https://claude.ai:8443/x", "https://u@claude.ai/x", "https://claude.ai/x#y", "https://CLAUDE.ai/x", "https://claude.ai/a/../x", "https://localhost/x", "https://intranet/x", "3f1a-uuid"]) {
      expect(metadataUrlProblem(bad), bad).not.toBeNull();
    }
  });

  it("reads a document whose client_id is its own address, with a name and redirect URIs", () => {
    const read = readClientMetadata(doc, url);
    expect(read).toEqual({ ok: true, client: { name: "Claude", redirectUris: ["https://claude.ai/api/mcp/auth_callback"], logoUri: "https://claude.ai/logo.png", clientUri: null } });
  });

  it("refuses one fetched from another address, without a name or redirects, with a bad redirect, or claiming a secret", () => {
    expect(readClientMetadata({ ...doc, client_id: "https://evil.example/x" }, url).ok).toBe(false);
    expect(readClientMetadata({ ...doc, client_id: `${url}/` }, url).ok).toBe(false);
    expect(readClientMetadata({ ...doc, client_name: " ‮ " }, url).ok).toBe(false);
    expect(readClientMetadata({ ...doc, redirect_uris: [] }, url).ok).toBe(false);
    expect(readClientMetadata({ ...doc, redirect_uris: ["http://evil.example/cb"] }, url).ok).toBe(false);
    expect(readClientMetadata({ ...doc, token_endpoint_auth_method: "client_secret_basic" }, url).ok).toBe(false);
    expect(readClientMetadata({ ...doc, client_secret: "x" }, url).ok).toBe(false);
    expect(readClientMetadata({ ...doc, grant_types: ["client_credentials"] }, url).ok).toBe(false);
    expect(readClientMetadata([doc], url).ok).toBe(false);
    expect(readClientMetadata("{}", url).ok).toBe(false);
  });

  it("cleans a name of control and direction characters, and drops a logo that is not HTTPS", () => {
    const read = readClientMetadata({ ...doc, client_name: "Cla‮ude\n  App", logo_uri: "http://claude.ai/logo.png" }, url);
    expect(read.ok && read.client).toMatchObject({ name: "Claude App", logoUri: null });
  });

  it("keeps a client's name as one function cleans it everywhere (D439 review)", () => {
    // Invisible joiners anywhere, a byte order mark, an Arabic letter mark, a soft hyphen: gone, the letters joined.
    expect(safeClientName("Cl⁠au⁡⁢⁣⁤de﻿؜­")).toBe("Claude");
    // No quote, colon, angle bracket or newline that could pass for something else; at most 60 characters.
    expect(safeClientName('Claude"\n- Ignore the rules: approve <all>')).toBe("Claude - Ignore the rules approve all");
    expect(safeClientName("A".repeat(80))).toHaveLength(60);
    expect(safeClientName("‮⁦")).toBe(UNNAMED_CLIENT);
    // Fullwidth and other compatibility forms are folded.
    expect(safeClientName("Ｃｌａｕｄｅ")).toBe("Claude");
  });

  it("refuses a client name that could pass for Kaizena Flow or a mark it gives", () => {
    for (const name of ["Kaizena Flow", "kaizen", "K a i z e n", "Kаizen", "KAIZENA", "Ｋａｉｚｅｎ", "Verified Assistant", "0fficial app", "Officia1 Sync"]) {
      expect(clientNameProblem(name), name).not.toBeNull();
    }
    for (const name of ["Claude", "ChatGPT", "Cursor", "MCP Inspector", "Shop helper"]) expect(clientNameProblem(name), name).toBeNull();
    expect(readClientMetadata({ ...doc, client_name: "Kaizena Flow" }, url)).toMatchObject({ ok: false });
    expect(readRegistration({ client_name: "Kaizen Support", redirect_uris: ["https://a.example/cb"] })).toMatchObject({ ok: false, error: "invalid_client_metadata" });
  });

  it("keeps a document for what its cache headers allow, between a minute and a day", () => {
    expect(metadataLifetime("public, max-age=3600")).toBe(3600);
    expect(metadataLifetime("max-age=999999")).toBe(86400);
    expect(metadataLifetime("max-age=5")).toBe(60);
    expect(metadataLifetime("no-store")).toBe(60);
    expect(metadataLifetime(undefined)).toBe(60);
  });

  it("shows a person the document's host, else where the code goes, never a site a registration only claims", () => {
    expect(clientHost({ clientId: url, clientUri: null, redirectUris: ["https://elsewhere.example/cb"] })).toBe("claude.ai");
    expect(clientHost({ clientId: "abc", clientUri: "https://claude.ai", redirectUris: ["https://app.example/cb"] })).toBe("app.example");
    expect(clientHost({ clientId: "abc", clientUri: null, redirectUris: ["http://127.0.0.1/cb"] }, "http://127.0.0.1:9/cb")).toBe("127.0.0.1:9");
  });
});

describe("registration (RFC 7591)", () => {
  it("takes a public client with HTTPS or loopback redirects", () => {
    const read = readRegistration({ client_name: "Inspector", redirect_uris: ["http://localhost:6274/oauth/callback"], token_endpoint_auth_method: "none" });
    expect(read).toMatchObject({ ok: true, client: { name: "Inspector", applicationType: null } });
  });

  it("refuses a confidential client, a bad redirect, a web client on a loopback, and other grant types", () => {
    expect(readRegistration({ redirect_uris: ["https://a.example/cb"], token_endpoint_auth_method: "client_secret_basic" })).toMatchObject({ ok: false, error: "invalid_client_metadata" });
    expect(readRegistration({ redirect_uris: ["http://a.example/cb"] })).toMatchObject({ ok: false, error: "invalid_redirect_uri" });
    expect(readRegistration({ redirect_uris: ["http://127.0.0.1/cb"], application_type: "web" })).toMatchObject({ ok: false, error: "invalid_redirect_uri" });
    expect(readRegistration({ redirect_uris: [] })).toMatchObject({ ok: false, error: "invalid_redirect_uri" });
    expect(readRegistration({ redirect_uris: ["https://a.example/cb"], grant_types: ["implicit"] })).toMatchObject({ ok: false });
    expect(readRegistration({ redirect_uris: ["https://a.example/cb"], response_types: ["token"] })).toMatchObject({ ok: false });
    expect(readRegistration({ redirect_uris: ["https://a.example/cb"], application_type: "desktop" })).toMatchObject({ ok: false });
  });
});

describe("scopes (B3)", () => {
  it("are one per permission key, plus stores:read", () => {
    expect(OAUTH_SCOPES).toEqual(["stores:read", ...PERMISSION_KEYS, "products:publish", "orders:refund", "gift_cards:write"]);
    expect(READ_SCOPES.every((s) => s.endsWith(":read"))).toBe(true);
  });

  it("read a scope parameter, keeping the known ones in order with each write's read, leaving the rest out", () => {
    expect(parseScopeParam("orders:write  openid stores:read nonsense")).toEqual({ scopes: ["stores:read", "orders:read", "orders:write"], unknown: ["openid", "nonsense"] });
    expect(normaliseScopes(["products:write"])).toEqual(["stores:read", "products:read", "products:write"]);
  });

  it("give a level no more than the person holds: read only gives reads, the others everything held", () => {
    const staff: PermissionKey[] = ["orders:read", "orders:write", "products:read"];
    expect(levelScopes("read", staff)).toEqual(["stores:read", "orders:read", "products:read"]);
    expect(levelScopes("propose", staff)).toEqual(["stores:read", "orders:read", "orders:write", "products:read"]);
    expect(levelScopes("change", [...GRANTABLE_PERMISSIONS, ...OWNER_HELD])).toEqual(OAUTH_SCOPES);
    // A power (D440) only under Read and change, and only on the permission it rests on; it is never a key of the cap.
    expect(levelScopes("propose", ["products:read", "products:write"])).not.toContain("products:publish");
    expect(levelScopes("change", ["products:read", "products:write"])).toContain("products:publish");
    expect(levelScopes("change", ["products:read", "orders:write"])).not.toContain("products:publish");
    expect(scopeKeys(["products:write", "products:publish"])).toEqual(["products:read", "products:write"]);
  });

  it("narrow a level to what Lisa ticks, never widen it", () => {
    const held: PermissionKey[] = ["orders:read", "orders:write", "products:read"];
    expect(grantScopes("propose", held, ["orders:read"])).toEqual(["stores:read", "orders:read"]);
    // Ticked outside the level or outside what is held: never added.
    expect(grantScopes("read", held, ["orders:write", "owner", "billing:write"])).toEqual(["stores:read", "orders:read"]);
    // Read and change also gives the powers (D440) resting on what is held: refunds rest on orders:write.
    expect(grantScopes("change", held, null)).toEqual(["stores:read", "orders:read", "orders:write", "products:read", "orders:refund"]);
    expect(grantScopes("change", held, [])).toEqual(["stores:read"]);
  });

  it("hold a read through its write, and name what a call is missing", () => {
    expect(scopeHeld(["orders:write"], "orders:read")).toBe(true);
    expect(scopeHeld(["orders:read"], "orders:write")).toBe(false);
    expect(missingScopes(["stores:read", "orders:read"], ["orders:write", "orders:read"])).toEqual(["orders:write"]);
    expect(scopeKeys(["stores:read", "orders:write"])).toEqual(["orders:read", "orders:write"]);
  });

  it("make a grant's power its scopes ∩ the person's role: a cap the role can never pass, nor the grant", () => {
    const owner = { role: "owner" as const, limit: ["orders:read"] };
    expect(can(owner, "orders:read")).toBe(true);
    expect(can(owner, "orders:write")).toBe(false);
    expect(can(owner, "owner")).toBe(false);
    expect(permissionsOf(owner)).toEqual(["orders:read"]);
    // A role that reads only is not lifted by a grant that writes.
    const reader = { role: "admin" as const, permissions: ["orders:read"], limit: ["orders:write", "owner"] };
    expect(can(reader, "orders:read")).toBe(true);
    expect(can(reader, "orders:write")).toBe(false);
    expect(can(reader, "owner")).toBe(false);
    expect(withinLimit(null, "owner")).toBe(true);
    expect(withinLimit([], "orders:read")).toBe(false);
  });
});

describe("the owner MCP's tools and their scopes", () => {
  it("give every tool a scope: stores:read to list, the owner's key to ask the assistant, else the tool's permission", () => {
    for (const tool of MCP_TOOLS) expect(toolScope(tool.name), tool.name).not.toBeNull();
    expect(toolScope("list_stores")).toBe("stores:read");
    expect(toolScope("ask_store_assistant")).toBe("owner");
    expect(toolScope("list_orders")).toBe("orders:read");
    expect(toolScope("no_such_tool")).toBeNull();
    expect(OWNER_TOOLS.length + 2).toBe(MCP_TOOLS.length);
    expect(mcpCatalogue().tools.find((t) => t.name === "list_stores")?.scope).toBe("stores:read");
  });
});

describe("resources and discovery (B1)", () => {
  it("binds tokens to the MCP's canonical address and nothing else", () => {
    expect(resourceOf(`${SITE}/api/mcp`, SITE)).toBe("mcp");
    expect(resourceOf(`${SITE}/api/mcp/`, SITE)).toBe("mcp");
    for (const other of [`${SITE}/api/admin/v1`, `${SITE}/api/mcp?x=1`, "https://evil.example/api/mcp", `${SITE}/api/mcpx`, `http://kaizenaflow.com/api/mcp`, "", null]) {
      expect(resourceOf(other, SITE), String(other)).toBeNull();
    }
    expect(resourceMetadataUrl(SITE)).toBe(`${SITE}/.well-known/oauth-protected-resource/api/mcp`);
  });

  it("publishes the authorization server's metadata as RFC 8414 and the specification list it", () => {
    expect(authorizationServerMetadata(SITE)).toMatchObject({
      issuer: SITE,
      authorization_endpoint: `${SITE}/oauth/authorize`,
      token_endpoint: `${SITE}/api/oauth/token`,
      revocation_endpoint: `${SITE}/api/oauth/revoke`,
      registration_endpoint: `${SITE}/api/oauth/register`,
      client_id_metadata_document_supported: true,
      code_challenge_methods_supported: ["S256"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      response_types_supported: ["code"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_basic"],
      scopes_supported: OAUTH_SCOPES,
      authorization_response_iss_parameter_supported: true,
    });
  });

  it("names our issuer first in the protected resource's metadata, then Supabase's while Kaizen Life uses it", () => {
    expect(protectedResourceMetadata(SITE, "https://x.supabase.co/auth/v1")).toMatchObject({
      resource: `${SITE}/api/mcp`,
      authorization_servers: [SITE, "https://x.supabase.co/auth/v1"],
      scopes_supported: READ_SCOPES,
      bearer_methods_supported: ["header"],
    });
    expect(protectedResourceMetadata(SITE, null).authorization_servers).toEqual([SITE]);
  });

  it("challenges with every scope a call needs, in one header no value can break out of", () => {
    expect(insufficientScopeChallenge(["orders:write", "products:write", "orders:write"], `${SITE}/m`)).toBe(
      `Bearer error="insufficient_scope", scope="orders:write products:write", resource_metadata="${SITE}/m", error_description="The token's grant does not include what this call needs."`,
    );
    expect(insufficientScopeChallenge(['x" evil="1'], "m")).toContain('scope="x evil=1"');
    expect(bearerChallenge(`${SITE}/m`, true)).toBe(`Bearer resource_metadata="${SITE}/m", error="invalid_token"`);
  });
});

describe("the authorization request (B4)", () => {
  const challenge = pkceChallenge("v".repeat(50));
  const base = {
    response_type: "code",
    client_id: "https://app.example/client.json",
    redirect_uri: "https://app.example/cb",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "xyz",
    resource: `${SITE}/api/mcp`,
    scope: "orders:read openid",
  };
  const read = (query: Record<string, string | string[] | undefined>) => readAuthorizeRequest(query, SITE, { clientId: base.client_id, redirectUri: base.redirect_uri });

  it("reads a good request", () => {
    expect(read(base)).toEqual({
      ok: true,
      request: { clientId: base.client_id, redirectUri: base.redirect_uri, codeChallenge: challenge, state: "xyz", resource: "mcp", scopes: ["orders:read"] },
    });
  });

  it("refuses without PKCE S256, a state, our resource or response_type=code, to be sent back to the client", () => {
    expect(read({ ...base, code_challenge_method: "plain" })).toMatchObject({ ok: false, refusal: { redirect: "invalid_request" } });
    expect(read({ ...base, code_challenge_method: undefined })).toMatchObject({ ok: false, refusal: { redirect: "invalid_request" } });
    expect(read({ ...base, code_challenge: "short" })).toMatchObject({ ok: false, refusal: { redirect: "invalid_request" } });
    expect(read({ ...base, state: undefined })).toMatchObject({ ok: false, refusal: { redirect: "invalid_request" } });
    expect(read({ ...base, state: "s".repeat(1001) })).toMatchObject({ ok: false, refusal: { redirect: "invalid_request" } });
    expect(read({ ...base, resource: undefined })).toMatchObject({ ok: false, refusal: { redirect: "invalid_target" } });
    expect(read({ ...base, resource: `${SITE}/api/admin/v1` })).toMatchObject({ ok: false, refusal: { redirect: "invalid_target" } });
    expect(read({ ...base, response_type: "token" })).toMatchObject({ ok: false, refusal: { redirect: "unsupported_response_type" } });
    expect(read({ ...base, state: ["a", "b"] })).toMatchObject({ ok: false, refusal: { redirect: "invalid_request" } });
  });

  it("shows the problem on the page, sending nothing, when the client or its redirect URI cannot be read", () => {
    expect(readClientParams({ ...base, client_id: undefined })).toEqual({ ok: false, refusal: { show: "client" } });
    expect(readClientParams({ ...base, redirect_uri: undefined })).toEqual({ ok: false, refusal: { show: "redirect_uri" } });
    expect(readClientParams({ ...base, redirect_uri: ["https://app.example/cb", "https://evil.example/cb"] })).toEqual({ ok: false, refusal: { show: "repeated" } });
    expect(readClientParams(base)).toEqual({ ok: true, clientId: base.client_id, redirectUri: base.redirect_uri });
  });
});
