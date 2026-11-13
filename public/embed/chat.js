/*
 * Kaizena Flow's chat on a site of its owner's own (D581, docs/support-embed.md). The site's tag:
 *
 *   <script src="https://kaizenaflow.com/embed/chat.js" data-key="{the site's key}" async></script>
 *
 * puts one frame in the page's corner, from the origin this file came from: /embed/chat/{key}/{host}?p={path}. The frame stays
 * see-through and lets clicks through until the chat in it says it is ready (a site whose tag was not found yet, or a desk with the chat
 * off, never says so); it is never `display: none`, as browsers do not run a hidden frame's scripts. Then it takes the room of the chat's
 * button, and the right-hand edge of the window (the whole window on a phone) while the chat is open. Nothing else
 * of the page is read or changed, no cookie is set, and only messages from the frame itself are listened to.
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
  var base = "position:fixed;right:0;bottom:0;border:0;margin:0;padding:0;background:transparent;color-scheme:normal;z-index:2147483000;max-width:100%;max-height:100%;";
  var closed = "width:144px;height:100px;";
  frame.style.cssText = base + closed + "opacity:0;pointer-events:none;";

  function place(open) {
    var phone = window.matchMedia("(max-width: 767px)").matches;
    if (open) {
      frame.style.cssText = base + "top:0;height:100%;width:" + (phone ? "100%" : "24rem") + ";";
    } else {
      frame.style.cssText = base + closed;
    }
  }

  window.addEventListener("message", function (event) {
    if (event.origin !== origin || event.source !== frame.contentWindow) return;
    var data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.kaizenaChat === "ready") place(false);
    else if (data.kaizenaChat === "open") place(data.open === true);
  });

  function mount() {
    if (!frame.isConnected) document.body.appendChild(frame);
  }
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();
