/* global window */
/**
 * Botanica's art (`docs/signature-themes.md`): a calm plant shop drawn as gouache and cut paper. Warm cream paper with its grain; plants cut
 * from deep and fresh greens, each leaf with lighter veins, a little tonal play from brush strokes and noise, slightly imperfect hand-cut
 * edges and a soft paper-cut shadow where it lies over another; terracotta, glazed and woven pots on light oak. The plants are drawn to be
 * recognisable: monstera, fiddle-leaf fig, bird of paradise, snake plant, ZZ plant, pilea, bird's-nest fern and string of pearls. No words,
 * numbers, logos, people or faces anywhere; every random choice comes from a fixed seed.
 */
(() => {
  const L = window.ARTLIB;
  const ART = window.ART;
  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Colour
  // ---------------------------------------------------------------------------------------------------------------------------------

  const hex = (h) => L.hexRgb(h);
  const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const css = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
  /** The darkest green-black, for shade, and the warm light, for highlights. */
  const INK = hex("#0d1a12");
  const SUN = hex("#fbf6df");
  const shade = (c, k) => mixc(c, INK, k);
  const lift = (c, k) => mixc(c, SUN, k);

  const G = {
    deep: hex("#1f3d2b"),
    mid: hex("#2f5e3d"),
    fresh: hex("#4f8a5b"),
    light: hex("#8db07a"),
    hi: hex("#c9d98f"),
  };
  const BOP = hex("#36654f");
  const NEST = hex("#5c9a4f");
  const SNAKE = hex("#27482f");
  const TERRA = { base: hex("#b9653f"), light: hex("#d08a5e"), dark: hex("#7f4127") };
  const OAK = { base: hex("#c9a77c"), light: hex("#dcc29c"), dark: hex("#a07a50") };
  const SOIL = hex("#4a3727");
  const BARK = hex("#7d6650");

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Geometry
  // ---------------------------------------------------------------------------------------------------------------------------------

  /** A Catmull-Rom spline through `pts`, `n` points a span. */
  function catmull(pts, n, closed) {
    const out = [];
    const N = pts.length;
    const get = (i) => (closed ? pts[(i + N) % N] : pts[Math.max(0, Math.min(N - 1, i))]);
    const spans = closed ? N : N - 1;
    for (let i = 0; i < spans; i++) {
      const p0 = get(i - 1);
      const p1 = get(i);
      const p2 = get(i + 1);
      const p3 = get(i + 2);
      for (let k = 0; k < n; k++) {
        const t = k / n;
        const t2 = t * t;
        const t3 = t2 * t;
        const at = (j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3);
        out.push([at(0), at(1)]);
      }
    }
    if (!closed) out.push(pts[N - 1]);
    return out;
  }

  /** Points every `step` along a line. */
  function resample(pts, step, closed = true) {
    const out = [pts[0]];
    const N = pts.length;
    const spans = closed ? N : N - 1;
    let since = 0;
    for (let i = 0; i < spans; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % N];
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      let s = step - since;
      while (s <= d) {
        const t = s / d;
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        s += step;
      }
      since = d - (s - step);
    }
    if (!closed) out.push(pts[N - 1]);
    return out;
  }

  const NOISE = L.simplex(4242);

  /** A hand-cut edge: each point moved along its normal by a little noise. */
  function wobble(pts, amp, freq, seed, closed = true) {
    const n = pts.length;
    const out = [];
    let s = 0;
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      if (i > 0) s += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
      if (!closed && (i === 0 || i === n - 1)) {
        out.push(p);
        continue;
      }
      const a = pts[(i - 1 + n) % n];
      const b = pts[(i + 1) % n];
      const tx = b[0] - a[0];
      const ty = b[1] - a[1];
      const tl = Math.hypot(tx, ty) || 1;
      const d = (NOISE(s * freq + seed * 0.37, seed * 0.11) * 0.8 + NOISE(s * freq * 3.7, seed * 0.29 + 40) * 0.2) * amp;
      out.push([p[0] - (ty / tl) * d, p[1] + (tx / tl) * d]);
    }
    return out;
  }

  function inside(poly, x, y) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0];
      const yi = poly[i][1];
      const xj = poly[j][0];
      const yj = poly[j][1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  }

  /** From x, y heading `ang`, turning `curl` a unit of length, until the line leaves `poly` (its last point just outside). */
  function march(poly, x, y, ang, curl, step = 0.005, max = 3) {
    const pts = [[x, y]];
    let a = ang;
    for (let s = 0; s < max; s += step) {
      x += Math.cos(a) * step;
      y += Math.sin(a) * step;
      a += curl * step;
      pts.push([x, y]);
      if (!inside(poly, x, y)) break;
    }
    return pts;
  }

  function cubic(p0, p1, p2, p3, n = 40) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const u = 1 - t;
      out.push([
        u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
      ]);
    }
    return out;
  }

  function quad(p0, p1, p2, n = 30) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const u = 1 - t;
      out.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
    }
    return out;
  }

  /** A band along `pts` whose width goes from w0 to w1 (or follows `prof(t)` times w0). */
  function taperPoly(pts, w0, w1, prof = null) {
    const n = pts.length;
    const left = [];
    const right = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0];
      let ty = b[1] - a[1];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      const t = i / (n - 1);
      const w = (prof ? w0 * prof(t) : w0 + (w1 - w0) * t) / 2;
      left.push([p[0] - ty * w, p[1] + tx * w]);
      right.push([p[0] + ty * w, p[1] - tx * w]);
    }
    return [...left, ...right.reverse()];
  }

  function ellipsePts(cx, cy, rx, ry, rot = 0, n = 48) {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * TAU;
      const x = Math.cos(a) * rx;
      const y = Math.sin(a) * ry;
      return [cx + x * c - y * s, cy + x * s + y * c];
    });
  }

  /** A blade: half-widths `right(t)` and `left(t)` along a midrib from the base (0, 0) to the tip (0, -1). */
  function blade(right, left, steps = 140) {
    const r = [];
    const l = [];
    for (let i = 0; i <= steps; i++) r.push([right(i / steps), -i / steps]);
    for (let i = steps; i >= 0; i--) l.push([-left(i / steps), -i / steps]);
    return [...r, ...l.slice(1, -1)];
  }

  /** A leaf's curve and turn: the midrib bent sideways toward the tip, one half narrower as if turned away. */
  function warper(bend, turn) {
    return ([x, y]) => [x * (x > 0 ? 1 + turn : 1 - turn) + bend * y * y, y];
  }

  function addPath(c, pts) {
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.closePath();
  }

  function path(c, pts) {
    c.beginPath();
    addPath(c, pts);
  }

  function line(c, pts, width, color, alpha = 1) {
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.lineWidth = width;
    c.lineCap = "round";
    c.lineJoin = "round";
    c.strokeStyle = css(color, alpha);
    c.stroke();
  }

  function taper(c, pts, w0, w1, color, alpha = 1, prof = null) {
    path(c, taperPoly(pts, w0, w1, prof));
    c.fillStyle = css(color, alpha);
    c.fill();
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Affine placement
  // ---------------------------------------------------------------------------------------------------------------------------------

  /** A placement `{ x, y, rot, s, sx?, sy? }` (or a matrix `{ m }`) as a matrix [a, b, c, d, e, f]. */
  function affine(at) {
    if (at.m) return at.m;
    const c = Math.cos(at.rot || 0);
    const s = Math.sin(at.rot || 0);
    const sx = at.s * (at.sx ?? 1);
    const sy = at.s * (at.sy ?? 1);
    return [c * sx, s * sx, -s * sy, c * sy, at.x, at.y];
  }
  const apply = (m, p) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
  function invVec(m, vx, vy) {
    const det = m[0] * m[3] - m[1] * m[2];
    return [(m[3] * vx - m[2] * vy) / det, (-m[1] * vx + m[0] * vy) / det];
  }
  const ID = { m: [1, 0, 0, 1, 0, 0] };

  // ---------------------------------------------------------------------------------------------------------------------------------
  // The page's light and its paper-cut shadows
  // ---------------------------------------------------------------------------------------------------------------------------------

  /** Light falls from the upper left. `unit` is one pixel of a 1500 px tall picture, set by each picture. */
  const STYLE = { unit: 1, shadow: 1 };
  const LIGHT = [-0.55, -0.83];

  function shadowFor(depth = 1, alpha = 0.3) {
    const u = STYLE.unit * STYLE.shadow;
    return { dx: 4 * u * depth, dy: 7 * u * depth, blur: 13 * u * depth, color: `rgba(20,34,22,${alpha})` };
  }

  /** Lays `layer` on `ctx` at x, y with a paper-cut shadow (and a second, broad and faint one). */
  function composite(ctx, layer, x, y, shadow, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    if (shadow && shadow.wide) {
      const far = 20000;
      ctx.shadowColor = shadow.wide.color;
      ctx.shadowBlur = shadow.wide.blur;
      ctx.shadowOffsetX = shadow.wide.dx + far;
      ctx.shadowOffsetY = shadow.wide.dy;
      ctx.drawImage(layer, x - far, y);
    }
    if (shadow) {
      ctx.shadowColor = shadow.color;
      ctx.shadowBlur = shadow.blur;
      ctx.shadowOffsetX = shadow.dx;
      ctx.shadowOffsetY = shadow.dy;
    }
    ctx.drawImage(layer, x, y);
    ctx.restore();
  }

  function lightIn(m) {
    const v = invVec(m, LIGHT[0], LIGHT[1]);
    const l = Math.hypot(v[0], v[1]) || 1;
    return [v[0] / l, v[1] / l];
  }

  /** The paper's cut edge: a light line where it faces the light, a dark one where it faces away. */
  function edgeLight(lc, m, outline, k, glint = null) {
    const d = 1.5 * STYLE.unit;
    const [lx, ly] = invVec(m, d, d);
    const sc = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
    lc.save();
    lc.lineJoin = "round";
    lc.lineWidth = (2.6 * d) / sc;
    lc.save();
    lc.translate(lx, ly);
    path(lc, outline);
    lc.strokeStyle = glint ? css(glint, 0.45 * k) : `rgba(255,251,228,${0.22 * k})`;
    lc.stroke();
    lc.restore();
    lc.translate(-lx, -ly);
    path(lc, outline);
    lc.strokeStyle = `rgba(8,20,12,${0.3 * k})`;
    lc.stroke();
    lc.restore();
  }

  /**
   * A cut-paper piece: `outline` (and `holes`) in its own coordinates, placed by `at`, filled, painted by `paint(lc, m)` inside its outline,
   * its holes cut out, then laid on `ctx` with a paper-cut shadow.
   */
  function piece(ctx, { outline, holes = null, at, fill, paint = null, shadow = shadowFor(), edge = 1, alpha = 1, glint = null }) {
    const m = affine(at);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of outline) {
      const [x, y] = apply(m, p);
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    const mg = 60 * STYLE.unit;
    x0 = Math.max(Math.floor(x0) - 3, -mg);
    y0 = Math.max(Math.floor(y0) - 3, -mg);
    x1 = Math.min(Math.ceil(x1) + 3, W + mg);
    y1 = Math.min(Math.ceil(y1) + 3, H + mg);
    if (x1 - x0 < 2 || y1 - y0 < 2) return;
    const layer = L.canvas(x1 - x0, y1 - y0);
    const lc = layer.getContext("2d");
    lc.setTransform(m[0], m[1], m[2], m[3], m[4] - x0, m[5] - y0);
    path(lc, outline);
    lc.fillStyle = fill;
    lc.fill();
    lc.save();
    path(lc, outline);
    lc.clip();
    if (paint) paint(lc, m);
    if (edge) edgeLight(lc, m, outline, edge, glint);
    lc.restore();
    if (holes && holes.length) {
      lc.globalCompositeOperation = "destination-out";
      lc.beginPath();
      for (const h of holes) addPath(lc, h);
      lc.fillStyle = "#000";
      lc.fill();
      lc.globalCompositeOperation = "source-over";
    }
    composite(ctx, layer, x0, y0, shadow, alpha);
  }

  /** Several things drawn together on a layer of their own (in the picture's coordinates), then laid down with one shadow. */
  function group(ctx, draw, { shadow = shadowFor(), alpha = 1 } = {}) {
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    const layer = L.canvas(W, H);
    draw(layer.getContext("2d"));
    composite(ctx, layer, 0, 0, shadow, alpha);
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Paint: textures, light and brush strokes
  // ---------------------------------------------------------------------------------------------------------------------------------

  let TEX = null;
  /** Grey noise textures, drawn once: soft-light over a leaf they lighten and darken it. */
  function tex() {
    if (TEX) return TEX;
    const make = (seed, size, fx, fy, octaves, contrast) => {
      const c = L.canvas(size, size);
      const g = c.getContext("2d");
      const img = g.createImageData(size, size);
      const n = L.simplex(seed);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const v = L.clamp(128 + L.fbm(n, (x / size) * fx, (y / size) * fy, octaves) * contrast, 0, 255);
          const k = (y * size + x) * 4;
          img.data[k] = v;
          img.data[k + 1] = v;
          img.data[k + 2] = v;
          img.data[k + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
      return c;
    };
    TEX = { mottle: make(901, 256, 3, 3, 5, 200), streak: make(902, 256, 1.2, 9, 4, 190), fine: make(903, 256, 11, 11, 3, 170) };
    return TEX;
  }

  function overlay(lc, t, box, alpha, r, mode = "soft-light") {
    const s = t.width;
    const sw = s * L.mix(0.45, 0.8, r());
    const sh = s * L.mix(0.45, 0.8, r());
    lc.save();
    lc.globalCompositeOperation = mode;
    lc.globalAlpha = alpha;
    lc.drawImage(t, r() * (s - sw), r() * (s - sh), sw, sh, box[0], box[1], box[2] - box[0], box[3] - box[1]);
    lc.restore();
  }

  /** A gradient across `box` from the side away from the light (dark) to the side toward it (light). */
  function lit(lc, m, box, dark, light, mid = null, alpha = 1) {
    const [vx, vy] = lightIn(m);
    const cx = (box[0] + box[2]) / 2;
    const cy = (box[1] + box[3]) / 2;
    const R = Math.hypot(box[2] - box[0], box[3] - box[1]) / 2;
    const g = lc.createLinearGradient(cx - vx * R, cy - vy * R, cx + vx * R, cy + vy * R);
    g.addColorStop(0, css(dark, alpha));
    if (mid) g.addColorStop(0.5, css(mid, alpha));
    g.addColorStop(1, css(light, alpha));
    lc.fillStyle = g;
    lc.fillRect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
  }

  /** The half of a leaf on the far side of its midrib from the light, a little darker, as if folded along it. */
  function fold(lc, m, midrib, colour, alpha = 0.12) {
    const [lx] = lightIn(m);
    const far = lx < 0 ? 3 : -3;
    lc.beginPath();
    lc.moveTo(midrib[0][0], midrib[0][1] + 0.3);
    for (const [x, y] of midrib) lc.lineTo(x, y);
    const last = midrib[midrib.length - 1];
    lc.lineTo(last[0], last[1] - 0.3);
    lc.lineTo(far, last[1] - 0.3);
    lc.lineTo(far, midrib[0][1] + 0.3);
    lc.closePath();
    lc.fillStyle = css(shade(colour, 0.5), alpha);
    lc.fill();
  }

  /** A blade from half-width profiles given as points (t along the midrib, half-width), smoothed. */
  function profileBlade(right, left) {
    const r = catmull(right, 10, false).map(([t, w]) => [w, -t]);
    const l = catmull(left, 10, false).map(([t, w]) => [-w, -t]).reverse();
    return [...r, ...l.slice(1, -1)];
  }

  function glow(lc, x, y, rx, ry, color, alpha, rot = 0) {
    lc.save();
    lc.translate(x, y);
    lc.rotate(rot);
    lc.scale(1, ry / rx);
    const g = lc.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, css(color, alpha));
    g.addColorStop(1, css(color, 0));
    lc.fillStyle = g;
    lc.fillRect(-rx, -rx, rx * 2, rx * 2);
    lc.restore();
  }

  /** Short gouache strokes over `box`, along `dir(x, y)`. */
  function strokes(lc, r, n, box, { dir, len, width, colors, alpha, bend = 0.25 }) {
    lc.save();
    lc.lineCap = "round";
    for (let i = 0; i < n; i++) {
      const x = r.range(box[0], box[2]);
      const y = r.range(box[1], box[3]);
      const a = dir(x, y) + r.gauss() * 0.12;
      const l = r.range(len[0], len[1]);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const b = r.gauss() * bend * l;
      lc.beginPath();
      lc.moveTo(x - (ca * l) / 2, y - (sa * l) / 2);
      lc.quadraticCurveTo(x - sa * b, y + ca * b, x + (ca * l) / 2, y + (sa * l) / 2);
      lc.strokeStyle = css(r.pick(colors), r.range(alpha[0], alpha[1]));
      lc.lineWidth = r.range(width[0], width[1]);
      lc.stroke();
    }
    lc.restore();
  }

  /** A soft dark rim inside the edge, so the leaf reads as curved. */
  function rim(lc, outline, color, k = 1, width = 0.03) {
    lc.save();
    lc.lineJoin = "round";
    for (let i = 1; i <= 3; i++) {
      path(lc, outline);
      lc.lineWidth = width * i;
      lc.strokeStyle = css(shade(color, 0.55), 0.07 * k);
      lc.stroke();
    }
    lc.restore();
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Leaves (each in its own coordinates: the base at 0, 0 and the tip at 0, -1)
  // ---------------------------------------------------------------------------------------------------------------------------------

  /** A split from inside a monstera's leaf out through its edge, along `pts` from `fin` of its length; `gap` wide at the edge. */
  function wedge(pts, fin, gap, seed) {
    const n = pts.length;
    const i0 = Math.min(n - 3, Math.max(0, Math.floor((n - 1) * fin)));
    const sub = pts.slice(i0);
    const span = sub.length - 1;
    const a = sub[sub.length - 2];
    const b = sub[sub.length - 1];
    const dl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    for (let k = 1; k <= 10; k++) sub.push([b[0] + ((b[0] - a[0]) / dl) * 0.007 * k, b[1] + ((b[1] - a[1]) / dl) * 0.007 * k]);
    const lft = [];
    const rgt = [];
    for (let i = 0; i < sub.length; i++) {
      const p = sub[i];
      const pa = sub[Math.max(0, i - 1)];
      const pb = sub[Math.min(sub.length - 1, i + 1)];
      let tx = pb[0] - pa[0];
      let ty = pb[1] - pa[1];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      const f = i / Math.max(1, span);
      const hw = 0.0016 + (gap / 2) * Math.pow(Math.min(1, f), 0.8) * (f > 1 ? 1 + (f - 1) * 0.8 : 1);
      lft.push([p[0] - ty * hw, p[1] + tx * hw]);
      rgt.push([p[0] + ty * hw, p[1] - tx * hw]);
    }
    const p0 = sub[0];
    const p1 = sub[1];
    const back = [p0[0] - (p1[0] - p0[0]) * 0.5, p0[1] - (p1[1] - p0[1]) * 0.5];
    return wobble([back, ...lft, ...rgt.reverse()], 0.0009, 25, seed);
  }

  /**
   * A monstera leaf: heart-shaped with a deep sinus where the stalk meets it, cut by splits from the edge between its veins and pierced by
   * a row of holes near the midrib. `cut` from 0 (a young, whole leaf) to 1 (a mature one).
   */
  function monstera(seed, { cut = 1, bend = 0, turn = 0, colour = G.deep, light = 1 } = {}) {
    const r = L.rng(seed);
    const HALF = [[0, -1], [0.12, -0.955], [0.262, -0.862], [0.378, -0.718], [0.448, -0.543], [0.468, -0.362], [0.442, -0.192], [0.378, -0.048], [0.29, 0.066], [0.18, 0.126], [0.088, 0.116], [0.032, 0.062], [0.009, 0.016]];
    const side = (sgn) => HALF.map(([x, y], i) => {
      const j = i === 0 ? 0 : 0.012;
      return [sgn * (x + r.gauss() * j), y + r.gauss() * j];
    });
    const ctrl = [...side(1), [0, -0.006], ...side(-1).reverse().slice(0, -1)];
    const flat = wobble(resample(catmull(ctrl, 12, true), 0.006), 0.0032, 7, seed);
    const n = 8 + (r() < 0.5 ? 1 : 0);
    const alpha = (t) => (40 + 78 * Math.pow(L.clamp(1 - t), 1.7)) * DEG;
    const veins = [];
    const cuts = [];
    for (const sgn of [1, -1]) {
      const ts = Array.from({ length: n }, (_, i) => L.mix(0.035, 0.86, Math.pow(i / (n - 1), 0.92)) + r.gauss() * 0.01);
      const dirOf = (t) => -Math.PI / 2 + sgn * alpha(t);
      const curl = -sgn * 0.6;
      for (const t of ts) {
        const pts = march(flat, 0, -t, dirOf(t) + r.gauss() * 0.03, curl);
        veins.push(pts.slice(0, Math.max(2, Math.floor(pts.length * 0.93))));
      }
      if (cut <= 0) continue;
      for (let i = 0; i < n - 1; i++) {
        const t = (ts[i] + ts[i + 1]) / 2;
        if (t > 0.8 || r() > 0.96) continue;
        const step = 0.005;
        const pts = march(flat, 0, -t, dirOf(t) + r.gauss() * 0.035, curl, step);
        const D = (pts.length - 1) * step;
        const fin = L.mix(1.0, L.mix(0.1, 0.36, r()) + (t > 0.62 ? 0.22 : 0), cut);
        cuts.push(wedge(pts, Math.min(0.9, fin), L.mix(0.03, 0.058, r()) * L.mix(0.45, 1, cut), seed * 7 + i * 13 + (sgn > 0 ? 0 : 500)));
        if (cut > 0.55 && r() < 0.8 && fin * D > 0.1) {
          const s = r.range(0.05, fin * D - 0.045);
          const k = Math.min(pts.length - 3, Math.round(s / step));
          const [px, py] = pts[k];
          const [qx, qy] = pts[k + 2];
          const ang = Math.atan2(qy - py, qx - px);
          const len = Math.min(r.range(0.045, 0.085), fin * D - s);
          const wid = r.range(0.015, 0.024) * cut;
          cuts.push(wobble(ellipsePts(px, py, len / 2, wid / 2, ang, 30), 0.0012, 30, seed + i));
        }
      }
    }
    const midrib = Array.from({ length: 40 }, (_, i) => [0, L.mix(0.01, -0.965, i / 39)]);
    const warp = warper(bend, turn);
    const outline = flat.map(warp);
    const holes = cuts.map((h) => h.map(warp));
    const vw = veins.map((v) => v.map(warp));
    const mr = midrib.map(warp);
    const paint = (lc, m) => {
      const box = [-0.66, -1.05, 0.66, 0.2];
      lit(lc, m, box, shade(colour, 0.28), lift(colour, 0.1 + 0.08 * light), colour);
      overlay(lc, tex().mottle, box, 0.2, r);
      strokes(lc, r, 320, box, {
        dir: (x, y) => -Math.PI / 2 + Math.sign(x || 1) * alpha(-y) * 0.95,
        len: [0.05, 0.16],
        width: [0.008, 0.026],
        colors: [lift(colour, 0.3), shade(colour, 0.35), lift(colour, 0.16)],
        alpha: [0.05, 0.12],
      });
      fold(lc, m, mr, colour, 0.14);
      for (const v of vw) line(lc, v, 0.05, lift(colour, 0.3), 0.06);
      for (const v of vw) taper(lc, v, 0.009, 0.0025, lift(colour, 0.36), 0.55);
      taper(lc, mr, 0.026, 0.005, lift(colour, 0.36), 0.9);
      line(lc, mr.map(([x, y]) => [x + 0.008, y]), 0.004, shade(colour, 0.4), 0.35);
      const [lx, ly] = lightIn(m);
      glow(lc, lx * 0.22, -0.48 + ly * 0.2, 0.34, 0.26, SUN, 0.1 * light);
      rim(lc, outline, colour);
      overlay(lc, tex().fine, box, 0.22, r, "overlay");
    };
    return { outline, holes, paint, fill: css(colour), glint: mixc(G.hi, colour, 0.25) };
  }

  /** A fiddle-leaf fig's leaf: violin-shaped, wide and round at the top with a little notch, a waist, prominent pale veins; glossy. */
  function fiddle(seed, { bend = 0, turn = 0, colour = G.deep, light = 1 } = {}) {
    const r = L.rng(seed);
    // The violin: a narrow rounded base, a waist, then a broad, almost flat-topped head with a shallow notch.
    const VIOLIN = [[0, 0], [0.02, 0.055], [0.08, 0.12], [0.2, 0.185], [0.34, 0.215], [0.46, 0.235], [0.58, 0.285], [0.7, 0.34], [0.8, 0.362], [0.88, 0.348], [0.94, 0.302], [0.975, 0.225], [0.993, 0.12], [0.99, 0]];
    const side = (k, ph) => VIOLIN.map(([t, w], i) => [t, (w * k + (i > 0 && i < VIOLIN.length - 1 ? r.gauss() * 0.004 : 0)) * (1 + 0.03 * Math.sin(t * 22 + ph) * L.smooth(0.05, 0.3, t))]);
    const shape = profileBlade(side(1, r() * TAU), side(r.range(0.92, 1.04), r() * TAU));
    const flat = wobble(resample(shape, 0.006), 0.0028, 8, seed);
    const veins = [];
    const n = 8;
    for (const sgn of [1, -1]) {
      for (let i = 0; i < n; i++) {
        const t = L.mix(0.1, 0.86, i / (n - 1)) + r.gauss() * 0.012;
        const a = L.mix(64, 44, t) * DEG;
        const pts = march(flat, 0, -t, -Math.PI / 2 + sgn * a, -sgn * 1.3);
        veins.push(pts.slice(0, Math.max(2, Math.floor(pts.length * 0.86))));
      }
    }
    const midrib = Array.from({ length: 40 }, (_, i) => [0, L.mix(0, -0.95, i / 39)]);
    const warp = warper(bend, turn);
    const outline = flat.map(warp);
    const vw = veins.map((v) => v.map(warp));
    const mr = midrib.map(warp);
    const vein = mixc(colour, G.hi, 0.62);
    const paint = (lc, m) => {
      const box = [-0.5, -1.03, 0.5, 0.03];
      lit(lc, m, box, shade(colour, 0.3), lift(colour, 0.1 + 0.08 * light), colour);
      overlay(lc, tex().mottle, box, 0.2, r);
      fold(lc, m, mr, colour, 0.12);
      strokes(lc, r, 220, box, {
        dir: (x) => -Math.PI / 2 + Math.sign(x || 1) * 52 * DEG,
        len: [0.05, 0.12],
        width: [0.01, 0.024],
        colors: [lift(colour, 0.26), shade(colour, 0.35)],
        alpha: [0.05, 0.1],
      });
      // The quilted surface between the veins: a light ridge on each.
      for (const v of vw) line(lc, v, 0.055, lift(colour, 0.32), 0.07);
      for (const v of vw) taper(lc, v, 0.011, 0.003, vein, 0.72);
      taper(lc, mr, 0.03, 0.006, vein, 0.88);
      const [lx, ly] = lightIn(m);
      glow(lc, lx * 0.17, -0.62 + ly * 0.15, 0.13, 0.3, SUN, 0.2 * light, Math.atan2(lx, -ly) * 0.3);
      glow(lc, lx * 0.2, -0.6, 0.3, 0.4, SUN, 0.07 * light);
      rim(lc, outline, colour);
      overlay(lc, tex().fine, box, 0.22, r, "overlay");
    };
    return { outline, holes: null, paint, fill: css(colour), glint: mixc(G.hi, colour, 0.2) };
  }

  /** A bird of paradise's paddle: a long oblong blade, its pale midrib, fine parallel veins, torn here and there along them. */
  function paddle(seed, { bend = 0, turn = 0, colour = BOP, tears = 3, light = 1, width = 0.19 } = {}) {
    const r = L.rng(seed);
    const prof = (k) => (t) => width * k * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.5) * (1 - 0.2 * t);
    const flat = wobble(resample(blade(prof(1), prof(r.range(0.9, 1.05)), 160), 0.006), 0.002, 6, seed);
    const ang = 70 * DEG;
    const cuts = [];
    for (const sgn of [1, -1]) {
      const k = Math.floor(r.range(0, tears + 1));
      for (let i = 0; i < k; i++) {
        const t = r.range(0.14, 0.9);
        const pts = march(flat, 0, -t, -Math.PI / 2 + sgn * ang, -sgn * 0.2, 0.004);
        cuts.push(wedge(pts, r.range(0, 0.7), r.range(0.006, 0.016), seed + i * 31 + (sgn > 0 ? 0 : 300)));
      }
    }
    const midrib = Array.from({ length: 40 }, (_, i) => [0, L.mix(0.0, -0.97, i / 39)]);
    const warp = warper(bend, turn);
    const outline = flat.map(warp);
    const holes = cuts.map((h) => h.map(warp));
    const mr = midrib.map(warp);
    const paint = (lc, m) => {
      const box = [-0.3, -1.02, 0.3, 0.02];
      lit(lc, m, box, shade(colour, 0.3), lift(colour, 0.12 + 0.08 * light), colour);
      overlay(lc, tex().streak, box, 0.45, r);
      // Fine parallel veins from the midrib to the edge.
      lc.save();
      lc.lineCap = "round";
      for (let t = 0.01; t < 1; t += 0.0105) {
        for (const sgn of [1, -1]) {
          const y = -t;
          const x = bend * y * y;
          const a = -Math.PI / 2 + sgn * ang;
          lc.beginPath();
          lc.moveTo(x, y);
          lc.quadraticCurveTo(x + Math.cos(a) * 0.15, y + Math.sin(a) * 0.15, x + Math.cos(a - sgn * 0.12) * 0.32, y + Math.sin(a - sgn * 0.12) * 0.32);
          lc.lineWidth = r.range(0.002, 0.005);
          lc.strokeStyle = css(r() < 0.5 ? lift(colour, 0.35) : shade(colour, 0.3), r.range(0.08, 0.2));
          lc.stroke();
        }
      }
      lc.restore();
      line(lc, mr.map(([x, y]) => [x - 0.03, y]), 0.06, shade(colour, 0.3), 0.12);
      taper(lc, mr, 0.032, 0.006, mixc(colour, G.hi, 0.55), 0.9);
      const [lx, ly] = lightIn(m);
      glow(lc, lx * 0.1, -0.55 + ly * 0.1, 0.15, 0.35, SUN, 0.1 * light);
      rim(lc, outline, colour, 1, 0.02);
      overlay(lc, tex().fine, box, 0.2, r, "overlay");
    };
    return { outline, holes, paint, fill: css(colour), glint: mixc(G.hi, colour, 0.3) };
  }

  /** A snake plant's cross-bands as a picture of its flat leaf (across -1.15 to 1.15 widths, tip at the top): pale grey-green zig-zags. */
  function snakeBands(seed) {
    const cw = 80;
    const ch = 800;
    const c = L.canvas(cw, ch);
    const g = c.getContext("2d");
    const img = g.createImageData(cw, ch);
    const n = L.simplex(seed);
    const pale = hex("#b3c2a0");
    const dark = shade(SNAKE, 0.5);
    const N = 30 + (seed % 9);
    const tri = (x) => Math.abs((((x % 1) + 1) % 1) - 0.5) * 2;
    for (let j = 0; j < ch; j++) {
      const v = j / ch;
      for (let i = 0; i < cw; i++) {
        const u = (i / (cw - 1)) * 2.3 - 1.15;
        const warp = L.fbm(n, u * 0.6, v * N * 0.16, 3) * 0.5 + tri(u * 1.5 + L.fbm(n, 3, v * N * 0.08, 2) * 2) * 0.32;
        const phase = v * N + warp;
        const wave = Math.sin(phase * TAU) + L.fbm(n, u * 3 + 20, v * N * 0.9, 2) * 0.35;
        const breakUp = L.smooth(-0.6, -0.05, L.fbm(n, u * 1.4 + 9, v * N * 0.3, 3));
        const lightBand = L.smooth(0.5, 0.95, wave) * breakUp;
        const darkBand = L.smooth(0.2, 0.9, -wave) * 0.5;
        const k = (j * cw + i) * 4;
        const a = Math.max(lightBand * 0.78, darkBand * 0.5);
        const col = lightBand * 0.78 >= darkBand * 0.5 ? pale : dark;
        img.data[k] = col[0];
        img.data[k + 1] = col[1];
        img.data[k + 2] = col[2];
        img.data[k + 3] = a * 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  /** A snake plant's sword: stiff, pointed, with pale zig-zag cross-bands on dark green and a yellow edge. */
  function sword(seed, { bend = 0, turn = 0, width = 0.075, colour = SNAKE, edge = true, light = 1 } = {}) {
    const r = L.rng(seed);
    const prof = (k) => (t) => width * k * (0.6 + 0.4 * L.smooth(0, 0.28, t)) * (t < 0.62 ? 1 : Math.pow((1 - t) / 0.38, 0.8));
    const flat = wobble(resample(blade(prof(1), prof(r.range(0.9, 1.08)), 160), 0.005), 0.0015, 5, seed);
    const warp = warper(bend, turn);
    const outline = flat.map(warp);
    const paint = (lc, m) => {
      const box = [-width * 1.4 - Math.abs(bend), -1.02, width * 1.4 + Math.abs(bend), 0.02];
      lit(lc, m, box, shade(colour, 0.25), lift(colour, 0.12 * light), colour);
      // The cross-bands, drawn in slices so they follow the leaf's bend.
      const bands = snakeBands(seed);
      const slices = 30;
      for (let i = 0; i < slices; i++) {
        const y = -1 + i / slices;
        const yc = y + 0.5 / slices;
        lc.drawImage(bands, 0, (i / slices) * bands.height, bands.width, bands.height / slices + 1, -width * 1.15 + bend * yc * yc, y, width * 2.3, 1 / slices + 0.002);
      }
      overlay(lc, tex().streak, box, 0.4, r);
      // The channel down its middle: one half a little darker.
      lc.save();
      lc.beginPath();
      for (let i = 0; i <= 40; i++) {
        const y = -i / 40;
        lc.lineTo(bend * y * y, y);
      }
      lc.lineTo(box[2], -1);
      lc.lineTo(box[2], 0);
      lc.closePath();
      lc.fillStyle = css(INK, 0.1);
      lc.fill();
      lc.restore();
      if (edge) {
        path(lc, outline);
        lc.lineWidth = width * 0.34;
        lc.strokeStyle = css(hex("#cfd39a"), 0.3);
        lc.stroke();
        path(lc, outline);
        lc.lineWidth = width * 0.17;
        lc.strokeStyle = css(hex("#ddcf66"), 0.95);
        lc.stroke();
      }
      // The dry point at the very tip.
      lc.save();
      lc.beginPath();
      lc.rect(-1, -1.05, 2, 0.035);
      lc.fillStyle = css(hex("#8a7a4a"), 0.7);
      lc.fill();
      lc.restore();
      rim(lc, outline, colour, 0.8, 0.012);
    };
    return { outline, holes: null, paint, fill: css(colour) };
  }

  /** A ZZ plant's leaflet: a glossy, pointed oval. */
  function zzLeaflet(seed, { bend = 0, turn = 0, colour = G.deep, light = 1 } = {}) {
    const r = L.rng(seed);
    const prof = (k) => (t) => 0.2 * k * Math.pow(Math.sin(Math.PI * Math.pow(t, 1.12)), 0.72);
    const flat = wobble(resample(blade(prof(1), prof(r.range(0.85, 1.05)), 80), 0.008), 0.002, 6, seed);
    const warp = warper(bend, turn);
    const outline = flat.map(warp);
    const paint = (lc, m) => {
      const box = [-0.25, -1.02, 0.25, 0.02];
      lit(lc, m, box, shade(colour, 0.3), lift(colour, 0.22 * light), colour);
      overlay(lc, tex().mottle, box, 0.4, r);
      const [lx] = lightIn(m);
      const sx = lx > 0 ? 1 : -1;
      // The gloss: a long soft streak on the side toward the light, and a bright point in it.
      glow(lc, sx * 0.075 + bend * 0.25, -0.5, 0.05, 0.3, lift(G.light, 0.2), 0.45 * light, -sx * 0.1);
      glow(lc, sx * 0.07 + bend * 0.2, -0.42, 0.025, 0.11, SUN, 0.45 * light);
      line(lc, Array.from({ length: 20 }, (_, i) => [bend * (i / 19) ** 2 * 0.95, -(i / 19) * 0.92]), 0.008, lift(colour, 0.22), 0.5);
      rim(lc, outline, colour, 1, 0.02);
    };
    return { outline, holes: null, paint, fill: css(colour), glint: mixc(G.hi, colour, 0.2) };
  }

  /** A bird's-nest fern's frond: an undivided, wavy-edged strap of bright green on a dark midrib. */
  function nestFrond(seed, { bend = 0, turn = 0, colour = NEST, width = 0.1, light = 1 } = {}) {
    const r = L.rng(seed);
    const prof = (ph, k) => (t) => width * k * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.95)), 0.42) * (1 - 0.18 * t) * L.smooth(0, 0.12, t) * (1 + 0.08 * Math.sin(t * 58 + ph) * L.smooth(0.12, 0.35, t));
    const flat = wobble(resample(blade(prof(r() * TAU, 1), prof(r() * TAU, r.range(0.9, 1.05)), 200), 0.005), 0.0016, 9, seed);
    const warp = warper(bend, turn);
    const outline = flat.map(warp);
    const midrib = Array.from({ length: 50 }, (_, i) => [0, -0.94 * (i / 49)]).map(warp);
    const paint = (lc, m) => {
      const box = [-width * 1.3 - Math.abs(bend), -1.02, width * 1.3 + Math.abs(bend), 0.02];
      // Darker toward the nest, brighter toward the tip.
      const g = lc.createLinearGradient(0, 0, bend, -1);
      g.addColorStop(0, css(shade(colour, 0.45)));
      g.addColorStop(0.35, css(colour));
      g.addColorStop(1, css(lift(colour, 0.22)));
      lc.fillStyle = g;
      lc.fillRect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
      lit(lc, m, box, INK, SUN, null, 0.16 * light);
      overlay(lc, tex().streak, box, 0.4, r);
      // Fine veins, close together, from the midrib to the edge.
      lc.save();
      lc.lineCap = "round";
      for (let t = 0.04; t < 0.97; t += 0.0065) {
        const y = -t;
        const x = bend * y * y;
        for (const sgn of [1, -1]) {
          const a = -Math.PI / 2 + sgn * 64 * DEG;
          lc.beginPath();
          lc.moveTo(x, y);
          lc.lineTo(x + Math.cos(a) * width * 1.4, y + Math.sin(a) * width * 1.4);
          lc.lineWidth = 0.0022;
          lc.strokeStyle = css(lift(colour, 0.4), r.range(0.1, 0.22));
          lc.stroke();
        }
      }
      lc.restore();
      taper(lc, midrib, 0.016, 0.002, hex("#2a2016"), 0.92);
      rim(lc, outline, colour, 1, 0.012);
      overlay(lc, tex().fine, box, 0.1, r, "overlay");
    };
    return { outline, holes: null, paint, fill: css(colour), light, glint: mixc(G.hi, colour, 0.1) };
  }

  /** A pilea's leaf: a round coin, its stalk meeting it under the face at `attach` (in the unit circle), veins radiating from there. */
  function pileaLeaf(seed, { attach = [0, 0.3], back = false, colour = G.fresh, light = 1 } = {}) {
    const r = L.rng(seed);
    const tipA = Math.atan2(-attach[1], -attach[0]);
    const pts = [];
    for (let i = 0; i < 90; i++) {
      const a = (i / 90) * TAU;
      let d = Math.abs(((a - tipA + Math.PI) % TAU + TAU) % TAU - Math.PI);
      const tip = 0.06 * Math.exp(-((d / 0.09) ** 2));
      pts.push([Math.cos(a) * (1 + tip), Math.sin(a) * (1 + tip)]);
    }
    const outline = wobble(pts, 0.012, 5, seed);
    const face = back ? lift(mixc(colour, G.light, 0.5), 0.25) : colour;
    const paint = (lc, m) => {
      const box = [-1.1, -1.1, 1.1, 1.1];
      lit(lc, m, box, shade(face, 0.25), lift(face, 0.14 * light), face);
      const g = lc.createRadialGradient(attach[0], attach[1], 0, attach[0], attach[1], 1.4);
      g.addColorStop(0, css(lift(face, 0.18), 0.6));
      g.addColorStop(1, css(shade(face, 0.2), 0.3));
      lc.fillStyle = g;
      lc.fillRect(-1.1, -1.1, 2.2, 2.2);
      overlay(lc, tex().fine, box, 0.16, r);
      strokes(lc, r, 70, box, {
        dir: (x, y) => Math.atan2(y - attach[1], x - attach[0]),
        len: [0.2, 0.45],
        width: [0.04, 0.09],
        colors: [lift(face, 0.22), shade(face, 0.25)],
        alpha: [0.05, 0.1],
      });
      const nv = 9;
      for (let i = 0; i < nv; i++) {
        const a = tipA + ((i - (nv - 1) / 2) / nv) * TAU * 0.98 + r.gauss() * 0.06;
        const pts2 = quad(attach, [attach[0] + Math.cos(a) * 0.5, attach[1] + Math.sin(a) * 0.5], [Math.cos(a + 0.12) * 0.92, Math.sin(a + 0.12) * 0.92], 16);
        taper(lc, pts2, back ? 0.05 : 0.035, 0.008, lift(face, back ? 0.45 : 0.32), back ? 0.7 : 0.45);
      }
      glow(lc, attach[0], attach[1], 0.09, 0.09, back ? lift(face, 0.5) : lift(face, 0.3), 0.8);
      rim(lc, outline, face, 1, 0.06);
      overlay(lc, tex().fine, box, 0.08, r, "overlay");
    };
    return { outline, holes: null, paint, fill: css(face), glint: mixc(G.hi, face, 0.2) };
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Stems
  // ---------------------------------------------------------------------------------------------------------------------------------

  /** A stalk along `pts` (picture coordinates), tapering w0 to w1, cut from paper with a light stripe along its lit side. */
  function stalk(ctx, pts, w0, w1, colour, { shadow = shadowFor(0.6), prof = null, stripe = 0.35 } = {}) {
    const outline = taperPoly(pts, w0, w1, prof);
    piece(ctx, {
      outline,
      at: ID,
      fill: css(colour),
      shadow,
      edge: 0.6,
      paint: (lc) => {
        line(lc, pts.map(([x, y], i) => [x - (w0 + (w1 - w0) * (i / (pts.length - 1))) * 0.22, y]), Math.max(1, Math.min(w0, w1) * 0.3), lift(colour, 0.45), stripe);
        line(lc, pts.map(([x, y], i) => [x + (w0 + (w1 - w0) * (i / (pts.length - 1))) * 0.28, y]), Math.max(1, Math.min(w0, w1) * 0.3), shade(colour, 0.4), 0.3);
      },
    });
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Paper
  // ---------------------------------------------------------------------------------------------------------------------------------

  /** Fractal noise that tiles over a w by h tile: four samples blended across the tile. */
  function tiledNoise(n, x, y, w, h, scale, octaves) {
    const f = (px, py) => L.fbm(n, (px / w) * scale, (py / h) * scale, octaves);
    const u = x / w;
    const v = y / h;
    return f(x, y) * (1 - u) * (1 - v) + f(x - w, y) * u * (1 - v) + f(x, y - h) * (1 - u) * v + f(x - w, y - h) * u * v;
  }

  /** The paper's own grain, tiling without a seam: a faint cloud, fibres and specks, on nothing (for laying over the page). */
  function paperTile(ctx, w, h, seed, k = 1) {
    const r = L.rng(seed);
    const n = L.simplex(seed);
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = tiledNoise(n, x, y, w, h, 6, 4);
        const q = (y * w + x) * 4;
        if (v > 0) {
          img.data[q] = 120;
          img.data[q + 1] = 98;
          img.data[q + 2] = 70;
          img.data[q + 3] = L.clamp(v * 0.06 * k) * 255;
        } else {
          img.data[q] = 255;
          img.data[q + 1] = 252;
          img.data[q + 2] = 244;
          img.data[q + 3] = L.clamp(-v * 0.08 * k) * 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    const wrap = (draw) => {
      for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) {
        ctx.save();
        ctx.translate(dx, dy);
        draw();
        ctx.restore();
      }
    };
    ctx.lineCap = "round";
    for (let i = 0; i < 300; i++) {
      const x = r() * w;
      const y = r() * h;
      const a = r() * TAU;
      const len = 4 + Math.pow(r(), 2) * 22;
      const bend = r.gauss() * len * 0.12;
      const light = r() < 0.3;
      const alpha = (light ? r.range(0.08, 0.16) : r.range(0.04, 0.09)) * k;
      const width = r.range(0.45, 0.9);
      wrap(() => {
        ctx.beginPath();
        ctx.moveTo(x - (Math.cos(a) * len) / 2, y - (Math.sin(a) * len) / 2);
        ctx.quadraticCurveTo(x - Math.sin(a) * bend, y + Math.cos(a) * bend, x + (Math.cos(a) * len) / 2, y + (Math.sin(a) * len) / 2);
        ctx.strokeStyle = light ? `rgba(255,253,246,${alpha})` : `rgba(110,90,62,${alpha})`;
        ctx.lineWidth = width;
        ctx.stroke();
      });
    }
    for (let i = 0; i < 160; i++) {
      const x = r() * w;
      const y = r() * h;
      const rad = 0.4 + Math.pow(r(), 4) * 1.6;
      const alpha = r.range(0.08, 0.3) * k;
      wrap(() => {
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, TAU);
        ctx.fillStyle = `rgba(96,76,52,${alpha})`;
        ctx.fill();
      });
    }
  }

  /** The cream sheet: warm, lighter toward the upper left, with broad soft mottling. */
  function paperGround(ctx, w, h, seed, { top = "#f6f1e6", bottom = "#ece3d0" } = {}) {
    const g = ctx.createLinearGradient(0, 0, w * 0.3, h);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const R = Math.hypot(w, h);
    const lg = ctx.createRadialGradient(w * 0.2, h * 0.1, 0, w * 0.2, h * 0.1, R * 0.8);
    lg.addColorStop(0, "rgba(255,252,243,0.5)");
    lg.addColorStop(1, "rgba(255,252,243,0)");
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, w, h);
    const sw = Math.ceil(w / 8);
    const sh = Math.ceil(h / 8);
    const m = L.canvas(sw, sh);
    const mc = m.getContext("2d");
    const img = mc.createImageData(sw, sh);
    const n = L.simplex(seed);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const v = L.fbm(n, (x / sw) * 3 * (w / h), (y / sh) * 3, 5);
        const q = (y * sw + x) * 4;
        img.data[q] = v > 0 ? 150 : 255;
        img.data[q + 1] = v > 0 ? 126 : 253;
        img.data[q + 2] = v > 0 ? 92 : 246;
        img.data[q + 3] = L.clamp(Math.abs(v) * (v > 0 ? 0.045 : 0.07)) * 255;
      }
    }
    mc.putImageData(img, 0, 0);
    ctx.save();
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(m, 0, 0, w, h);
    ctx.restore();
  }

  /** The paper over everything (fibres, specks and grain), so leaves and pots are painted on the same sheet. */
  function paperFinish(ctx, w, h, seed, { grain = 4, fibres = 0.8 } = {}) {
    const tile = L.canvas(512, 512);
    paperTile(tile.getContext("2d"), 512, 512, seed, fibres);
    ctx.save();
    const pat = ctx.createPattern(tile, "repeat");
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, w, h);
    const pat2 = ctx.createPattern(tile, "repeat");
    pat2.setTransform(new DOMMatrix().rotate(37).scale(1.43));
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = pat2;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    if (grain) L.grain(ctx, w, h, seed + 1, grain);
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Light oak
  // ---------------------------------------------------------------------------------------------------------------------------------

  /** Oak's grain over `box`: a warm gradient, long wavering lines along the board and the odd darker one. */
  function oakPaint(r, box, { vertical = false, tone = 0 } = {}) {
    return (lc) => {
      const [x0, y0, x1, y1] = box;
      const base = tone >= 0 ? lift(OAK.base, tone) : shade(OAK.base, -tone);
      const g = vertical ? lc.createLinearGradient(x0, 0, x1, 0) : lc.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, css(lift(base, 0.14)));
      g.addColorStop(1, css(mixc(base, OAK.dark, 0.35)));
      lc.fillStyle = g;
      lc.fillRect(x0, y0, x1 - x0, y1 - y0);
      const long = vertical ? y1 - y0 : x1 - x0;
      const across = vertical ? x1 - x0 : y1 - y0;
      const n = Math.max(6, Math.round(across / (5 * STYLE.unit)));
      const ph = r() * 100;
      for (let i = 0; i < n; i++) {
        const c = (i + r()) / n;
        const pts = [];
        const steps = Math.max(8, Math.round(long / (14 * STYLE.unit)));
        for (let k = 0; k <= steps; k++) {
          const a = k / steps;
          const off = (NOISE(a * long * 0.004 + ph, c * 3 + ph) * 0.6 + NOISE(a * long * 0.012 + ph, c * 9) * 0.15) * across * 0.06;
          pts.push(vertical ? [x0 + c * across + off, y0 + a * long] : [x0 + a * long, y0 + c * across + off]);
        }
        const dark = r() < 0.75;
        line(lc, pts, r.range(0.5, 1.6) * STYLE.unit, dark ? OAK.dark : OAK.light, dark ? r.range(0.12, 0.3) : r.range(0.2, 0.4));
      }
      overlay(lc, tex().streak, box, 0.25, r);
    };
  }

  /** A board: a rectangle of oak with a paper-cut shadow. */
  function board(ctx, x0, y0, x1, y1, r, { vertical = false, tone = 0, shadow = shadowFor(0.8, 0.26) } = {}) {
    piece(ctx, { outline: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], at: ID, fill: css(OAK.base), paint: oakPaint(r, [x0, y0, x1, y1], { vertical, tone }), shadow, edge: 0.8 });
  }

  /** A round oak plant stand on three splayed legs; gives the height its top is at, for the pot to stand on. */
  function oakStand(ctx, x, floor, w, h, seed) {
    const r = L.rng(seed + 77);
    const topY = floor - h;
    const th = w * 0.07;
    const rx = w / 2;
    const ry = rx * EYE;
    const leg = (xa, xb, tone, wd) => {
      const pts = [[xa - wd / 2, topY + th * 0.6], [xa + wd / 2, topY + th * 0.6], [xb + wd * 0.3, floor], [xb - wd * 0.3, floor]];
      piece(ctx, { outline: pts, at: ID, fill: css(OAK.base), paint: oakPaint(r, [Math.min(xa, xb) - wd, topY, Math.max(xa, xb) + wd, floor], { vertical: true, tone }), shadow: shadowFor(0.7, 0.24), edge: 0.6 });
    };
    leg(x + rx * 0.05, x + rx * 0.1, -0.35, w * 0.07);
    // A ring between the legs, low down.
    const ringY = floor - h * 0.3;
    piece(ctx, { outline: [...ellipsePts(x, ringY, rx * 0.86, ry * 0.86, 0, 60)], holes: [ellipsePts(x, ringY, rx * 0.8, ry * 0.7, 0, 60)], at: ID, fill: css(shade(OAK.base, 0.1)), shadow: shadowFor(0.5, 0.2), edge: 0.5 });
    leg(x - rx * 0.62, x - rx * 0.92, 0, w * 0.075);
    leg(x + rx * 0.62, x + rx * 0.92, -0.1, w * 0.075);
    const front = [];
    for (let i = 0; i <= 40; i++) {
      const a = Math.PI - (i / 40) * Math.PI;
      front.push([x + Math.cos(a) * rx, topY + Math.sin(a) * ry]);
    }
    const band = [...front, ...front.map(([px, py]) => [px, py + th]).reverse()];
    piece(ctx, { outline: band, at: ID, fill: css(OAK.base), paint: oakPaint(r, [x - rx, topY, x + rx, topY + ry + th]), shadow: shadowFor(0.8, 0.26), edge: 0.8 });
    const topFace = ellipsePts(x, topY, rx, ry, 0, 80);
    piece(ctx, { outline: topFace, at: ID, fill: css(OAK.light), paint: oakPaint(r, [x - rx, topY - ry, x + rx, topY + ry], { tone: 0.3 }), shadow: null, edge: 0.6 });
    return topY + ry * 0.35;
  }

  /** A low oak bench: its top board, seen a little from above, on four legs. */
  function bench(ctx, x0, x1, topY, floor, seed) {
    const r = L.rng(seed);
    const W = x1 - x0;
    const d = (floor - topY) * 0.16;
    const t = (floor - topY) * 0.13;
    const lw = W * 0.032;
    for (const lx of [x0 + W * 0.09, x1 - W * 0.09 - lw]) board(ctx, lx + W * 0.02, topY - d * 0.3, lx + W * 0.02 + lw * 0.9, floor - d * 0.6, r, { vertical: true, tone: -0.35, shadow: shadowFor(0.5, 0.2) });
    // A rail between the back legs.
    board(ctx, x0 + W * 0.1, topY + t * 1.6, x1 - W * 0.1, topY + t * 2.2, r, { tone: -0.3, shadow: shadowFor(0.5, 0.2) });
    for (const lx of [x0 + W * 0.06, x1 - W * 0.06 - lw]) board(ctx, lx, topY, lx + lw, floor, r, { vertical: true, tone: -0.05 });
    board(ctx, x0, topY - d, x1, topY, r, { tone: 0.25, shadow: null });
    board(ctx, x0, topY, x1, topY + t, r, { tone: -0.08 });
  }

  /** An oak floor from `y0` down, its boards running across and closer together toward the wall. */
  function oakFloor(ctx, w, h, y0, seed, { boards = 7 } = {}) {
    const r = L.rng(seed);
    oakPaint(r, [0, y0, w, h], { tone: 0.12 })(ctx);
    for (let k = 1; k <= boards; k++) {
      const y = y0 + (h - y0) * Math.pow(k / boards, 1.35);
      const yp = y0 + (h - y0) * Math.pow((k - 1) / boards, 1.35);
      line(ctx, [[0, y], [w, y]], 1.6 * STYLE.unit, shade(OAK.dark, 0.3), 0.45);
      line(ctx, [[0, y + 1.6 * STYLE.unit], [w, y + 1.6 * STYLE.unit]], 1 * STYLE.unit, OAK.light, 0.5);
      // Butt joints, staggered.
      for (let j = 0; j < 3; j++) {
        const x = (r() * 0.8 + 0.1) * w;
        line(ctx, [[x, yp], [x, y]], 1.4 * STYLE.unit, shade(OAK.dark, 0.3), 0.4);
      }
    }
    // Where the floor meets the wall: a soft shadow line.
    const g = ctx.createLinearGradient(0, y0, 0, y0 + (h - y0) * 0.12);
    g.addColorStop(0, "rgba(60,40,20,0.25)");
    g.addColorStop(1, "rgba(60,40,20,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, y0, w, (h - y0) * 0.12);
    line(ctx, [[0, y0], [w, y0]], 2 * STYLE.unit, shade(OAK.dark, 0.4), 0.45);
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Pots
  // ---------------------------------------------------------------------------------------------------------------------------------

  const GLAZES = {
    terracotta: { base: TERRA.base, light: TERRA.light, dark: TERRA.dark, kind: "clay" },
    cream: { base: hex("#ebe1cb"), light: hex("#f9f4e7"), dark: hex("#b3a382"), kind: "glaze", foot: hex("#d2b089") },
    sage: { base: hex("#9cb093"), light: hex("#c6d3b9"), dark: hex("#62765f"), kind: "glaze", foot: hex("#cfae86") },
    basket: { base: hex("#c49d66"), light: hex("#e3c592"), dark: hex("#7f5d36"), kind: "weave" },
  };

  /** Half-width along the height (v from the rim, 0, to the base, 1), as a share of the pot's width. */
  const SHAPES = {
    tapered: { h: 0.9, rim: 0.19, prof: (v) => (v <= 0.19 ? 0.5 : L.mix(0.455, 0.37, (v - 0.19) / 0.81)) },
    cylinder: { h: 0.84, prof: (v) => 0.5 - 0.025 * v - 0.03 * L.smooth(0.9, 1, v) },
    bowl: { h: 0.55, prof: (v) => 0.5 * (0.62 + 0.38 * Math.sqrt(Math.max(0, 1 - Math.pow(v, 2.3)))) },
    belly: { h: 0.86, prof: (v) => 0.5 * (0.84 + 0.17 * Math.sin(Math.PI * Math.min(1, v * 1.08)) - 0.1 * Math.pow(v, 3)) },
    basket: { h: 0.8, prof: (v) => 0.5 - 0.06 * v },
  };
  const EYE = 0.17;

  function potGeom(shape, glaze, x, floor, w) {
    const S = SHAPES[shape];
    const H = S.h * w;
    const rx = S.prof(0) * w;
    const rb = S.prof(1) * w;
    const bottom = floor - rb * EYE;
    const top = bottom - H;
    const t = w * 0.034;
    const rxi = rx - t;
    const at = (v) => [top + v * H, S.prof(v) * w];
    const vs = [];
    for (let i = 0; i <= 60; i++) vs.push(i / 60);
    if (S.rim) vs.push(S.rim, S.rim + 0.0001);
    vs.sort((a, b) => a - b);
    const body = [];
    for (let i = 0; i <= 32; i++) {
      const a = Math.PI - (i / 32) * Math.PI;
      body.push([x + Math.cos(a) * rx, top + Math.sin(a) * rx * EYE]);
    }
    for (const v of vs) {
      const [y, hw] = at(v);
      body.push([x + hw, y]);
    }
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI;
      body.push([x + Math.cos(a) * rb, bottom + Math.sin(a) * rb * EYE]);
    }
    for (const v of [...vs].reverse()) {
      const [y, hw] = at(v);
      body.push([x - hw, y]);
    }
    return { shape, S, glaze: GLAZES[glaze], x, floor, w, H, top, bottom, rx, ry: rx * EYE, rxi, ryi: rxi * EYE, body, soil: [x, top + rxi * EYE * 0.45] };
  }

  /** An arc across the pot at height v, front half (left to right), for rows, rims and glaze lines. */
  function potArc(g, v, n = 40, dy = 0) {
    const y = g.top + v * g.H + dy;
    const hw = g.S.prof(v) * g.w;
    return Array.from({ length: n + 1 }, (_, i) => {
      const a = Math.PI - (i / n) * Math.PI;
      return [g.x + Math.cos(a) * hw, y + Math.sin(a) * hw * EYE];
    });
  }

  /** Under the pot: a broad soft shadow thrown to the right and a dark line where it stands. */
  function floorShadow(ctx, x, floor, w, k = 1) {
    ctx.save();
    for (const [cx, rx, ry, a] of [
      [x + w * 0.2, w * 0.95, w * 0.13, 0.13],
      [x + w * 0.08, w * 0.62, w * 0.075, 0.2],
      [x + w * 0.02, w * 0.46, w * 0.028, 0.32],
    ]) {
      ctx.save();
      ctx.translate(cx, floor);
      ctx.scale(1, ry / rx);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      g.addColorStop(0, `rgba(58,44,28,${a * k})`);
      g.addColorStop(0.55, `rgba(58,44,28,${a * k * 0.45})`);
      g.addColorStop(1, "rgba(58,44,28,0)");
      ctx.fillStyle = g;
      ctx.fillRect(-rx, -rx, rx * 2, rx * 2);
      ctx.restore();
    }
    ctx.restore();
  }

  /** The pot's mouth: the rim's top face, the inside and the soil (drawn before the plant). */
  function potBack(ctx, g, seed) {
    const { x, top, rx, ry, rxi, ryi, glaze } = g;
    const r = L.rng(seed);
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x, top, rx, ry, 0, 0, TAU);
    ctx.fillStyle = css(glaze.kind === "weave" ? glaze.light : lift(glaze.base, 0.18));
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x, top, rxi, ryi, 0, 0, TAU);
    const inner = ctx.createLinearGradient(x - rxi, 0, x + rxi, 0);
    inner.addColorStop(0, css(shade(glaze.dark, 0.35)));
    inner.addColorStop(1, css(glaze.dark));
    ctx.fillStyle = inner;
    ctx.fill();
    ctx.clip();
    const sy = top + ryi * 0.5;
    ctx.beginPath();
    ctx.ellipse(x, sy, rxi * 0.99, ryi * 0.92, 0, 0, TAU);
    ctx.fillStyle = css(SOIL);
    ctx.fill();
    for (let i = 0; i < 260; i++) {
      const a = r() * TAU;
      const d = Math.sqrt(r());
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * d * rxi, sy + Math.sin(a) * d * ryi, r.range(0.6, 2.2) * STYLE.unit, 0, TAU);
      ctx.fillStyle = r() < 0.5 ? "rgba(30,22,15,0.6)" : "rgba(130,104,78,0.45)";
      ctx.fill();
    }
    const sh = ctx.createLinearGradient(0, top - ryi, 0, top + ryi);
    sh.addColorStop(0, "rgba(15,10,6,0.55)");
    sh.addColorStop(0.6, "rgba(15,10,6,0)");
    ctx.fillStyle = sh;
    ctx.fillRect(x - rxi, top - ryi, rxi * 2, ryi * 2);
    ctx.restore();
  }

  function clayPaint(g, r) {
    return (lc) => {
      const { x, w, top, H, glaze } = g;
      const box = [x - w * 0.55, top - g.ry, x + w * 0.55, g.floor + 4];
      const cg = lc.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
      cg.addColorStop(0, css(shade(glaze.dark, 0.1)));
      cg.addColorStop(0.12, css(glaze.base));
      cg.addColorStop(0.3, css(glaze.light));
      cg.addColorStop(0.5, css(mixc(glaze.base, glaze.light, 0.3)));
      cg.addColorStop(0.8, css(mixc(glaze.base, glaze.dark, 0.5)));
      cg.addColorStop(1, css(shade(glaze.dark, 0.2)));
      lc.fillStyle = cg;
      lc.fillRect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
      overlay(lc, tex().mottle, box, 0.4, r);
      // Thrown rings, faint.
      for (let v = 0.04; v < 1; v += r.range(0.025, 0.05)) line(lc, potArc(g, v), r.range(0.6, 1.4) * STYLE.unit, r() < 0.5 ? glaze.dark : glaze.light, r.range(0.05, 0.12));
      if (g.S.rim) {
        const band = [...potArc(g, 0, 40, -g.ry * 1.2), ...potArc(g, g.S.rim).reverse()];
        path(lc, band);
        lc.fillStyle = css(lift(glaze.base, 0.12), 0.35);
        lc.fill();
        const shadowBand = potArc(g, g.S.rim, 40, H * 0.03);
        line(lc, shadowBand, H * 0.06, shade(glaze.dark, 0.3), 0.35);
        line(lc, potArc(g, g.S.rim, 40, H * 0.012), H * 0.018, shade(glaze.dark, 0.4), 0.4);
        line(lc, potArc(g, g.S.rim, 40, -H * 0.006), H * 0.008, glaze.light, 0.6);
      }
      // A little white bloom from the water, near the base.
      for (let i = 0; i < 9; i++) {
        const v = r.range(0.6, 0.98);
        const px = x + r.range(-0.4, 0.4) * w;
        glow(lc, px, top + v * H, r.range(0.04, 0.1) * w, r.range(0.02, 0.05) * w, hex("#f3ead8"), r.range(0.1, 0.22));
      }
      for (let i = 0; i < 700; i++) {
        lc.beginPath();
        lc.arc(r.range(box[0], box[2]), r.range(box[1], box[3]), r.range(0.4, 1.5) * STYLE.unit, 0, TAU);
        lc.fillStyle = r() < 0.6 ? css(glaze.dark, r.range(0.15, 0.4)) : css(glaze.light, r.range(0.2, 0.5));
        lc.fill();
      }
      const bottomShade = lc.createLinearGradient(0, top + H * 0.75, 0, g.floor);
      bottomShade.addColorStop(0, "rgba(40,20,10,0)");
      bottomShade.addColorStop(1, "rgba(40,20,10,0.25)");
      lc.fillStyle = bottomShade;
      lc.fillRect(box[0], top + H * 0.75, box[2] - box[0], g.floor - top - H * 0.75 + 4);
    };
  }

  function glazePaint(g, r) {
    return (lc) => {
      const { x, w, top, H, glaze } = g;
      const box = [x - w * 0.55, top - g.ry, x + w * 0.55, g.floor + 4];
      const cg = lc.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
      cg.addColorStop(0, css(mixc(glaze.dark, glaze.base, 0.2)));
      cg.addColorStop(0.15, css(glaze.base));
      cg.addColorStop(0.32, css(glaze.light));
      cg.addColorStop(0.55, css(glaze.base));
      cg.addColorStop(0.85, css(mixc(glaze.base, glaze.dark, 0.55)));
      cg.addColorStop(1, css(glaze.dark));
      lc.fillStyle = cg;
      lc.fillRect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
      overlay(lc, tex().mottle, box, 0.18, r);
      // Shine: a tall soft streak toward the light, a sharper one inside it, and light thrown back on the far side.
      glow(lc, x - w * 0.24, top + H * 0.45, w * 0.06, H * 0.42, SUN, 0.5);
      glow(lc, x - w * 0.25, top + H * 0.38, w * 0.018, H * 0.28, [255, 255, 250], 0.65);
      glow(lc, x + w * 0.42, top + H * 0.55, w * 0.04, H * 0.35, lift(glaze.light, 0.3), 0.25);
      // The unglazed foot and the glaze's edge above it, with a drip or two.
      const footV = 0.88;
      const edge = potArc(g, footV, 60).map(([px, py], i) => [px, py + Math.sin(i * 0.9 + r() * 0.5) * H * 0.006 + (r() < 0.06 ? H * r.range(0.01, 0.03) : 0)]);
      const foot = [...edge, [x + w * 0.6, g.floor + 10], [x - w * 0.6, g.floor + 10]];
      path(lc, foot);
      lc.fillStyle = css(glaze.foot);
      lc.fill();
      for (let i = 0; i < 160; i++) {
        lc.beginPath();
        lc.arc(r.range(box[0], box[2]), r.range(top + H * footV, g.floor), r.range(0.4, 1.3) * STYLE.unit, 0, TAU);
        lc.fillStyle = css(shade(glaze.foot, 0.4), r.range(0.15, 0.4));
        lc.fill();
      }
      line(lc, edge, H * 0.012, shade(glaze.base, 0.25), 0.35);
      const fg = lc.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
      fg.addColorStop(0, "rgba(40,25,10,0.25)");
      fg.addColorStop(0.3, "rgba(255,250,235,0.1)");
      fg.addColorStop(1, "rgba(40,25,10,0.35)");
      path(lc, foot);
      lc.fillStyle = fg;
      lc.fill();
      // A thin lip of glaze at the rim.
      line(lc, potArc(g, 0, 40, H * 0.008), H * 0.012, glaze.light, 0.7);
    };
  }

  function weavePaint(g, r) {
    return (lc) => {
      const { x, w, top, H, glaze } = g;
      const box = [x - w * 0.55, top - g.ry * 1.5, x + w * 0.55, g.floor + 4];
      lc.fillStyle = css(mixc(glaze.dark, glaze.base, 0.25));
      lc.fillRect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
      const rows = 14;
      const count = 34;
      const straws = [glaze.base, mixc(glaze.base, glaze.light, 0.35), mixc(glaze.base, glaze.dark, 0.18), mixc(glaze.base, glaze.light, 0.6)];
      for (let k = 0; k < rows; k++) {
        const v = 0.07 + ((k + 0.5) / rows) * 0.93;
        const rowH = (H * 0.93) / rows;
        const hw = g.S.prof(v) * w;
        const yc = top + v * H;
        const off = (k % 2) * 0.5;
        for (let i = 0; i < count; i++) {
          const a = -Math.PI / 2 + ((i + off) / count) * Math.PI * 2;
          const c = Math.cos(a);
          if (Math.sin(a + Math.PI / 2) < 0) continue;
          const px = x + Math.sin(a) * hw;
          const py = yc + Math.cos(a) * hw * EYE;
          const sw = ((Math.PI * 2) / count) * hw * Math.max(0.05, c) * 0.92;
          if (sw < 1) continue;
          const sh = rowH * 0.86;
          const col = straws[Math.floor(r() * straws.length)];
          lc.save();
          lc.translate(px, py);
          lc.rotate((k % 2 ? 0.7 : -0.7) * Math.max(0.25, c));
          lc.beginPath();
          lc.ellipse(0, 0, sw * 0.78, sh * 0.44, 0, 0, TAU);
          const sg = lc.createLinearGradient(0, -sh / 2, 0, sh / 2);
          sg.addColorStop(0, css(lift(col, 0.25)));
          sg.addColorStop(0.5, css(col));
          sg.addColorStop(1, css(shade(col, 0.25)));
          lc.fillStyle = sg;
          lc.fill();
          lc.restore();
        }
      }
      // The rolled rim: a braid along the top.
      const rimArc = potArc(g, 0.035, 80);
      for (let i = 0; i < rimArc.length; i += 2) {
        const [px, py] = rimArc[i];
        lc.save();
        lc.translate(px, py);
        lc.rotate(0.7);
        lc.beginPath();
        lc.ellipse(0, 0, H * 0.035, H * 0.016, 0, 0, TAU);
        lc.fillStyle = css(r() < 0.5 ? glaze.light : glaze.base);
        lc.fill();
        lc.strokeStyle = css(glaze.dark, 0.35);
        lc.lineWidth = STYLE.unit;
        lc.stroke();
        lc.restore();
      }
      const cg = lc.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
      cg.addColorStop(0, "rgba(40,24,8,0.4)");
      cg.addColorStop(0.25, "rgba(255,245,220,0.12)");
      cg.addColorStop(0.5, "rgba(40,24,8,0)");
      cg.addColorStop(1, "rgba(40,24,8,0.48)");
      lc.fillStyle = cg;
      lc.fillRect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
    };
  }

  /** The pot's body and the front of its rim (drawn after the plant's back, before what hangs over the front). */
  function potFront(ctx, g, seed) {
    const r = L.rng(seed + 3);
    const kind = g.glaze.kind;
    const paint = kind === "clay" ? clayPaint(g, r) : kind === "glaze" ? glazePaint(g, r) : weavePaint(g, r);
    piece(ctx, { outline: g.body, at: ID, fill: css(g.glaze.base), paint, shadow: shadowFor(1, 0.22), edge: 0.8 });
    // The rim's top face in front of the soil.
    const outer = [];
    const inner = [];
    for (let i = 0; i <= 40; i++) {
      const a = Math.PI - (i / 40) * Math.PI;
      outer.push([g.x + Math.cos(a) * g.rx, g.top + Math.sin(a) * g.ry]);
      inner.push([g.x + Math.cos(a) * g.rxi, g.top + Math.sin(a) * g.ryi]);
    }
    path(ctx, [...outer, ...inner.reverse()]);
    const rg = ctx.createLinearGradient(g.x - g.rx, 0, g.x + g.rx, 0);
    const top = kind === "weave" ? g.glaze.light : lift(g.glaze.base, 0.2);
    rg.addColorStop(0, css(top));
    rg.addColorStop(0.4, css(lift(top, 0.25)));
    rg.addColorStop(1, css(shade(top, 0.15)));
    ctx.fillStyle = rg;
    ctx.fill();
  }

  /** A plant in its pot: the floor shadow, the pot's mouth, the plant's back, the pot, then what hangs in front. */
  function potted(ctx, { shape, glaze, x, floor, w, plant, seed, shadow = 1 }) {
    const g = potGeom(shape, glaze, x, floor, w);
    if (shadow) floorShadow(ctx, x, floor, w, shadow);
    potBack(ctx, g, seed);
    const items = plant(g);
    for (const it of items) if (!it.front) it.draw(ctx);
    potFront(ctx, g, seed);
    for (const it of items) if (it.front) it.draw(ctx);
    return g;
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Plants: each takes its pot (`g.soil` is where it grows from) and a height, and gives what to draw, behind the pot's front or before it
  // ---------------------------------------------------------------------------------------------------------------------------------

  const dirOf = (rot) => [Math.sin(rot), -Math.cos(rot)];

  function monsteraPlant(H, seed, { leaves = 7, spread = 1, colour = G.deep, reach = 1 } = {}) {
    return (g) => {
      const r = L.rng(seed);
      const [bx, by] = g.soil;
      const items = [];
      const SLOTS = { 7: [-56, -34, -12, 6, 24, 44, 62], 8: [-60, -40, -22, -6, 10, 28, 46, 64], 9: [-62, -44, -26, -10, 4, 18, 34, 50, 66] };
      const slots = SLOTS[leaves] ?? SLOTS[8];
      const order = slots.map((a, i) => ({ a: (a + r.gauss() * 6) * spread * DEG, i, z: Math.abs(a) < 30 ? r() : 1 + r() }));
      order.sort((p, q) => p.z - q.z);
      for (const { a, i } of order) {
        const up = Math.cos(a);
        const pl = H * (0.3 + 0.32 * up) * r.range(0.85, 1.1) * reach;
        const ll = H * r.range(0.36, 0.46) * (0.85 + 0.15 * up);
        const base = [bx + r.gauss() * g.w * 0.03, by];
        const end = [base[0] + Math.sin(a) * pl, base[1] - Math.cos(a) * pl];
        const rot = a * 1.35 + Math.sign(a || 1) * r.range(0.05, 0.25);
        const [dx, dy] = dirOf(rot);
        const pts = cubic(base, [base[0] + Math.sin(a) * pl * 0.15, base[1] - pl * 0.5], [end[0] - dx * pl * 0.3, end[1] - dy * pl * 0.3], end, 30);
        const flip = r() < 0.5 ? -1 : 1;
        const leaf = monstera(seed * 31 + i, { cut: r.range(0.75, 1), bend: r.gauss() * 0.07, turn: r.gauss() * 0.12, colour: mixc(colour, G.mid, r.range(0, 0.35)) });
        const front = Math.abs(a) > 55 * DEG;
        items.push({
          front,
          draw: (ctx) => {
            stalk(ctx, pts, H * 0.024, H * 0.013, mixc(G.mid, G.fresh, 0.35));
            piece(ctx, { ...leaf, at: { x: end[0], y: end[1], rot, s: ll, sx: flip * r.range(0.72, 1) } });
          },
        });
      }
      // A new leaf unrolling at the centre.
      items.splice(Math.floor(items.length / 2), 0, {
        front: false,
        draw: (ctx) => {
          const tip = [bx + H * 0.03, by - H * 0.62];
          const pts = cubic([bx, by], [bx, by - H * 0.3], [tip[0] - H * 0.02, tip[1] + H * 0.12], tip, 30);
          stalk(ctx, pts, H * 0.02, H * 0.006, mixc(G.fresh, G.light, 0.4), { prof: (t) => (t < 0.55 ? 1 - t * 0.6 : 1.4 - t * 1.3) });
        },
      });
      return items;
    };
  }

  function fiddlePlant(H, seed, { leaves = 22 } = {}) {
    return (g) => {
      const r = L.rng(seed);
      const [bx, by] = g.soil;
      const items = [];
      const th = H * 0.6;
      const lean = r.gauss() * 0.04 * H;
      const trunk = cubic([bx, by], [bx - lean * 0.5, by - th * 0.35], [bx + lean, by - th * 0.7], [bx + lean * 0.6, by - th], 40);
      items.push({ z: 1, front: false, draw: (ctx) => stalk(ctx, trunk, H * 0.04, H * 0.016, BARK, { stripe: 0.25 }) });
      for (let j = 0; j < leaves; j++) {
        const t = j < leaves - 4 ? L.mix(0.2, 0.92, j / (leaves - 5)) : 0.96 + (j - leaves + 4) * 0.012;
        const k = Math.round(t * (trunk.length - 1));
        const at = trunk[Math.min(trunk.length - 1, k)];
        const sideSign = j % 2 ? 1 : -1;
        const top = j >= leaves - 4;
        const ang = sideSign * (top ? r.range(5, 32) : L.mix(100, 30, t) + r.gauss() * 16) * DEG;
        const facing = r() < 0.35;
        const ll = H * (top ? r.range(0.17, 0.22) : r.range(0.23, 0.3)) * (facing ? 1.08 : 1);
        const [dx, dy] = dirOf(ang);
        const base = [at[0] + dx * H * 0.025, at[1] + dy * H * 0.025];
        const leaf = fiddle(seed * 17 + j, { bend: sideSign * r.range(-0.03, 0.1), turn: r.gauss() * 0.14, colour: top ? mixc(G.mid, G.fresh, 0.5) : mixc(G.deep, G.mid, r.range(0, 0.5)) });
        const sx = sideSign * (facing ? r.range(0.88, 1) : r.range(0.5, 0.82)) * (r() < 0.3 ? -1 : 1);
        items.push({
          z: facing ? 2.5 : j % 3 === 0 ? 0 : 2,
          front: false,
          draw: (ctx) => {
            line(ctx, [at, base], H * 0.008, BARK, 1);
            piece(ctx, { ...leaf, at: { x: base[0], y: base[1], rot: ang, s: ll, sx } });
          },
        });
      }
      items.sort((p, q) => p.z - q.z);
      return items;
    };
  }

  function bopPlant(H, seed, { leaves = 9 } = {}) {
    return (g) => {
      const r = L.rng(seed);
      const [bx, by] = g.soil;
      const items = [];
      const list = [];
      for (let i = 0; i < leaves; i++) {
        const a = (L.mix(-38, 38, i / (leaves - 1)) + r.gauss() * 5) * DEG;
        list.push({ a, i, z: r() + (Math.abs(a) > 25 * DEG ? 0.6 : 0) });
      }
      list.sort((p, q) => p.z - q.z);
      for (const { a, i } of list) {
        const up = Math.cos(a * 1.6);
        const pl = H * r.range(0.3, 0.42) * (0.7 + 0.3 * up);
        const bl = H * r.range(0.44, 0.54);
        const base = [bx + Math.sin(a) * g.w * 0.08, by];
        const end = [base[0] + Math.sin(a * 0.75) * pl, base[1] - Math.cos(a * 0.75) * pl];
        const rot = a * 1.2 + r.gauss() * 0.08;
        const [dx, dy] = dirOf(rot);
        const pts = cubic(base, [base[0], base[1] - pl * 0.4], [end[0] - dx * pl * 0.3, end[1] - dy * pl * 0.3], end, 30);
        const leaf = paddle(seed * 13 + i, { tears: 4, width: 0.215, bend: r.gauss() * 0.04, turn: r.gauss() * 0.15, colour: mixc(BOP, G.mid, r.range(0, 0.4)) });
        const sx = r.range(0.6, 1) * (r() < 0.5 ? -1 : 1);
        items.push({
          front: false,
          draw: (ctx) => {
            stalk(ctx, pts, H * 0.02, H * 0.012, mixc(BOP, G.fresh, 0.3));
            piece(ctx, { ...leaf, at: { x: end[0], y: end[1], rot, s: bl, sx } });
          },
        });
      }
      // The sheaths where the stalks leave the soil.
      items.push({
        front: false,
        draw: (ctx) => {
          const rr = L.rng(seed + 9);
          for (let k = 0; k < 6; k++) {
            const a = (k - 2.5) * 0.22 + rr.gauss() * 0.05;
            const len = H * rr.range(0.07, 0.11);
            const pts = cubic([bx + (k - 2.5) * g.w * 0.03, by + 4], [bx + (k - 2.5) * g.w * 0.035, by - len * 0.4], [bx + Math.sin(a) * len * 0.6, by - len * 0.75], [bx + Math.sin(a) * len, by - len], 20);
            stalk(ctx, pts, H * 0.034, H * 0.012, mixc(hex("#55663f"), BOP, rr.range(0.3, 0.7)), { shadow: shadowFor(0.4), stripe: 0.1 });
          }
        },
      });
      return items;
    };
  }

  function snakePlant(H, seed, { leaves = 7 } = {}) {
    return (g) => {
      const r = L.rng(seed);
      const [bx, by] = g.soil;
      const list = [];
      for (let i = 0; i < leaves; i++) {
        const u = i / (leaves - 1) - 0.5;
        const hl = H * (1 - Math.abs(u) * 0.55) * r.range(0.72, 1);
        list.push({ u, hl, i });
      }
      list.sort((p, q) => q.hl - p.hl);
      return list.map(({ u, hl, i }, k) => {
        const leaf = sword(seed * 7 + i, { width: r.range(0.078, 0.1), turn: r.gauss() * 0.15, bend: r.gauss() * 0.03 });
        const x = bx + u * g.rxi * 1.2 + r.gauss() * g.w * 0.02;
        const rot = (u * 26 + r.gauss() * 4) * DEG;
        const sx = r.range(0.62, 1) * (r() < 0.5 ? -1 : 1);
        return { front: k >= leaves - 2 && hl < H * 0.6, draw: (ctx) => piece(ctx, { ...leaf, at: { x, y: by + H * 0.01, rot, s: hl, sx } }) };
      });
    };
  }

  function zzPlant(H, seed, { stems = 8 } = {}) {
    return (g) => {
      const r = L.rng(seed);
      const [bx, by] = g.soil;
      const list = [];
      for (let i = 0; i < stems; i++) {
        const a = (L.mix(-52, 52, i / (stems - 1)) + r.gauss() * 6) * DEG;
        list.push({ a, i, z: Math.abs(a) + r.gauss() * 0.2 });
      }
      list.sort((p, q) => p.z - q.z);
      return list.map(({ a, i }) => {
        const len = H * r.range(0.8, 1.0) * (1 - 0.28 * Math.abs(a) / (52 * DEG));
        const a0 = a * 0.5;
        const a1 = a * 1.3;
        const pts = [];
        let px = bx + Math.sin(a) * g.w * 0.06;
        let py = by;
        const N = 40;
        for (let k = 0; k <= N; k++) {
          pts.push([px, py]);
          const ang = L.mix(a0, a1, Math.pow(k / N, 1.4));
          px += Math.sin(ang) * (len / N);
          py -= Math.cos(ang) * (len / N);
        }
        const leaflets = [];
        const pairs = 6;
        for (let j = 0; j < pairs; j++) {
          const s = L.mix(0.3, 0.9, j / (pairs - 1)) + r.gauss() * 0.015;
          const k = Math.round(s * N);
          const p0 = pts[k];
          const p1 = pts[Math.min(N, k + 1)];
          const tang = Math.atan2(p1[0] - p0[0], -(p1[1] - p0[1]));
          for (const sd of [-1, 1]) {
            leaflets.push({
              at: [p0[0] + sd * H * 0.004, p0[1]],
              rot: tang + sd * r.range(32, 62) * DEG,
              s: len * L.mix(0.23, 0.17, s) * r.range(0.88, 1.1),
              sx: r.range(0.6, 1) * sd,
              seed: seed * 101 + i * 20 + j * 2 + (sd > 0 ? 1 : 0),
            });
          }
        }
        const tipA = Math.atan2(pts[N][0] - pts[N - 1][0], -(pts[N][1] - pts[N - 1][1]));
        leaflets.push({ at: pts[N], rot: tipA, s: len * 0.16, sx: 0.8, seed: seed * 101 + i * 20 + 19 });
        return {
          front: false,
          draw: (ctx) => {
            stalk(ctx, pts, H * 0.026, H * 0.007, mixc(G.mid, G.fresh, 0.3), { prof: (t) => (1.3 - 1.05 * Math.pow(t, 0.6)) * (1 + 0.5 * Math.exp(-((t / 0.06) ** 2))) });
            for (const lf of leaflets) {
              const leaf = zzLeaflet(lf.seed, { bend: r.gauss() * 0.04, turn: r.gauss() * 0.1, colour: mixc(G.deep, G.mid, r.range(0, 0.4)) });
              piece(ctx, { ...leaf, at: { x: lf.at[0], y: lf.at[1], rot: lf.rot, s: lf.s, sx: lf.sx }, shadow: shadowFor(0.7) });
            }
          },
        };
      });
    };
  }

  /** A pilea: round leaves on long thin stalks radiating from a short stem, worked out in 3D and seen from a little above. */
  function pileaPlant(H, seed, { leaves = 22 } = {}) {
    return (g) => {
      const r = L.rng(seed);
      const [bx, by] = g.soil;
      const ce = 0.32;
      const proj = ([X, Y, Z]) => [bx + X * H, by + (-Y * Math.cos(ce) + Z * Math.sin(ce)) * H];
      const depthOf = ([, Y, Z]) => Y * Math.sin(ce) + Z * Math.cos(ce);
      const V = [0, Math.sin(ce), Math.cos(ce)];
      const norm = (v) => {
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        return [v[0] / l, v[1] / l, v[2] / l];
      };
      const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const stemTop = 0.32;
      const list = [];
      for (let i = 0; i < leaves; i++) {
        const phi = i * 2.39996 + r.gauss() * 0.2;
        const young = i > leaves - 6;
        const el = (young ? r.range(50, 72) : r.range(-12, 52)) * DEG;
        const sy = stemTop * r.range(young ? 0.92 : 0.45, 1);
        const S = [0, sy, 0];
        const lp = young ? r.range(0.08, 0.18) : r.range(0.16, 0.34);
        const d = [Math.cos(el) * Math.sin(phi), Math.sin(el), Math.cos(el) * Math.cos(phi)];
        const rad = young ? r.range(0.05, 0.075) : r.range(0.08, 0.12);
        const C = [S[0] + d[0] * (lp + rad), S[1] + d[1] * (lp + rad) - 0.04, S[2] + d[2] * (lp + rad)];
        let N = norm([d[0] * 0.8, d[1] * 0.6 + 0.45, d[2] * 0.8 + 0.45]);
        if (Math.abs(dot(N, V)) < 0.4) N = norm([N[0], N[1] + V[1] * 0.5, N[2] + V[2] * 0.5]);
        let A = cross(N, V);
        if (Math.hypot(A[0], A[1], A[2]) < 1e-3) A = [1, 0, 0];
        A = norm(A);
        const B = cross(N, A);
        const toS = [S[0] - C[0], S[1] - C[1], S[2] - C[2]];
        const ka = dot(toS, A);
        const kb = dot(toS, B);
        const kl = Math.hypot(ka, kb) || 1;
        const attach = [(ka / kl) * 0.32, (kb / kl) * 0.32];
        const P = [C[0] + (A[0] * attach[0] + B[0] * attach[1]) * rad, C[1] + (A[1] * attach[0] + B[1] * attach[1]) * rad, C[2] + (A[2] * attach[0] + B[2] * attach[1]) * rad];
        const c2 = proj(C);
        const pa = proj([C[0] + A[0] * rad, C[1] + A[1] * rad, C[2] + A[2] * rad]);
        const pb = proj([C[0] + B[0] * rad, C[1] + B[1] * rad, C[2] + B[2] * rad]);
        const m = [pa[0] - c2[0], pa[1] - c2[1], pb[0] - c2[0], pb[1] - c2[1], c2[0], c2[1]];
        const back = dot(N, V) < 0;
        list.push({ m, back, attach, S2: proj(S), P2: proj(P), depth: depthOf(C), seed: seed * 53 + i, young });
      }
      list.sort((p, q) => p.depth - q.depth);
      const stem = [proj([0, 0, 0]), proj([0, stemTop * 0.5, 0]), proj([0, stemTop, 0])];
      const items = [{ front: false, draw: (ctx) => stalk(ctx, stem, H * 0.022, H * 0.014, mixc(G.fresh, BARK, 0.4)) }];
      for (const lf of list) {
        items.push({
          front: false,
          draw: (ctx) => {
            const mid = [(lf.S2[0] + lf.P2[0]) / 2, (lf.S2[1] + lf.P2[1]) / 2 + H * 0.03];
            const petiole = () => line(ctx, quad(lf.S2, mid, lf.P2, 20), H * 0.0065, mixc(G.fresh, G.light, 0.3), 1);
            if (!lf.back) petiole();
            const leaf = pileaLeaf(lf.seed, { attach: lf.attach, back: lf.back, colour: lf.young ? mixc(G.fresh, G.light, 0.4) : mixc(mixc(G.fresh, G.mid, r.range(0, 0.45)), G.light, r.range(0, 0.15)) });
            piece(ctx, { ...leaf, at: { m: lf.m }, shadow: shadowFor(0.6) });
            if (lf.back) petiole();
          },
        });
      }
      return items;
    };
  }

  /** A bird's-nest fern: a rosette of undivided wavy fronds, the back ones upright, the front ones arching over the rim. */
  function nestPlant(H, seed, { fronds = 18 } = {}) {
    return (g) => {
      const r = L.rng(seed);
      const [bx, by] = g.soil;
      const items = [];
      const make = (n, lo, hi, len, bendK, front, z0) => {
        for (let i = 0; i < n; i++) {
          const sgn = i % 2 ? 1 : -1;
          const a = sgn * r.range(lo, hi) * DEG;
          const fl = H * len * r.range(0.85, 1.08);
          const bend = Math.sign(a || 1) * bendK * r.range(0.7, 1.2);
          const leaf = nestFrond(seed * 19 + items.length, { width: r.range(0.085, 0.11), bend, turn: r.gauss() * 0.12, colour: mixc(NEST, G.fresh, r.range(0, 0.5)) });
          const sx = r.range(0.75, 1) * (r() < 0.5 ? -1 : 1);
          items.push({ z: z0 + r() * 0.5, front, draw: (ctx) => piece(ctx, { ...leaf, at: { x: bx + Math.sin(a) * g.w * 0.05, y: by, rot: a, s: fl, sx } }) });
        }
      };
      make(Math.round(fronds * 0.35), 0, 26, 0.92, 0.08, false, 0);
      make(Math.round(fronds * 0.4), 28, 58, 0.9, 0.34, false, 1);
      make(fronds - Math.round(fronds * 0.35) - Math.round(fronds * 0.4), 60, 85, 0.66, 0.45, true, 2);
      items.sort((p, q) => p.z - q.z);
      items.splice(0, 0, {
        z: -1,
        front: false,
        draw: (ctx) => {
          // The brown, felted nest at the centre.
          const rr = L.rng(seed + 5);
          for (let k = 0; k < 40; k++) line(ctx, [[bx + rr.gauss() * g.w * 0.05, by + rr.gauss() * 4], [bx + rr.gauss() * g.w * 0.07, by - rr.range(0, H * 0.06)]], rr.range(1.5, 3.5) * STYLE.unit, hex("#5b4330"), 0.6);
        },
      });
      return items;
    };
  }

  /** A bead of a string of pearls: a little green sphere with its fine translucent line, its small point and a point of light. */
  function bead(lc, x, y, rad, colour, r, dir = Math.PI / 2) {
    const g = lc.createRadialGradient(x - rad * 0.35, y - rad * 0.4, rad * 0.05, x, y, rad);
    g.addColorStop(0, css(lift(colour, 0.45)));
    g.addColorStop(0.5, css(lift(colour, 0.08)));
    g.addColorStop(0.88, css(shade(colour, 0.22)));
    g.addColorStop(1, css(shade(colour, 0.4)));
    lc.beginPath();
    lc.arc(x, y, rad, 0, TAU);
    lc.fillStyle = g;
    lc.fill();
    // The window: a thin, slightly darker line along the bead.
    lc.beginPath();
    lc.ellipse(x + Math.cos(dir + 1.4) * rad * 0.2, y + Math.sin(dir + 1.4) * rad * 0.2, rad * 0.78, rad * 0.1, dir, 0, TAU);
    lc.fillStyle = css(shade(colour, 0.3), 0.28);
    lc.fill();
    // The little point at its end.
    lc.beginPath();
    lc.arc(x + Math.cos(dir) * rad * 0.92, y + Math.sin(dir) * rad * 0.92, rad * 0.16, 0, TAU);
    lc.fillStyle = css(shade(colour, 0.35), 0.7);
    lc.fill();
    lc.beginPath();
    lc.arc(x - rad * 0.36, y - rad * 0.4, rad * 0.16, 0, TAU);
    lc.fillStyle = "rgba(255,255,245,0.5)";
    lc.fill();
  }

  /**
   * A string of pearls: a heaped cushion of beads on the soil and strands spilling over the rim in clusters, hanging down (toward `floor`
   * when given, else `drop` times the plant's height).
   */
  function pearlsPlant(H, seed, { strands = 22, drop = 1, floor = null, bead: rb = null } = {}) {
    return (g) => {
      const r = L.rng(seed);
      const [bx, by] = g.soil;
      const R = rb ?? g.w * 0.019;
      const colour = mixc(G.fresh, G.light, 0.15);
      const stemC = hex("#6b7a45");
      const tint = () => mixc(colour, r() < 0.5 ? G.mid : G.light, r() * 0.3);
      const mound = (lc, front) => {
        const pts = [];
        for (let i = 0; i < 520; i++) {
          const a = r() * TAU;
          const d = Math.sqrt(r());
          const px = bx + Math.cos(a) * d * g.rxi * 1.02;
          const py = by + Math.sin(a) * d * g.ryi * 0.95 - (1 - d * d) * H * 0.06 - r() * R * 1.5;
          if (front !== Math.sin(a) > 0.15) continue;
          pts.push([px, py, R * r.range(0.8, 1.05)]);
        }
        pts.sort((p, q) => p[1] - q[1]);
        for (const [px, py, rr] of pts) bead(lc, px, py, rr, tint(), r, r() * TAU);
      };
      // Clusters along the rim, more of them toward the sides.
      const clusters = [-0.95, -0.78, -0.52, -0.2, 0.15, 0.45, 0.72, 0.93];
      const hang = (lc) => {
        for (let s = 0; s < strands; s++) {
          const u = L.clamp(clusters[s % clusters.length] + r.gauss() * 0.06, -0.99, 0.99);
          const x0 = g.x + u * g.rx * 0.97;
          const rimY = g.top + Math.sqrt(Math.max(0, 1 - u * u)) * g.ry;
          const avail = floor !== null ? floor - rimY - R * 3 : H * drop;
          const len = avail * r.range(0.25, 0.95) * (Math.abs(u) > 0.6 ? 1 : 0.75) * drop;
          const pts = [[bx + u * g.rxi * 0.6, by - R], [x0, rimY - R * 0.6]];
          let px = x0;
          let py = rimY;
          const ph = r() * TAU;
          const sway = r.range(0.15, 0.35);
          for (let d = 0; d < len; d += R * 0.6) {
            const v = L.clamp((py - g.top) / g.H);
            const hw = g.S.prof(v) * g.w;
            py += R * 0.6;
            px += Math.sin(d / (H * 0.08) + ph) * R * sway + u * R * 0.05;
            // Outer strands rest against the pot's side until they pass its widest point.
            if (Math.abs(u) > 0.75 && py < g.top + g.H) px = u > 0 ? Math.max(px, g.x + hw + R * 0.6) : Math.min(px, g.x - hw - R * 0.6);
            pts.push([px, py]);
          }
          const smooth = catmull(pts, 4, false);
          line(lc, smooth, Math.max(1, R * 0.18), stemC, 0.9);
          const beads = resample(smooth, R * 1.75, false);
          for (let k = 1; k < beads.length; k++) {
            const [qx, qy] = beads[k];
            const t = k / beads.length;
            const side = k % 2 ? 1 : -1;
            const [ax, ay] = beads[k - 1];
            const dir = Math.atan2(qy - ay, qx - ax) + side * 0.5;
            bead(lc, qx + side * R * 0.35, qy, R * (1 - t * 0.3) * r.range(0.9, 1.05), tint(), r, dir);
          }
        }
      };
      return [
        { front: false, draw: (ctx) => group(ctx, (lc) => mound(lc, false), { shadow: shadowFor(0.4) }) },
        {
          front: true,
          draw: (ctx) => group(ctx, (lc) => {
            mound(lc, true);
            hang(lc);
          }, { shadow: shadowFor(0.6) }),
        },
      ];
    };
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Fronds: a palm's and a fern's, each many leaflets on one midrib, drawn together and laid down with one shadow
  // ---------------------------------------------------------------------------------------------------------------------------------

  const angleTo = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

  /** A midrib from x, y heading `ang`, turning `curl` over its length: points with their heading. */
  function rachis(x, y, ang, len, curl, n = 60) {
    const pts = [];
    let a = ang;
    for (let i = 0; i <= n; i++) {
      pts.push([x, y, a]);
      x += (Math.cos(a) * len) / n;
      y += (Math.sin(a) * len) / n;
      a += curl / n;
    }
    return pts;
  }

  /** Bounds of a frond, generously, for its layer. */
  function frondBox(ctx, x, y, len) {
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    const m = len * 1.5;
    return [Math.max(-40, Math.floor(x - m)), Math.max(-40, Math.floor(y - m)), Math.min(W + 40, Math.ceil(x + m)), Math.min(H + 40, Math.ceil(y + m))];
  }

  function layered(ctx, box, draw, shadow, alpha = 1) {
    const [x0, y0, x1, y1] = box;
    if (x1 - x0 < 2 || y1 - y0 < 2) return;
    const layer = L.canvas(x1 - x0, y1 - y0);
    const lc = layer.getContext("2d");
    lc.translate(-x0, -y0);
    draw(lc);
    composite(ctx, layer, x0, y0, shadow, alpha);
  }

  /** A palm's frond (a kentia's): an arching midrib, long narrow leaflets drooping from both sides, each folded along its middle. */
  function palmFrond(ctx, seed, { x, y, ang, len, curl = 0.7, colour = G.mid, leaflets = 24, droop = 0.8, light = 1, shadow = shadowFor(), alpha = 1 }) {
    const r = L.rng(seed);
    const pts = rachis(x, y, ang, len, curl);
    const prof = (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.55)), 0.8);
    layered(ctx, frondBox(ctx, x, y, len), (lc) => {
      for (let i = 0; i < leaflets; i++) {
        const t = 0.08 + 0.9 * (i / (leaflets - 1));
        const [qx, qy, qa] = pts[Math.round(t * (pts.length - 1))];
        for (const sd of [-1, 1]) {
          const ll = len * 0.46 * Math.pow(Math.sin(Math.PI * (0.12 + 0.88 * t)), 0.6) * (1 - 0.35 * t) * r.range(0.85, 1.1);
          const a0 = qa + sd * r.range(0.42, 0.7);
          const down = angleTo(a0, Math.PI / 2);
          const path = [];
          let px = qx;
          let py = qy;
          for (let k = 0; k <= 16; k++) {
            path.push([px, py]);
            const s = k / 16;
            const a = a0 + down * droop * Math.pow(s, 1.3) * 0.75;
            px += (Math.cos(a) * ll) / 16;
            py += (Math.sin(a) * ll) / 16;
          }
          const wmax = len * r.range(0.026, 0.034);
          const c = mixc(colour, r() < 0.5 ? G.fresh : G.deep, r() * 0.25);
          path0(lc, taperPoly(path, wmax, 0, prof), shade(c, 0.12));
          // The fold: the half toward the light paler.
          const half = halfStrip(path, wmax, prof, sd);
          path0(lc, half, lift(c, 0.14 * light));
          line(lc, path.slice(0, 15), Math.max(0.8, wmax * 0.08), lift(c, 0.3), 0.5);
        }
      }
      taper(lc, pts.map(([px, py]) => [px, py]), len * 0.022, len * 0.005, mixc(colour, G.light, 0.25), 1);
    }, shadow, alpha);
  }

  function path0(c, pts, colour, alpha = 1) {
    path(c, pts);
    c.fillStyle = css(colour, alpha);
    c.fill();
  }

  /** One half of a strip along `pts`, from its middle to the side `sd`. */
  function halfStrip(pts, w0, prof, sd) {
    const n = pts.length;
    const edge = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0];
      let ty = b[1] - a[1];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      const w = (w0 * prof(i / (n - 1))) / 2;
      edge.push([p[0] - ty * w * sd, p[1] + tx * w * sd]);
    }
    return [...pts, ...edge.reverse()];
  }

  let PINNA = null;
  /** A fern's pinna: narrow, slightly curved toward the tip, its edge finely scalloped (base 0, 0, tip 0, -1). */
  function pinnaShape() {
    if (PINNA) return PINNA;
    const prof = (t) => 0.5 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.7)), 0.75) * (1 + 0.1 * Math.abs(Math.sin(t * Math.PI * 8)));
    PINNA = blade(prof, prof, 60).map(([px, py]) => [px + 0.08 * py * py, py]);
    return PINNA;
  }

  /** A fern's frond: a curving midrib with pinnae on both sides, longest a third of the way up, shorter to the tip. */
  function fernFrond(ctx, seed, { x, y, ang, len, curl = 0.5, colour = G.fresh, pinnae = 26, width = 0.17, slim = 0.26, light = 1, shadow = shadowFor(), alpha = 1, layer = null }) {
    const r = L.rng(seed);
    const pts = rachis(x, y, ang, len, curl);
    const shape = pinnaShape();
    const draw = (lc) => {
      for (let i = 0; i < pinnae * 2; i++) {
        const t = 0.04 + 0.94 * (i / (pinnae * 2 - 1));
        const [qx, qy, qa] = pts[Math.round(t * (pts.length - 1))];
        const sd = i % 2 ? 1 : -1;
        const pl = len * width * Math.pow(Math.sin(Math.PI * (0.18 + 0.82 * t)), 0.8) * (1 - 0.5 * t) * r.range(0.9, 1.08) + len * 0.01;
        const d = qa + sd * L.mix(1.2, 0.75, t) + r.gauss() * 0.04;
        const rot = d + Math.PI / 2;
        const c = mixc(colour, r() < 0.5 ? G.light : G.mid, r() * 0.25);
        const m = affine({ x: qx, y: qy, rot, s: pl, sx: slim * sd });
        lc.save();
        lc.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
        path0(lc, shape, c);
        lc.beginPath();
        lc.moveTo(0, 0);
        for (const [px, py] of shape) if (px >= 0) lc.lineTo(px, py);
        lc.closePath();
        lc.fillStyle = css(lift(c, 0.16 * light), 0.9);
        lc.fill();
        lc.beginPath();
        lc.moveTo(0, 0);
        lc.quadraticCurveTo(0.02, -0.5, 0.08, -0.95);
        lc.lineWidth = 0.035;
        lc.strokeStyle = css(lift(c, 0.32), 0.5);
        lc.stroke();
        lc.restore();
      }
      taper(lc, pts.map(([px, py]) => [px, py]), len * 0.014, len * 0.003, mixc(colour, BARK, 0.3), 1);
    };
    if (layer) draw(layer);
    else layered(ctx, frondBox(ctx, x, y, len), draw, shadow, alpha);
  }

  /** A soft shadow of something out of sight on the wall: `draw(lc)` in dark, blurred and faint. */
  function castShadow(ctx, draw, { blur, alpha }) {
    const layer = L.canvas(ctx.canvas.width, ctx.canvas.height);
    draw(layer.getContext("2d"));
    ctx.save();
    ctx.filter = `blur(${blur}px)`;
    ctx.globalAlpha = alpha;
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // The pictures
  // ---------------------------------------------------------------------------------------------------------------------------------

  /** Draws `draw(lc)` on a layer, throws its shadow on the wall behind (soft, to the lower right), then lays it down. */
  function withCast(ctx, draw, { dx, dy, blur, alpha = 0.12 }) {
    const layer = L.canvas(ctx.canvas.width, ctx.canvas.height);
    draw(layer.getContext("2d"));
    const far = 20000;
    ctx.save();
    ctx.shadowColor = `rgba(70,56,34,${alpha})`;
    ctx.shadowBlur = blur;
    ctx.shadowOffsetX = dx + far;
    ctx.shadowOffsetY = dy;
    ctx.drawImage(layer, -far, 0);
    ctx.restore();
    ctx.drawImage(layer, 0, 0);
  }

  /** The products: one plant in its pot, centred on the paper, the same floor, pot size and light in all eight. */
  const PRODUCTS = {
    "plant-monstera": { shape: "belly", glaze: "cream", seed: 101, plant: (H) => monsteraPlant(H * 0.95, 101, { leaves: 9, spread: 0.66 }) },
    "plant-fiddle-fig": { shape: "tapered", glaze: "terracotta", seed: 102, plant: (H) => fiddlePlant(H, 102) },
    "plant-bird-of-paradise": { shape: "basket", glaze: "basket", seed: 103, plant: (H) => bopPlant(H, 103) },
    "plant-snake-plant": { shape: "cylinder", glaze: "sage", seed: 104, plant: (H) => snakePlant(H * 1.0, 104, { leaves: 8 }) },
    "plant-zz-plant": { shape: "cylinder", glaze: "cream", seed: 105, plant: (H) => zzPlant(H * 0.95, 105) },
    "plant-pilea": { shape: "basket", glaze: "basket", seed: 106, potW: 0.37, plant: (H) => pileaPlant(H * 1.15, 106, { leaves: 34 }) },
    "plant-fern": { shape: "bowl", glaze: "sage", seed: 107, potW: 0.42, plant: (H) => nestPlant(H * 0.66, 107) },
    "plant-string-of-pearls": { shape: "bowl", glaze: "terracotta", seed: 108, potW: 0.46, stand: 0.33, plant: (H, floor) => pearlsPlant(H, 108, { floor, drop: 1, strands: 17 }) },
  };

  for (const [name, spec] of Object.entries(PRODUCTS)) {
    ART[name] = {
      w: 1200,
      h: 1600,
      quality: 80,
      draw(ctx, w, h) {
        STYLE.unit = h / 1500;
        paperGround(ctx, w, h, spec.seed);
        const floor = h * 0.875;
        const potW = w * (spec.potW ?? 0.39);
        floorShadow(ctx, w / 2, floor, potW * (spec.stand ? 1.2 : 1), 1);
        withCast(ctx, (lc) => {
          let base = floor;
          if (spec.stand) base = oakStand(lc, w / 2, floor, potW * 1.05, h * spec.stand, spec.seed);
          const g0 = potGeom(spec.shape, spec.glaze, w / 2, base, potW);
          const H = g0.soil[1] - h * 0.055;
          potted(lc, { shape: spec.shape, glaze: spec.glaze, x: w / 2, floor: base, w: potW, plant: spec.plant(H, floor), seed: spec.seed, shadow: spec.stand ? 0.6 : 0 });
        }, { dx: w * 0.045, dy: h * 0.012, blur: 30 * STYLE.unit, alpha: 0.11 });
        paperFinish(ctx, w, h, spec.seed + 9, { grain: 3 });
      },
    };
  }

  /** A potted plant standing on a surface at `floor` (on the floor or a board), `w` wide, the plant `H` tall above its soil. */
  function pot(ctx, shape, glaze, x, floor, w, plant, seed, shadow = 1) {
    return potted(ctx, { shape, glaze, x, floor, w, plant, seed, shadow });
  }

  /** The home page's hero: a lush corner on the right (a bench of potted plants, a bird of paradise and a monstera rising to the top right), calm paper on the left for words. */
  ART.hero = {
    w: 2560,
    h: 1440,
    quality: 80,
    draw(ctx, w, h) {
      STYLE.unit = h / 1500;
      paperGround(ctx, w, h, 201);
      // The floor, only a shade warmer than the wall.
      const fl = ctx.createLinearGradient(0, h * 0.84, 0, h);
      fl.addColorStop(0, "rgba(160,128,86,0)");
      fl.addColorStop(1, "rgba(160,128,86,0.09)");
      ctx.fillStyle = fl;
      ctx.fillRect(0, h * 0.84, w, h * 0.16);
      // Light through leaves out of sight, faint on the wall at the upper left.
      castShadow(ctx, (lc) => {
        palmFrond(lc, 204, { x: -w * 0.03, y: -h * 0.08, ang: 0.62, len: h * 0.62, curl: 0.55, colour: hex("#2a3326"), shadow: null, light: 0, droop: 0.6 });
        const leaf = monstera(203, { cut: 1 });
        piece(lc, { ...leaf, paint: null, fill: "#2a3326", at: { x: -w * 0.01, y: h * 0.6, rot: 1.25, s: h * 0.36, sx: 0.8 }, shadow: null, edge: 0 });
      }, { blur: 7 * STYLE.unit, alpha: 0.05 });
      const floor = h * 0.965;
      const benchTop = h * 0.75;
      const onBench = benchTop - (floor - benchTop) * 0.07;
      withCast(ctx, (lc) => {
        floorShadow(lc, w * 0.96, h * 1.0, w * 0.16, 0.8);
        pot(lc, "basket", "basket", w * 0.965, h * 1.01, w * 0.15, bopPlant(h * 1.04, 211, { leaves: 10 }), 211, 0);
        floorShadow(lc, w * 0.72, floor, w * 0.36, 0.7);
        bench(lc, w * 0.5, w * 0.905, benchTop, floor, 212);
        pot(lc, "belly", "cream", w * 0.705, onBench, w * 0.125, monsteraPlant(h * 0.64, 213, { leaves: 9, spread: 0.64 }), 213, 0.7);
        pot(lc, "tapered", "terracotta", w * 0.56, onBench, w * 0.068, pileaPlant(h * 0.2, 214, { leaves: 26 }), 214, 0.7);
        pot(lc, "tapered", "terracotta", w * 0.79, onBench, w * 0.075, snakePlant(h * 0.36, 215, { leaves: 7 }), 215, 0.7);
        pot(lc, "bowl", "terracotta", w * 0.868, onBench + h * 0.006, w * 0.075, pearlsPlant(h * 0.2, 216, { floor: floor - h * 0.02, strands: 15 }), 216, 0.7);
      }, { dx: w * 0.02, dy: h * 0.015, blur: 26 * STYLE.unit, alpha: 0.1 });
      paperFinish(ctx, w, h, 219, { grain: 3 });
    },
  };

  /** The greenhouse: an arched glasshouse window glowing with warm light, plants on the bench before it and growing round it. */
  ART.story = {
    w: 1600,
    h: 1200,
    quality: 76,
    draw(ctx, w, h) {
      STYLE.unit = h / 1500;
      const u = STYLE.unit;
      paperGround(ctx, w, h, 301, { top: "#e2d3b5", bottom: "#d3c19d" });
      const cx = w * 0.5;
      const x0 = w * 0.2;
      const x1 = w * 0.8;
      const R = (x1 - x0) / 2;
      const spring = h * 0.44;
      const sill = h * 0.75;
      const arch = (c, inset = 0) => {
        c.beginPath();
        c.moveTo(x0 + inset, sill);
        c.lineTo(x0 + inset, spring);
        c.arc(cx, spring, R - inset, Math.PI, 0);
        c.lineTo(x1 - inset, sill);
        c.closePath();
      };
      // The deep reveal round the window, then the glass and what lies beyond it.
      // Light spilling round the window onto the wall.
      glow(ctx, cx, spring, R * 1.9, R * 1.6, hex("#fff3d6"), 0.55);
      ctx.save();
      arch(ctx, -30 * u);
      ctx.fillStyle = "#e9dcbf";
      ctx.fill();
      ctx.restore();
      const beyond = L.canvas(w, h);
      const bc = beyond.getContext("2d");
      const sky = bc.createLinearGradient(0, spring - R, 0, sill);
      sky.addColorStop(0, "#fff8e2");
      sky.addColorStop(0.55, "#fdebc0");
      sky.addColorStop(1, "#f0dcaa");
      bc.fillStyle = sky;
      bc.fillRect(0, 0, w, h);
      glow(bc, cx - R * 0.3, spring - R * 0.35, R * 1.1, R * 1.1, hex("#fffef6"), 1);
      glow(bc, cx - R * 0.3, spring - R * 0.35, R * 0.4, R * 0.4, hex("#ffffff"), 0.8);
      // The glasshouse beyond: its far plants, pale in the haze.
      const haze = hex("#c3cfa9");
      for (let i = 0; i < 5; i++) palmFrond(bc, 330 + i, { x: x0 + (x1 - x0) * (0.1 + i * 0.2), y: sill + h * 0.05, ang: -Math.PI / 2 + (i - 2) * 0.35, len: h * L.mix(0.3, 0.45, (i * 3) % 5 / 5), curl: (i - 2) * 0.4, colour: mixc(haze, hex("#d6dcbb"), (i % 2) * 0.5), shadow: null, light: 0.3 });
      for (let i = 0; i < 4; i++) piece(bc, { ...monstera(340 + i, { colour: mixc(haze, hex("#b3c39a"), 0.5), light: 0 }), at: { x: x0 + (x1 - x0) * (0.18 + i * 0.22), y: sill + h * 0.02, rot: (i - 1.5) * 0.4, s: h * 0.2 }, shadow: null, edge: 0 });
      ctx.save();
      arch(ctx);
      ctx.clip();
      ctx.filter = `blur(${2.5 * u}px)`;
      ctx.drawImage(beyond, 0, 0);
      ctx.filter = "none";
      ctx.globalAlpha = 0.26;
      ctx.fillStyle = "#fff2d0";
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
      // Reflections on the glass.
      ctx.globalCompositeOperation = "screen";
      for (const [at, wd] of [[0.16, 0.05], [0.24, 0.015], [0.6, 0.06], [0.69, 0.018]]) {
        ctx.save();
        ctx.translate(x0 + (x1 - x0) * at, h * 0.5);
        ctx.rotate(0.5);
        const g = ctx.createLinearGradient(-w * wd, 0, w * wd, 0);
        g.addColorStop(0, "rgba(255,255,255,0)");
        g.addColorStop(0.5, "rgba(255,255,250,0.35)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(-w * wd, -h, w * wd * 2, h * 2);
        ctx.restore();
      }
      ctx.restore();
      // The glazing bars: dark green, cut from paper.
      const bars = [];
      const bar = (pts, wd) => bars.push(taperPoly(pts, wd, wd));
      const bw = 9 * u;
      for (let k = 1; k < 4; k++) {
        const x = x0 + ((x1 - x0) * k) / 4;
        const yTop = spring - Math.sqrt(Math.max(0, R * R - (x - cx) ** 2));
        bar([[x, sill], [x, k === 2 ? spring - R * 0.5 : yTop]], bw);
      }
      for (const y of [spring, spring + (sill - spring) * 0.5]) bar([[x0, y], [x1, y]], bw);
      const ring = [];
      for (let i = 0; i <= 60; i++) ring.push([cx + Math.cos(Math.PI + (i / 60) * Math.PI) * R * 0.5, spring + Math.sin(Math.PI + (i / 60) * Math.PI) * R * 0.5]);
      bar(ring, bw);
      for (let k = 1; k < 6; k++) {
        const a = Math.PI + (k / 6) * Math.PI;
        bar([[cx + Math.cos(a) * R * 0.5, spring + Math.sin(a) * R * 0.5], [cx + Math.cos(a) * R, spring + Math.sin(a) * R]], bw);
      }
      const outerPts = [[x0 - 22 * u, sill], [x0 - 22 * u, spring]];
      for (let i = 0; i <= 80; i++) outerPts.push([cx + Math.cos(Math.PI + (i / 80) * Math.PI) * (R + 22 * u), spring + Math.sin(Math.PI + (i / 80) * Math.PI) * (R + 22 * u)]);
      outerPts.push([x1 + 22 * u, sill]);
      const innerPts = [[x0, sill], [x0, spring]];
      for (let i = 0; i <= 80; i++) innerPts.push([cx + Math.cos(Math.PI + (i / 80) * Math.PI) * R, spring + Math.sin(Math.PI + (i / 80) * Math.PI) * R]);
      innerPts.push([x1, sill]);
      const frameColour = hex("#24452f");
      for (const b of bars) piece(ctx, { outline: b, at: ID, fill: css(frameColour), shadow: shadowFor(0.5, 0.16), edge: 0.6 });
      piece(ctx, { outline: [...outerPts, ...innerPts.reverse()], at: ID, fill: css(frameColour), shadow: shadowFor(0.9, 0.25), edge: 0.8, paint: (lc) => overlay(lc, tex().streak, [x0 - 30, 0, x1 + 30, sill], 0.25, L.rng(9)) });
      // Warm light falling through it, down across the bench and the floor.
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.filter = `blur(${26 * u}px)`;
      for (const [a, b, k] of [[0.05, 0.3, 0.32], [0.36, 0.55, 0.26], [0.62, 0.85, 0.2]]) {
        ctx.beginPath();
        ctx.moveTo(x0 + (x1 - x0) * a, spring - R * 0.2);
        ctx.lineTo(x0 + (x1 - x0) * b, spring - R * 0.35);
        ctx.lineTo(x0 + (x1 - x0) * b + w * 0.32, h);
        ctx.lineTo(x0 + (x1 - x0) * a + w * 0.32, h);
        ctx.closePath();
        ctx.fillStyle = `rgba(255,238,196,${k})`;
        ctx.fill();
      }
      ctx.restore();
      // The bench below the window, its plants, and what grows to either side.
      const floor = h * 1.04;
      const top = h * 0.8;
      const onBench = top - (floor - top) * 0.07;
      withCast(ctx, (lc) => {
        pot(lc, "basket", "basket", w * 0.075, h * 1.03, w * 0.15, (g) => {
          const items = [];
          for (let i = 0; i < 6; i++) {
            const a = -Math.PI / 2 + (i - 2.5) * 0.3 + 0.3;
            items.push({ front: false, draw: (c) => palmFrond(c, 320 + i, { x: g.soil[0], y: g.soil[1], ang: a, len: h * L.mix(0.42, 0.56, ((i * 37) % 6) / 6), curl: (a + Math.PI / 2) * 1.5 + 0.35, colour: mixc(G.mid, G.fresh, (i % 3) / 3), droop: 0.7 }) });
          }
          return items;
        }, 311, 0);
        pot(lc, "belly", "cream", w * 0.93, h * 1.03, w * 0.15, monsteraPlant(h * 0.66, 317, { leaves: 7, spread: 0.6 }), 317, 0);
        bench(lc, w * 0.15, w * 0.85, top, floor, 312);
        pot(lc, "tapered", "terracotta", w * 0.29, onBench, w * 0.095, pileaPlant(h * 0.25, 313, { leaves: 24 }), 313, 0.6);
        pot(lc, "cylinder", "sage", w * 0.42, onBench, w * 0.085, snakePlant(h * 0.33, 314, { leaves: 7 }), 314, 0.6);
        pot(lc, "bowl", "cream", w * 0.565, onBench, w * 0.115, nestPlant(h * 0.22, 315, { fronds: 16 }), 315, 0.6);
        pot(lc, "tapered", "terracotta", w * 0.71, onBench, w * 0.075, zzPlant(h * 0.24, 316, { stems: 7 }), 316, 0.6);
        // A hanging bowl of string of pearls.
        const hx = w * 0.625;
        const hy = h * 0.2;
        for (const dx of [-0.04, 0, 0.04]) line(lc, [[hx, -10], [hx + dx * w, hy - h * 0.003]], 2.2 * u, hex("#8a6f4f"), 0.9);
        pot(lc, "bowl", "terracotta", hx, hy + w * 0.085 * 0.55, w * 0.085, pearlsPlant(h * 0.14, 318, { drop: 1.4, strands: 14 }), 318, 0);
      }, { dx: w * 0.02, dy: h * 0.02, blur: 24 * u, alpha: 0.1 });
      paperFinish(ctx, w, h, 319, { grain: 3 });
    },
  };

  /** A dense band of jungle in deep greens, darker at the back and lighter in front, for light words over it. */
  ART.leaves = {
    w: 2400,
    h: 1200,
    quality: 74,
    draw(ctx, w, h) {
      STYLE.unit = h / 1500;
      const back = ctx.createLinearGradient(0, 0, 0, h);
      back.addColorStop(0, "#0c1a12");
      back.addColorStop(1, "#102219");
      ctx.fillStyle = back;
      ctx.fillRect(0, 0, w, h);
      const r = L.rng(401);
      const layers = [
        { c: hex("#11261a"), n: 16, s: [0.42, 0.62], light: 0.2 },
        { c: hex("#17311f"), n: 16, s: [0.38, 0.56], light: 0.4 },
        { c: hex("#1d3c28"), n: 15, s: [0.34, 0.52], light: 0.6 },
        { c: hex("#24462f"), n: 12, s: [0.36, 0.52], light: 0.8 },
        { c: hex("#2c5438"), n: 9, s: [0.34, 0.5], light: 1 },
      ];
      layers.forEach((layer, li) => {
        const sh = shadowFor(1.4, 0.55);
        for (let i = 0; i < layer.n; i++) {
          const x = ((i + r()) / layer.n) * w * 1.1 - w * 0.05;
          // The front layers keep to the top and bottom edges, so the middle stays deep for words.
          const y = li < 3 ? r.range(0.15, 1.15) * h : r() < 0.5 ? r.range(0.0, 0.18) * h : r.range(1.0, 1.25) * h;
          const size = r.range(layer.s[0], layer.s[1]) * h;
          const rot = li < 3 ? r.gauss() * 0.7 : (y < h * 0.5 ? Math.PI : 0) + r.gauss() * 0.55;
          const kind = r();
          const c = mixc(layer.c, G.mid, r() * 0.12);
          if (kind < 0.42) {
            piece(ctx, { ...monstera(4000 + li * 100 + i, { cut: r.range(0.7, 1), bend: r.gauss() * 0.06, turn: r.gauss() * 0.1, colour: c, light: layer.light }), at: { x, y, rot, s: size * 1.25, sx: r.range(0.75, 1) * (r() < 0.5 ? -1 : 1) }, shadow: sh });
          } else if (kind < 0.62) {
            palmFrond(ctx, 4500 + li * 100 + i, { x, y: y + size * 0.4, ang: -Math.PI / 2 + rot * 1.2, len: size * 1.5, curl: r.gauss() * 0.9, colour: c, shadow: sh, light: layer.light });
          } else if (kind < 0.8) {
            fernFrond(ctx, 4700 + li * 100 + i, { x, y: y + size * 0.4, ang: -Math.PI / 2 + rot * 1.3, len: size * 1.3, curl: r.gauss() * 0.8, colour: mixc(c, G.fresh, 0.15), shadow: sh, light: layer.light, width: 0.15 });
          } else {
            piece(ctx, { ...paddle(4900 + li * 100 + i, { colour: mixc(c, BOP, 0.25), tears: 4, bend: r.gauss() * 0.05, light: layer.light }), at: { x, y: y + size * 0.3, rot: rot * 0.8, s: size * 1.3, sx: r.range(0.6, 1) }, shadow: sh });
          }
        }
        // Each layer back sinks a little into the dark.
        if (li < layers.length - 1) {
          ctx.fillStyle = "rgba(8,18,12,0.16)";
          ctx.fillRect(0, 0, w, h);
        }
      });
      const vg = ctx.createLinearGradient(0, 0, 0, h);
      vg.addColorStop(0, "rgba(6,14,9,0.35)");
      vg.addColorStop(0.3, "rgba(6,14,9,0)");
      vg.addColorStop(0.75, "rgba(6,14,9,0)");
      vg.addColorStop(1, "rgba(6,14,9,0.3)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);
      paperFinish(ctx, w, h, 409, { grain: 3, fibres: 0.5 });
    },
  };

  /** The room the collection tiles stand in: the paper wall and a light oak floor. */
  function tileRoom(ctx, w, h, seed) {
    STYLE.unit = h / 1500;
    paperGround(ctx, w, h, seed);
    oakFloor(ctx, w, h, h * 0.8, seed + 1);
  }

  ART["tile-big-leaves"] = {
    w: 1200,
    h: 1500,
    quality: 78,
    draw(ctx, w, h) {
      tileRoom(ctx, w, h, 501);
      withCast(ctx, (lc) => {
        pot(lc, "basket", "basket", w * 0.74, h * 0.855, w * 0.27, bopPlant(h * 0.86, 502, { leaves: 9 }), 502);
        pot(lc, "tapered", "terracotta", w * 0.27, h * 0.87, w * 0.24, fiddlePlant(h * 0.66, 503, { leaves: 18 }), 503);
        pot(lc, "belly", "cream", w * 0.52, h * 0.965, w * 0.25, monsteraPlant(h * 0.46, 504, { leaves: 7, spread: 0.72, reach: 0.72 }), 504);
      }, { dx: w * 0.04, dy: h * 0.01, blur: 26 * STYLE.unit, alpha: 0.1 });
      paperFinish(ctx, w, h, 509, { grain: 3 });
    },
  };

  ART["tile-easy-care"] = {
    w: 1200,
    h: 1500,
    quality: 78,
    draw(ctx, w, h) {
      tileRoom(ctx, w, h, 511);
      withCast(ctx, (lc) => {
        pot(lc, "cylinder", "sage", w * 0.29, h * 0.865, w * 0.25, snakePlant(h * 0.6, 512, { leaves: 8 }), 512);
        pot(lc, "cylinder", "cream", w * 0.72, h * 0.875, w * 0.26, zzPlant(h * 0.5, 513, { stems: 8 }), 513);
        pot(lc, "tapered", "terracotta", w * 0.5, h * 0.965, w * 0.22, pileaPlant(h * 0.32, 514, { leaves: 28 }), 514);
      }, { dx: w * 0.04, dy: h * 0.01, blur: 26 * STYLE.unit, alpha: 0.1 });
      paperFinish(ctx, w, h, 519, { grain: 3 });
    },
  };

  ART["tile-trailing"] = {
    w: 1200,
    h: 1500,
    quality: 78,
    draw(ctx, w, h) {
      tileRoom(ctx, w, h, 521);
      withCast(ctx, (lc) => {
        // A floating oak shelf on two brackets, two strings of pearls on it.
        const sy = h * 0.33;
        const r = L.rng(522);
        board(lc, w * 0.36, sy - h * 0.022, w * 1.02, sy, r, { tone: 0.3, shadow: null });
        board(lc, w * 0.36, sy, w * 1.02, sy + h * 0.03, r, { tone: -0.05 });
        for (const bx of [w * 0.44, w * 0.9]) piece(lc, { outline: [[bx, sy + h * 0.03], [bx + w * 0.03, sy + h * 0.03], [bx + w * 0.03, sy + h * 0.035], [bx + w * 0.006, sy + h * 0.1], [bx, sy + h * 0.1]], at: ID, fill: css(OAK.base), paint: oakPaint(r, [bx, sy, bx + w * 0.03, sy + h * 0.1], { vertical: true, tone: -0.2 }), shadow: shadowFor(0.8, 0.26) });
        pot(lc, "tapered", "terracotta", w * 0.47, sy - h * 0.006, w * 0.13, pearlsPlant(h * 0.1, 525, { drop: 1, floor: h * 0.66, strands: 9 }), 525, 0.4);
        pot(lc, "bowl", "terracotta", w * 0.76, sy - h * 0.008, w * 0.34, pearlsPlant(h * 0.2, 523, { drop: 1, floor: h * 0.86, strands: 20 }), 523, 0.5);
        pot(lc, "belly", "cream", w * 0.3, h * 0.955, w * 0.32, nestPlant(h * 0.46, 524, { fronds: 18 }), 524);
      }, { dx: w * 0.04, dy: h * 0.01, blur: 26 * STYLE.unit, alpha: 0.1 });
      paperFinish(ctx, w, h, 529, { grain: 3 });
    },
  };

  /** The paper's grain on nothing, tiling without a seam, for laying over the cream page. */
  ART.paper = {
    w: 512,
    h: 512,
    alpha: true,
    quality: 80,
    draw(ctx, w, h) {
      STYLE.unit = 1;
      paperTile(ctx, w, h, 601, 1);
    },
  };

  /** A single fern frond in soft green on nothing, for a page's corner. */
  ART.sprig = {
    w: 900,
    h: 900,
    alpha: true,
    quality: 82,
    draw(ctx, w, h) {
      STYLE.unit = h / 900;
      fernFrond(ctx, 611, { x: w * 0.06, y: h * 0.96, ang: -1.12, len: w * 1.12, curl: 0.95, colour: hex("#7fa66e"), pinnae: 30, width: 0.19, slim: 0.22, shadow: shadowFor(0.9, 0.16) });
    },
  };
})();
