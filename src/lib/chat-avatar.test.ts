import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { avatarFrameStyle, cleanAvatarStyle, DEFAULT_AVATAR_STYLE } from "./chat-avatar";

describe("the chat agent's picture frame (D233)", () => {
  it("keeps nothing for a style that changes nothing, or for what is not a style", () => {
    expect(cleanAvatarStyle(null)).toBeNull();
    expect(cleanAvatarStyle("red")).toBeNull();
    expect(cleanAvatarStyle([])).toBeNull();
    expect(cleanAvatarStyle(DEFAULT_AVATAR_STYLE)).toBeNull();
  });

  it("never lets owner data become CSS of its own: colours, numbers and shadows fall back when they are not what is allowed", () => {
    const style = cleanAvatarStyle({
      fill: "url(javascript:x)",
      colour: "red; position: fixed",
      border: 99,
      borderColour: "#ABCDEF",
      shadow: "0 0 999px red",
      angle: -40,
    });
    expect(style).toMatchObject({ fill: "none", colour: DEFAULT_AVATAR_STYLE.colour, border: 8, borderColour: "#abcdef", shadow: "none", angle: 0 });
  });

  it("draws a colour, a gradient, a border and a shadow", () => {
    const base = { ...DEFAULT_AVATAR_STYLE };
    expect(avatarFrameStyle({ ...base, fill: "colour", colour: "#ff0000" })).toEqual({ background: "#ff0000" });
    expect(avatarFrameStyle({ ...base, fill: "gradient", colour: "#000000", colour2: "#ffffff", angle: 90 })).toEqual({
      background: "linear-gradient(90deg, #000000, #ffffff)",
    });
    expect(avatarFrameStyle({ ...base, border: 3, borderColour: "#00ff00" })).toEqual({ border: "3px solid #00ff00" });
    expect(avatarFrameStyle({ ...base, shadow: "medium", shadowColour: "#000000" })).toEqual({ boxShadow: "0 4px 12px #00000059" });
    expect(avatarFrameStyle(null)).toEqual({});
  });

  it("loads no zod, since the visitor's widget imports it", () => {
    expect(readFileSync(join(__dirname, "chat-avatar.ts"), "utf8")).not.toMatch(/from "zod"/);
  });
});
