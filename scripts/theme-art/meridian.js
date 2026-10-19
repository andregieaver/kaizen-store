/* global window */
/**
 * Meridian's art (`docs/signature-themes.md`): a consultancy drawn as an architect's rendering would show it, standing in until the
 * photographs are made (D270). Boardrooms high above a city at dusk, glass towers at night with their windows lit, a meeting by a tall window
 * with the people as calm silhouettes, a brass compass on walnut, a stone staircase in an atrium, an orderly aisle under skylights, and the
 * still lifes of each engagement. Deep navy, warm ivory and brass. No words, numbers or logos anywhere.
 */
(() => {
  const L = window.ARTLIB;
  const ART = window.ART;
  const TAU = Math.PI * 2;

  const NAVY = "#0e1726";
  const INK = "#08101c";
  const BRASS = "#c9a45c";
  const IVORY = "#f3efe6";
  const WALNUT = "#4a2f1d";

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------------------------------------------------------------

  /** A straight-edged shape. */
  function poly(ctx, pts) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
  }

  /** A soft round glow of light. */
  function glow(ctx, x, y, r, color, alpha = 1) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, L.rgba(color, alpha));
    g.addColorStop(1, L.rgba(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  /** A dusk or night sky: deep at the top, warmer at the horizon. */
  function duskSky(ctx, w, h, horizon, { night = false } = {}) {
    L.sky(ctx, w, horizon, night
      ? [[0, "#050a14"], [0.55, "#0c1830"], [1, "#1d2b48"]]
      : [[0, "#0b1530"], [0.45, "#22365e"], [0.78, "#7a6278"], [1, "#d39a6a"]]);
  }

  /**
   * Glass towers along a horizon, nearer ones taller and darker, each with a grid of windows of which some are lit. `y` is the ground line.
   */
  function towers(ctx, w, y, seed, { height = 0.5, lit = 0.35, tint = "#0d1626", windowLight = "#f2d9a0", scale = 1 } = {}) {
    const random = L.rng(seed);
    let x = -random.range(0, 60) * scale;
    const heightPx = y * height;
    while (x < w) {
      const tw = random.range(60, 170) * scale;
      const th = heightPx * random.range(0.35, 1);
      const top = y - th;
      const shade = L.mix(0, 1, random());
      ctx.fillStyle = shade > 0.5 ? tint : "#111c30";
      ctx.fillRect(x, top, tw, th);
      // A crown on a few.
      if (random() < 0.25) {
        ctx.fillRect(x + tw * 0.3, top - th * 0.06, tw * 0.4, th * 0.06);
        if (random() < 0.5) ctx.fillRect(x + tw * 0.48, top - th * 0.16, tw * 0.04, th * 0.1);
      }
      // Windows.
      const cols = Math.max(2, Math.floor(tw / (11 * scale)));
      const rows = Math.max(3, Math.floor(th / (14 * scale)));
      const cw = tw / cols;
      const rh = th / rows;
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const on = random() < lit;
          if (!on && random() < 0.7) continue;
          ctx.fillStyle = on ? L.rgba(windowLight, random.range(0.55, 0.95)) : "rgba(120,150,190,0.12)";
          ctx.fillRect(x + c * cw + cw * 0.22, top + r * rh + rh * 0.25, cw * 0.56, rh * 0.5);
        }
      }
      x += tw + random.range(4, 24) * scale;
    }
  }

  /** Wood with its grain running across, in a rectangle. */
  function walnut(ctx, x, y, w, h, seed, { base = WALNUT, dark = "#2b1a10", light = "#6b4429", along = "x" } = {}) {
    const noise = L.simplex(seed);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = base;
    ctx.fillRect(x, y, w, h);
    const lines = 140;
    for (let i = 0; i < lines; i++) {
      const t = i / lines;
      ctx.strokeStyle = L.rgba(i % 3 === 0 ? dark : light, 0.18 + 0.12 * Math.abs(noise(i * 0.3, 0.5)));
      ctx.lineWidth = Math.max(1, (along === "x" ? h : w) / lines) * (0.6 + Math.abs(noise(i, 2)));
      ctx.beginPath();
      for (let s = 0; s <= 60; s++) {
        const u = s / 60;
        const wobble = noise(u * 3 + i * 0.1, i * 0.07) * (along === "x" ? h : w) * 0.012;
        if (along === "x") {
          const px = x + u * w;
          const py = y + t * h + wobble;
          if (s === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        } else {
          const px = x + t * w + wobble;
          const py = y + u * h;
          if (s === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /** A diagonal beam of window light across the picture. */
  function beam(ctx, w, h, { from = [0.1, 0], to = [0.75, 1], width = 0.28, alpha = 0.22, color = "#fff1d6" } = {}) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const [fx, fy] = [from[0] * w, from[1] * h];
    const [tx, ty] = [to[0] * w, to[1] * h];
    const half = (width * w) / 2;
    const g = ctx.createLinearGradient(fx - half, 0, fx + half, 0);
    g.addColorStop(0, L.rgba(color, 0));
    g.addColorStop(0.5, L.rgba(color, alpha));
    g.addColorStop(1, L.rgba(color, 0));
    ctx.fillStyle = g;
    poly(ctx, [[fx - half, fy], [fx + half, fy], [tx + half * 1.6, ty], [tx - half * 1.6, ty]]);
    ctx.fill();
    ctx.restore();
  }

  /** A shadow under things standing on a surface. */
  function shadow(ctx, x, y, rx, ry, alpha = 0.45) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, rx);
    g.addColorStop(0, `rgba(0,0,0,${alpha})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, ry / rx);
    ctx.translate(-x, -y);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rx, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /** A brass compass seen from above: its case, rose of ticks and needle, no letters. */
  function compass(ctx, cx, cy, r, { open = true } = {}) {
    shadow(ctx, cx + r * 0.12, cy + r * 0.16, r * 1.25, r * 1.1, 0.55);
    const rim = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    rim.addColorStop(0, "#f0d79a");
    rim.addColorStop(0.45, BRASS);
    rim.addColorStop(1, "#6e5326");
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fill();
    // The ring for the lid's hinge.
    ctx.strokeStyle = rim;
    ctx.lineWidth = r * 0.07;
    ctx.beginPath();
    ctx.arc(cx, cy - r * 1.08, r * 0.12, 0, TAU);
    ctx.stroke();
    // The face.
    const face = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.25, r * 0.1, cx, cy, r * 0.86);
    face.addColorStop(0, "#fbf6ea");
    face.addColorStop(1, "#d9cdb2");
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.84, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(60,45,20,0.75)";
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * TAU;
      const long = i % 9 === 0;
      ctx.lineWidth = long ? r * 0.012 : r * 0.006;
      const r0 = r * (long ? 0.66 : 0.74);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8);
      ctx.stroke();
    }
    // A rose of eight points.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU - Math.PI / 2;
      const len = i % 2 === 0 ? r * 0.56 : r * 0.34;
      ctx.fillStyle = i % 2 === 0 ? "rgba(14,23,38,0.82)" : "rgba(14,23,38,0.4)";
      poly(ctx, [
        [cx + Math.cos(a) * len, cy + Math.sin(a) * len],
        [cx + Math.cos(a + 0.18) * r * 0.08, cy + Math.sin(a + 0.18) * r * 0.08],
        [cx, cy],
        [cx + Math.cos(a - 0.18) * r * 0.08, cy + Math.sin(a - 0.18) * r * 0.08],
      ]);
      ctx.fill();
    }
    // The needle, a little off north.
    const n = -Math.PI / 2 + 0.35;
    ctx.fillStyle = "#9e2f25";
    poly(ctx, [[cx + Math.cos(n) * r * 0.62, cy + Math.sin(n) * r * 0.62], [cx + Math.cos(n + 1.57) * r * 0.05, cy + Math.sin(n + 1.57) * r * 0.05], [cx, cy], [cx + Math.cos(n - 1.57) * r * 0.05, cy + Math.sin(n - 1.57) * r * 0.05]]);
    ctx.fill();
    ctx.fillStyle = NAVY;
    poly(ctx, [[cx - Math.cos(n) * r * 0.62, cy - Math.sin(n) * r * 0.62], [cx + Math.cos(n + 1.57) * r * 0.05, cy + Math.sin(n + 1.57) * r * 0.05], [cx, cy], [cx + Math.cos(n - 1.57) * r * 0.05, cy + Math.sin(n - 1.57) * r * 0.05]]);
    ctx.fill();
    ctx.fillStyle = BRASS;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.05, 0, TAU);
    ctx.fill();
    // Glass over the face.
    const glass = ctx.createLinearGradient(cx - r, cy - r, cx + r * 0.2, cy + r * 0.2);
    glass.addColorStop(0, "rgba(255,255,255,0.35)");
    glass.addColorStop(0.5, "rgba(255,255,255,0)");
    ctx.fillStyle = glass;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.84, 0, TAU);
    ctx.fill();
    if (open) {
      // The lid lying open above it.
      ctx.save();
      ctx.fillStyle = rim;
      ctx.beginPath();
      ctx.ellipse(cx, cy - r * 2.05, r * 0.98, r * 0.92, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "rgba(255,240,200,0.18)";
      ctx.beginPath();
      ctx.ellipse(cx - r * 0.2, cy - r * 2.2, r * 0.6, r * 0.5, -0.4, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  /** A room's wall of glass: the view behind, then mullions. */
  function glassWall(ctx, x, y, w, h, view, { panes = 5, mullion = "#0a111d" } = {}) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    view(ctx, x, y, w, h);
    ctx.restore();
    ctx.fillStyle = mullion;
    const pw = w / panes;
    for (let i = 0; i <= panes; i++) ctx.fillRect(x + i * pw - w * 0.004, y, w * 0.008, h);
    ctx.fillRect(x, y + h * 0.72, w, h * 0.01);
  }

  /** A chair from behind or from the side, as a dark rounded shape with a high back. */
  function chair(ctx, x, y, s, { side = 1, color = "#1a120c", light = "#3a2618" } = {}) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(side * s, s);
    const back = ctx.createLinearGradient(-30, -120, 30, 0);
    back.addColorStop(0, light);
    back.addColorStop(1, color);
    ctx.fillStyle = back;
    ctx.beginPath();
    ctx.moveTo(-34, 0);
    ctx.quadraticCurveTo(-40, -70, -26, -128);
    ctx.quadraticCurveTo(0, -140, 26, -128);
    ctx.quadraticCurveTo(40, -70, 34, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillRect(-4, 0, 8, 40);
    ctx.fillRect(-30, 40, 60, 6);
    ctx.restore();
  }

  /** A long table in perspective, from its near end toward the window. */
  function longTable(ctx, w, h, { nearY, farY, nearW, farW, cx, seed }) {
    const pts = [[cx - nearW / 2, nearY], [cx + nearW / 2, nearY], [cx + farW / 2, farY], [cx - farW / 2, farY]];
    ctx.save();
    poly(ctx, pts);
    ctx.clip();
    walnut(ctx, cx - nearW / 2, farY, nearW, nearY - farY, seed, { along: "y" });
    const sheen = ctx.createLinearGradient(0, farY, 0, nearY);
    sheen.addColorStop(0, "rgba(255,210,150,0.35)");
    sheen.addColorStop(0.5, "rgba(255,210,150,0.05)");
    sheen.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    // Its near edge.
    ctx.fillStyle = "#24160d";
    poly(ctx, [[cx - nearW / 2, nearY], [cx + nearW / 2, nearY], [cx + nearW / 2, nearY + h * 0.03], [cx - nearW / 2, nearY + h * 0.03]]);
    ctx.fill();
  }

  /** A pendant lamp's warm cone of light. */
  function pendant(ctx, x, y, s) {
    ctx.strokeStyle = "rgba(20,20,20,0.6)";
    ctx.lineWidth = Math.max(1, s * 0.02);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, y - s * 0.4);
    ctx.stroke();
    glow(ctx, x, y, s * 3.2, "#ffcf8a", 0.35);
    ctx.fillStyle = "#2a2018";
    poly(ctx, [[x - s * 0.5, y], [x + s * 0.5, y], [x + s * 0.2, y - s * 0.45], [x - s * 0.2, y - s * 0.45]]);
    ctx.fill();
    ctx.fillStyle = "#ffe2a8";
    ctx.fillRect(x - s * 0.45, y - s * 0.03, s * 0.9, s * 0.06);
  }

  /** A seated person as a calm silhouette from the side: head, neck, shoulders and back. */
  function sitter(ctx, x, y, s, { facing = 1, color = "#1b2433", rim = null } = {}) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(facing * s, s);
    ctx.fillStyle = color;
    // Body: broad shoulders over a jacket, leaning a little toward the table.
    ctx.beginPath();
    ctx.moveTo(-46, 0);
    ctx.quadraticCurveTo(-56, -64, -48, -92);
    ctx.quadraticCurveTo(-40, -112, -12, -114);
    ctx.lineTo(18, -114);
    ctx.quadraticCurveTo(46, -112, 56, -90);
    ctx.quadraticCurveTo(64, -60, 58, 0);
    ctx.closePath();
    ctx.fill();
    // A forearm resting on the table.
    ctx.beginPath();
    ctx.moveTo(30, -40);
    ctx.quadraticCurveTo(70, -26, 96, -8);
    ctx.lineTo(90, 4);
    ctx.quadraticCurveTo(60, -6, 24, -18);
    ctx.closePath();
    ctx.fill();
    // Neck and head, a little forward.
    ctx.fillRect(-4, -130, 16, 20);
    ctx.beginPath();
    ctx.ellipse(6, -150, 17, 22, 0.18, 0, TAU);
    ctx.fill();
    if (rim) {
      ctx.strokeStyle = rim;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(6, -150, 17, 22, 0.18, -1.2, 0.9);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(18, -114);
      ctx.quadraticCurveTo(46, -112, 56, -90);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** The city at dusk or night through a window: sky and towers. */
  function cityView(night) {
    return (ctx, x, y, w, h) => {
      ctx.save();
      ctx.translate(x, y);
      duskSky(ctx, w, h, h * 0.78, { night });
      towers(ctx, w, h * 0.95, night ? 11 : 7, { height: 0.62, lit: night ? 0.45 : 0.28, scale: w / 2000, tint: night ? "#0a1222" : "#18233a" });
      towers(ctx, w, h * 1.02, night ? 12 : 8, { height: 0.42, lit: night ? 0.5 : 0.35, scale: w / 1400, tint: night ? "#070d18" : "#121b2e" });
      ctx.restore();
    };
  }

  /** The finish every picture gets: a soft vignette and fine grain. */
  function finish(ctx, w, h, seed, { vignette = 0.45 } = {}) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(0,0,0,${vignette})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    L.grain(ctx, w, h, seed, 9);
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Rooms and views
  // ---------------------------------------------------------------------------------------------------------------------------------

  /** A boardroom high above the city: the long table toward a wall of glass, chairs on both sides, lamps lit. */
  function boardroom(ctx, w, h, seed, { tableCx = 0.62, night = false } = {}) {
    ctx.fillStyle = "#151b24";
    ctx.fillRect(0, 0, w, h);
    glassWall(ctx, 0, h * 0.06, w, h * 0.6, cityView(night), { panes: 6 });
    // The ceiling and the floor.
    ctx.fillStyle = "#0d1118";
    ctx.fillRect(0, 0, w, h * 0.06);
    const floor = ctx.createLinearGradient(0, h * 0.66, 0, h);
    floor.addColorStop(0, "#2a2620");
    floor.addColorStop(1, "#110f0c");
    ctx.fillStyle = floor;
    ctx.fillRect(0, h * 0.66, w, h * 0.34);
    // Reflections of the window on the floor.
    ctx.fillStyle = "rgba(200,170,140,0.06)";
    ctx.fillRect(0, h * 0.66, w, h * 0.05);
    const cx = w * tableCx;
    longTable(ctx, w, h, { nearY: h * 0.97, farY: h * 0.62, nearW: w * 0.52, farW: w * 0.2, cx, seed });
    // Chairs, smaller toward the window.
    for (let i = 0; i < 4; i++) {
      const t = i / 4;
      const yy = L.mix(h * 0.66, h * 1.02, t);
      const half = L.mix(w * 0.105, w * 0.28, t);
      const s = L.mix(0.42, 1.25, t) * (h / 1440);
      chair(ctx, cx - half - w * 0.012, yy, s, { side: 1 });
      chair(ctx, cx + half + w * 0.012, yy, s, { side: -1 });
    }
    for (const [px, py, s] of [[0.48, 0.2, 0.024], [0.62, 0.17, 0.02], [0.76, 0.2, 0.024]]) pendant(ctx, cx + (px - 0.62) * w, h * py, w * s);
    finish(ctx, w, h, seed, { vignette: 0.5 });
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // The pictures
  // ---------------------------------------------------------------------------------------------------------------------------------

  ART.hero = {
    w: 2560,
    h: 1440,
    draw(ctx, w, h) {
      boardroom(ctx, w, h, 101, { tableCx: 0.66 });
      // The left third calmer for the headline: a deeper shade of the evening.
      const g = ctx.createLinearGradient(0, 0, w * 0.5, 0);
      g.addColorStop(0, "rgba(8,16,28,0.65)");
      g.addColorStop(1, "rgba(8,16,28,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
  };

  ART.story = {
    w: 1600,
    h: 1200,
    draw(ctx, w, h) {
      // A tall window on the left, its light across the room.
      ctx.fillStyle = "#2b2a28";
      ctx.fillRect(0, 0, w, h);
      const wall = ctx.createLinearGradient(0, 0, w, 0);
      wall.addColorStop(0, "#d9d2c3");
      wall.addColorStop(1, "#6b6458");
      ctx.fillStyle = wall;
      ctx.fillRect(0, 0, w, h * 0.7);
      ctx.fillStyle = "#f4efe3";
      ctx.fillRect(w * 0.04, h * 0.06, w * 0.26, h * 0.6);
      ctx.fillStyle = "rgba(150,175,200,0.55)";
      ctx.fillRect(w * 0.055, h * 0.08, w * 0.23, h * 0.56);
      ctx.fillStyle = "#c8c0ae";
      ctx.fillRect(w * 0.165, h * 0.06, w * 0.01, h * 0.6);
      beam(ctx, w, h, { from: [0.17, 0.1], to: [0.6, 1], width: 0.22, alpha: 0.28 });
      // The table.
      walnut(ctx, 0, h * 0.68, w, h * 0.32, 202);
      ctx.fillStyle = "rgba(255,230,190,0.18)";
      ctx.fillRect(0, h * 0.68, w, h * 0.012);
      // Three people in conversation, calm silhouettes lit from the window.
      sitter(ctx, w * 0.36, h * 0.72, h / 520, { facing: 1, color: "#1d2533", rim: "rgba(255,236,200,0.55)" });
      sitter(ctx, w * 0.6, h * 0.72, h / 500, { facing: -1, color: "#202838", rim: "rgba(255,236,200,0.35)" });
      sitter(ctx, w * 0.82, h * 0.74, h / 470, { facing: -1, color: "#161d2a" });
      // Papers and a closed laptop between them.
      ctx.fillStyle = "rgba(245,240,230,0.9)";
      poly(ctx, [[w * 0.44, h * 0.78], [w * 0.52, h * 0.775], [w * 0.53, h * 0.82], [w * 0.45, h * 0.825]]);
      ctx.fill();
      ctx.fillStyle = "#2b2f36";
      poly(ctx, [[w * 0.55, h * 0.8], [w * 0.66, h * 0.795], [w * 0.67, h * 0.83], [w * 0.56, h * 0.835]]);
      ctx.fill();
      finish(ctx, w, h, 203, { vignette: 0.5 });
    },
  };

  ART.city = {
    w: 2400,
    h: 1200,
    draw(ctx, w, h) {
      duskSky(ctx, w, h, h, { night: true });
      glow(ctx, w * 0.7, h * 0.95, w * 0.5, "#3b4f7a", 0.35);
      towers(ctx, w, h * 1.0, 31, { height: 0.42, lit: 0.42, scale: 1.1, tint: "#0b1324" });
      towers(ctx, w, h * 1.06, 32, { height: 0.34, lit: 0.5, scale: 1.4, tint: "#070c17" });
      finish(ctx, w, h, 33, { vignette: 0.5 });
    },
  };

  ART["tile-strategy"] = {
    w: 1200,
    h: 1500,
    draw(ctx, w, h) {
      walnut(ctx, 0, 0, w, h, 301, { along: "y", base: "#3a2416" });
      ctx.fillStyle = "rgba(4,8,16,0.45)";
      ctx.fillRect(0, 0, w, h);
      beam(ctx, w, h, { from: [0.15, 0], to: [0.75, 1], width: 0.42, alpha: 0.34 });
      compass(ctx, w * 0.5, h * 0.42, w * 0.22);
      finish(ctx, w, h, 302, { vignette: 0.6 });
    },
  };

  ART["tile-leadership"] = {
    w: 1200,
    h: 1500,
    draw(ctx, w, h) {
      // An atrium lit from a glass roof: pale stone walls, a staircase rising across the picture.
      L.sky(ctx, w, h, [[0, "#f6f2ea"], [0.5, "#d9d1c2"], [1, "#9c9384"]]);
      glow(ctx, w * 0.5, 0, w * 0.9, "#ffffff", 0.7);
      // The roof's frames.
      ctx.strokeStyle = "rgba(60,60,60,0.25)";
      ctx.lineWidth = 6;
      for (let i = 0; i <= 6; i++) {
        ctx.beginPath();
        ctx.moveTo((w * i) / 6, 0);
        ctx.lineTo(w * 0.5 + (w * (i - 3)) / 10, h * 0.12);
        ctx.stroke();
      }
      // The flights of stairs zig-zagging up, each step a lit tread and a shaded riser.
      const flights = [
        { x0: w * 0.08, y0: h * 0.98, x1: w * 0.78, y1: h * 0.66 },
        { x0: w * 0.78, y0: h * 0.62, x1: w * 0.2, y1: h * 0.36 },
        { x0: w * 0.2, y0: h * 0.32, x1: w * 0.7, y1: h * 0.14 },
      ];
      flights.forEach((f, k) => {
        const steps = 14 - k * 3;
        const width = h * (0.07 - k * 0.015);
        for (let i = 0; i < steps; i++) {
          const t0 = i / steps;
          const t1 = (i + 1) / steps;
          const ax = L.mix(f.x0, f.x1, t0);
          const ay = L.mix(f.y0, f.y1, t0);
          const bx = L.mix(f.x0, f.x1, t1);
          const by = L.mix(f.y0, f.y1, t1);
          ctx.fillStyle = "#efe9dd";
          poly(ctx, [[ax, by], [bx, by], [bx, by + width * 0.25], [ax, by + width * 0.25]]);
          ctx.fill();
          ctx.fillStyle = "#b7ae9e";
          poly(ctx, [[ax, by + width * 0.25], [bx, by + width * 0.25], [bx, ay + width * 0.25], [ax, ay + width * 0.25]]);
          ctx.fill();
        }
        // Its balustrade: a fine brass line.
        ctx.strokeStyle = L.rgba(BRASS, 0.8);
        ctx.lineWidth = Math.max(2, width * 0.06);
        ctx.beginPath();
        ctx.moveTo(f.x0, f.y0 - width * 0.9);
        ctx.lineTo(f.x1, f.y1 - width * 0.9);
        ctx.stroke();
        // The underside's shadow.
        ctx.fillStyle = "rgba(60,55,48,0.25)";
        poly(ctx, [[f.x0, f.y0 + width * 0.3], [f.x1, f.y1 + width * 0.3], [f.x1, f.y1 + width * 0.9], [f.x0, f.y0 + width * 0.9]]);
        ctx.fill();
      });
      finish(ctx, w, h, 402, { vignette: 0.35 });
    },
  };

  /** A long aisle of shelving under skylights, in one-point perspective. */
  function aisle(ctx, w, h, seed) {
    const vx = w * 0.5;
    const vy = h * 0.46;
    L.sky(ctx, w, h, [[0, "#e7e4dc"], [0.45, "#d4d0c6"], [1, "#8e8a82"]]);
    // The floor: polished concrete with the skylights' reflections.
    const floor = ctx.createLinearGradient(0, vy, 0, h);
    floor.addColorStop(0, "#b9b5ac");
    floor.addColorStop(1, "#6f6c66");
    ctx.fillStyle = floor;
    poly(ctx, [[0, h], [w, h], [vx, vy]]);
    ctx.fill();
    // The skylights along the ceiling.
    for (let i = 0; i < 9; i++) {
      const t = 1 - Math.pow(0.78, i + 1);
      const y = L.mix(0, vy, t);
      const half = L.mix(w * 0.16, w * 0.01, t);
      const depth = L.mix(h * 0.03, h * 0.003, t);
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.fillRect(vx - half, y, half * 2, depth);
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fillRect(vx - half * 0.6, L.mix(h, vy, t), half * 1.2, depth * 0.6);
    }
    const random = L.rng(seed);
    // The shelves on both sides: uprights and stacked plain boxes.
    for (const side of [-1, 1]) {
      const bays = 12;
      for (let b = bays - 1; b >= 0; b--) {
        const t0 = 1 - Math.pow(0.8, b);
        const t1 = 1 - Math.pow(0.8, b + 1);
        const x0 = L.mix(side < 0 ? 0 : w, vx + side * w * 0.03, t0);
        const x1 = L.mix(side < 0 ? 0 : w, vx + side * w * 0.03, t1);
        const top0 = L.mix(h * 0.02, vy - h * 0.06, t0);
        const top1 = L.mix(h * 0.02, vy - h * 0.06, t1);
        const bot0 = L.mix(h * 0.98, vy + h * 0.04, t0);
        const bot1 = L.mix(h * 0.98, vy + h * 0.04, t1);
        ctx.fillStyle = "#e9e5db";
        poly(ctx, [[x0, top0], [x1, top1], [x1, bot1], [x0, bot0]]);
        ctx.fill();
        const levels = 5;
        for (let l = 0; l < levels; l++) {
          const u0 = l / levels;
          const u1 = (l + 1) / levels;
          const ya0 = L.mix(top0, bot0, u0);
          const yb0 = L.mix(top0, bot0, u1);
          const ya1 = L.mix(top1, bot1, u0);
          const yb1 = L.mix(top1, bot1, u1);
          // Boxes on the shelf.
          ctx.fillStyle = random() < 0.5 ? "#c7b391" : "#b9a37f";
          poly(ctx, [[x0, L.mix(ya0, yb0, 0.18)], [x1, L.mix(ya1, yb1, 0.18)], [x1, L.mix(ya1, yb1, 0.92)], [x0, L.mix(ya0, yb0, 0.92)]]);
          ctx.fill();
          // The shelf's beam.
          ctx.fillStyle = NAVY;
          poly(ctx, [[x0, yb0 - (yb0 - ya0) * 0.06], [x1, yb1 - (yb1 - ya1) * 0.06], [x1, yb1], [x0, yb0]]);
          ctx.fill();
        }
        // The upright.
        ctx.fillStyle = "#1b2638";
        poly(ctx, [[x0, top0], [x0 + side * -1 * Math.abs(x1 - x0) * 0.08, top0], [x0 + side * -1 * Math.abs(x1 - x0) * 0.08, bot0], [x0, bot0]]);
        ctx.fill();
      }
    }
  }

  ART["tile-operations"] = {
    w: 1200,
    h: 1500,
    draw(ctx, w, h) {
      aisle(ctx, w, h, 501);
      finish(ctx, w, h, 502, { vignette: 0.4 });
    },
  };

  // ---------------------------------------------------------------------------------------------------------------------------------
  // The engagements' still lifes
  // ---------------------------------------------------------------------------------------------------------------------------------

  /** A notebook, a fountain pen and a cup of coffee on walnut by a window. */
  ART["service-strategy-session"] = {
    w: 1600,
    h: 1200,
    draw(ctx, w, h) {
      walnut(ctx, 0, 0, w, h, 601);
      beam(ctx, w, h, { from: [0.0, 0], to: [0.55, 1], width: 0.5, alpha: 0.3 });
      // The notebook.
      shadow(ctx, w * 0.44, h * 0.6, w * 0.26, h * 0.2, 0.5);
      ctx.save();
      ctx.translate(w * 0.42, h * 0.54);
      ctx.rotate(-0.12);
      ctx.fillStyle = "#1b2433";
      ctx.fillRect(-w * 0.17, -h * 0.2, w * 0.34, h * 0.4);
      ctx.fillStyle = "#26324a";
      ctx.fillRect(-w * 0.17, -h * 0.2, w * 0.34, h * 0.012);
      ctx.fillStyle = "#c9a45c";
      ctx.fillRect(w * 0.12, -h * 0.2, w * 0.012, h * 0.4);
      ctx.restore();
      // The pen.
      ctx.save();
      ctx.translate(w * 0.66, h * 0.62);
      ctx.rotate(-0.55);
      shadow(ctx, 6, 8, w * 0.13, h * 0.02, 0.5);
      const pen = ctx.createLinearGradient(0, -10, 0, 10);
      pen.addColorStop(0, "#2a2a2a");
      pen.addColorStop(0.5, "#0b0b0b");
      pen.addColorStop(1, "#1a1a1a");
      ctx.fillStyle = pen;
      ctx.fillRect(-w * 0.12, -h * 0.012, w * 0.24, h * 0.024);
      ctx.fillStyle = BRASS;
      ctx.fillRect(w * 0.03, -h * 0.013, w * 0.012, h * 0.026);
      ctx.fillRect(-w * 0.12, -h * 0.004, w * 0.08, h * 0.004);
      ctx.restore();
      // The cup on its saucer.
      const cx = w * 0.76;
      const cy = h * 0.3;
      shadow(ctx, cx + 16, cy + 24, w * 0.11, h * 0.1, 0.5);
      ctx.fillStyle = "#f4f1ea";
      ctx.beginPath();
      ctx.ellipse(cx, cy, w * 0.1, h * 0.12, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#e6e0d3";
      ctx.beginPath();
      ctx.ellipse(cx, cy, w * 0.062, h * 0.074, 0, 0, TAU);
      ctx.fill();
      const coffee = ctx.createRadialGradient(cx - 8, cy - 8, 2, cx, cy, w * 0.05);
      coffee.addColorStop(0, "#7a4a28");
      coffee.addColorStop(1, "#3a2010");
      ctx.fillStyle = coffee;
      ctx.beginPath();
      ctx.ellipse(cx, cy, w * 0.05, h * 0.06, 0, 0, TAU);
      ctx.fill();
      finish(ctx, w, h, 602, { vignette: 0.5 });
    },
  };

  /** A brass compass lying open on a dark walnut desk. */
  ART["service-growth-review"] = {
    w: 1600,
    h: 1200,
    draw(ctx, w, h) {
      walnut(ctx, 0, 0, w, h, 701, { base: "#3a2416" });
      ctx.fillStyle = "rgba(4,8,16,0.35)";
      ctx.fillRect(0, 0, w, h);
      beam(ctx, w, h, { from: [0.25, 0], to: [0.7, 1], width: 0.36, alpha: 0.32 });
      compass(ctx, w * 0.56, h * 0.62, h * 0.2);
      finish(ctx, w, h, 702, { vignette: 0.55 });
    },
  };

  /** An empty boardroom with the city at dusk behind the glass. */
  ART["service-board-workshop"] = {
    w: 1600,
    h: 1200,
    draw(ctx, w, h) {
      boardroom(ctx, w, h, 801, { tableCx: 0.5 });
    },
  };

  /** Two armchairs facing each other by a tall window. */
  ART["service-leadership-coaching"] = {
    w: 1600,
    h: 1200,
    draw(ctx, w, h) {
      L.sky(ctx, w, h, [[0, "#e9e3d6"], [0.7, "#cfc6b4"], [1, "#9e937f"]]);
      // The window with its sheer curtains.
      ctx.fillStyle = "#f7f4ec";
      ctx.fillRect(w * 0.3, h * 0.06, w * 0.4, h * 0.64);
      for (let i = 0; i < 18; i++) {
        ctx.fillStyle = `rgba(255,255,255,${0.25 + (i % 2) * 0.15})`;
        ctx.fillRect(w * 0.3 + (i * w * 0.4) / 18, h * 0.06, (w * 0.4) / 36, h * 0.64);
      }
      glow(ctx, w * 0.5, h * 0.4, w * 0.45, "#fff6e0", 0.5);
      // The floor.
      const floor = ctx.createLinearGradient(0, h * 0.7, 0, h);
      floor.addColorStop(0, "#a58d6c");
      floor.addColorStop(1, "#6e5a43");
      ctx.fillStyle = floor;
      ctx.fillRect(0, h * 0.7, w, h * 0.3);
      shadow(ctx, w * 0.5, h * 0.9, w * 0.42, h * 0.06, 0.4);
      // Two cognac armchairs and a small round table.
      const armchair = (x, side) => {
        ctx.save();
        ctx.translate(x, h * 0.88);
        ctx.scale(side * (h / 1200), h / 1200);
        const leather = ctx.createLinearGradient(-160, -320, 120, 0);
        leather.addColorStop(0, "#b8743e");
        leather.addColorStop(1, "#6e3c1b");
        ctx.fillStyle = leather;
        ctx.beginPath();
        ctx.moveTo(-150, 0);
        ctx.lineTo(-150, -150);
        ctx.quadraticCurveTo(-160, -330, -70, -340);
        ctx.quadraticCurveTo(-20, -330, -30, -170);
        ctx.lineTo(140, -170);
        ctx.quadraticCurveTo(170, -170, 170, -120);
        ctx.lineTo(170, 0);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "rgba(255,220,180,0.18)";
        ctx.fillRect(-30, -170, 170, 14);
        ctx.fillStyle = "#2a1a10";
        ctx.fillRect(-140, 0, 14, 30);
        ctx.fillRect(150, 0, 14, 30);
        ctx.restore();
      };
      armchair(w * 0.25, 1);
      armchair(w * 0.75, -1);
      ctx.fillStyle = "#2b1d12";
      ctx.beginPath();
      ctx.ellipse(w * 0.5, h * 0.74, w * 0.06, h * 0.018, 0, 0, TAU);
      ctx.fill();
      ctx.fillRect(w * 0.497, h * 0.74, w * 0.006, h * 0.13);
      finish(ctx, w, h, 902, { vignette: 0.35 });
    },
  };

  /** A calm warehouse aisle under skylights. */
  ART["service-operations-review"] = {
    w: 1600,
    h: 1200,
    draw(ctx, w, h) {
      aisle(ctx, w, h, 1001);
      finish(ctx, w, h, 1002, { vignette: 0.4 });
    },
  };

  /** A glass wall covered in blank paper notes in neat columns. */
  ART["service-change-kickoff"] = {
    w: 1600,
    h: 1200,
    draw(ctx, w, h) {
      L.sky(ctx, w, h, [[0, "#dfe5ea"], [1, "#b7c1ca"]]);
      // The room seen through the glass, softly.
      ctx.fillStyle = "rgba(14,23,38,0.12)";
      ctx.fillRect(0, h * 0.62, w, h * 0.38);
      glow(ctx, w * 0.8, h * 0.2, w * 0.4, "#ffffff", 0.5);
      const random = L.rng(1101);
      const tints = ["#fff4c8", "#f7e3b0", "#fbefd9", "#e9dcc1", "#f2e6cf"];
      const cols = 6;
      for (let c = 0; c < cols; c++) {
        const x = w * 0.1 + (c * w * 0.8) / cols;
        const rows = 3 + Math.floor(random() * 3);
        for (let r = 0; r < rows; r++) {
          const s = w * 0.085;
          const y = h * 0.12 + r * s * 1.12;
          const tilt = random.range(-0.05, 0.05);
          ctx.save();
          ctx.translate(x + s / 2, y + s / 2);
          ctx.rotate(tilt);
          ctx.fillStyle = "rgba(0,0,0,0.12)";
          ctx.fillRect(-s / 2 + 4, -s / 2 + 6, s, s);
          ctx.fillStyle = random.pick(tints);
          ctx.fillRect(-s / 2, -s / 2, s, s);
          ctx.fillStyle = "rgba(0,0,0,0.05)";
          ctx.fillRect(-s / 2, -s / 2, s, s * 0.14);
          ctx.restore();
        }
        // A brass line heading each column.
        ctx.fillStyle = L.rgba(BRASS, 0.9);
        ctx.fillRect(x, h * 0.09, w * 0.085, h * 0.006);
      }
      // The ledge and a marker pen resting on it.
      ctx.fillStyle = "#9aa6b1";
      ctx.fillRect(0, h * 0.86, w, h * 0.02);
      ctx.fillStyle = NAVY;
      ctx.fillRect(w * 0.6, h * 0.845, w * 0.12, h * 0.016);
      ctx.fillStyle = IVORY;
      ctx.fillRect(w * 0.7, h * 0.845, w * 0.02, h * 0.016);
      finish(ctx, w, h, 1102, { vignette: 0.3 });
    },
  };

  // Unused colour kept for the helpers' defaults.
  void INK;
})();
