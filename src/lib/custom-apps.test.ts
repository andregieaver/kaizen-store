import { describe, expect, it } from "vitest";

import { APP_ANSWER_MAX, appKey, appToolName, isAppToolName, readRpcAnswer, readToolList, toolAnswerText } from "./custom-apps";

describe("a custom app's tools (D363)", () => {
  it("names an app's tools as the providers take them, apart from the AI manager's own", () => {
    expect(appKey("Our Warehouse!")).toBe("our-warehouse");
    expect(appKey("!!!")).toBe("app");
    expect(appKey("Lager Ås")).toBe("lager-as");
    expect(appToolName("our-warehouse", "stock_level")).toBe("app__our-warehouse__stock_level");
    expect(appToolName("k", "x".repeat(80))).toHaveLength(64);
    expect(isAppToolName("app__k__x")).toBe(true);
    expect(isAppToolName("list_orders")).toBe(false);
  });

  it("keeps only tools of a sane shape from tools/list", () => {
    const tools = readToolList({
      tools: [
        { name: "stock_level", description: "Stock in the warehouse", inputSchema: { type: "object", properties: { sku: { type: "string" } } } },
        { name: "stock_level", description: "again" },
        { name: "bad name!", description: "x" },
        { name: "no_schema" },
        { name: "huge", inputSchema: { type: "object", properties: { a: { description: "x".repeat(30_000) } } } },
      ],
    });
    expect(tools.map((t) => t.name)).toEqual(["stock_level", "no_schema"]);
    expect(tools[1].inputSchema).toEqual({ type: "object", properties: {} });
    expect(readToolList(null)).toEqual([]);
  });

  it("reads a JSON-RPC answer as JSON or server-sent events", () => {
    expect(readRpcAnswer('{"jsonrpc":"2.0","id":2,"result":{"ok":true}}', "application/json")).toEqual({ result: { ok: true } });
    expect(readRpcAnswer('event: message\ndata: {"jsonrpc":"2.0","method":"note"}\n\ndata: {"jsonrpc":"2.0","id":2,"result":{"n":1}}\n', "text/event-stream")).toEqual({ result: { n: 1 } });
    expect(readRpcAnswer('{"jsonrpc":"2.0","id":2,"error":{"message":"nope"}}', "application/json")).toEqual({ error: { message: "nope" } });
    expect(readRpcAnswer("not json", "application/json")).toBeNull();
  });

  it("passes on an answer's text only, cut short, and names other kinds", () => {
    expect(toolAnswerText({ content: [{ type: "text", text: "12 left" }, { type: "image", data: "…" }] })).toEqual({ text: "12 left\n[image]", isError: false });
    expect(toolAnswerText({ content: [{ type: "text", text: "x".repeat(APP_ANSWER_MAX + 10) }], isError: true }).text).toHaveLength(APP_ANSWER_MAX + 1);
    expect(toolAnswerText({ content: [], isError: true }).isError).toBe(true);
  });
});
