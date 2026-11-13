/*
 * Kaizena Flow's chat widget on a website of its owner's own (D581, docs/support-embed.md). The widget's tag, the same on each of its sites:
 *
 *   <script src="https://kaizenaflow.com/embed/chat.js" data-key="{the widget's key}" async></script>
 *
 * puts one frame in the page's corner, from the origin this file came from: /embed/chat/{key}/{host}?p={path}. The frame stays
 * see-through and lets clicks through until the chat in it tells its state (a site whose tag was not found yet, or a desk with the chat
 * off, never does); it is never `display: none`, as browsers do not run a hidden frame's scripts. Then it takes the room the chat's button
 * says it needs (on the widget's side, with its offsets and words), and that side's edge of the window at the widget's panel width (the
 * whole window on a phone) while the chat is open. Nothing else of the page is read or changed, no cookie is set, and only messages from
 * the frame itself are listened to.
 */
(function () {
  "use strict";
  var script = document.currentScript;
  if (!script || window.__kaizenaChat) return;
  var key = script.getAttribute("data-key") || "";
  if (!/^[a-z0-9]{20}$/.test(key)) return;
  // The frame may only be framed by an https page on the site's own host (its frame-ancestors).
  if (location.protocol !== "https:") return;
  window.__kaizenaChat = true;
  var origin = new URL(script.src, location.href).origin;
  var host = location.hostname.toLowerCase().replace(/\.$/, "");
  var frame = document.createElement("iframe");
  frame.src = origin + "/embed/chat/" + key + "/" + host + "?p=" + encodeURIComponent(location.pathname.slice(0, 299));
  frame.title = "Chat";
  frame.setAttribute("allow", "microphone");
  frame.setAttribute("data-kaizena-chat", "");
  var base = "position:fixed;bottom:0;border:0;margin:0;padding:0;background:transparent;color-scheme:normal;z-index:2147483000;max-width:100%;max-height:100%;";
  frame.style.cssText = base + "right:0;width:144px;height:100px;opacity:0;pointer-events:none;";

  function size(value, min, max, fallback) {
    return typeof value === "number" && isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
  }

  // The chat's state, as the frame tells it: open or closed, its side, its closed button's room, and the open panel's width.
  function place(state) {
    var side = state.side === "left" ? "left:0;" : "right:0;";
    if (state.open) {
      var phone = window.matchMedia("(max-width: 767px)").matches;
      frame.style.cssText = base + side + "top:0;height:100%;width:" + (phone ? "100%" : size(state.panel, 280, 640, 384) + "px") + ";";
    } else {
      frame.style.cssText = base + side + "width:" + size(state.width, 40, 640, 144) + "px;height:" + size(state.height, 40, 400, 100) + "px;";
    }
  }

  window.addEventListener("message", function (event) {
    if (event.origin !== origin || event.source !== frame.contentWindow) return;
    var data = event.data;
    if (data && typeof data === "object" && data.kaizenaChat === "state") place(data);
  });

  function mount() {
    if (!frame.isConnected) document.body.appendChild(frame);
  }
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();
