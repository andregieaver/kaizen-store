/* global window, document, Path2D */
/**
 * Arcade's art (`docs/signature-themes.md`): a neon sign studio on an arcade night. Glass-tube neon (a white-hot core, saturated colour
 * and wide soft glows) mounted on clear acrylic backers with four metal standoffs, on dark painted brick lit by the signs' own light; a
 * synthwave horizon for the hero; the workshop's bench for the story. No words, numbers, logos, game characters or people anywhere.
 *
 * The wall is lit as a photograph would show it: every sign is sampled into small lights a few centimetres in front of the wall, their
 * light (with the wall's relief) is worked out per pixel, tone-mapped and only then are the tubes and their glow drawn over it.
 */
(() => {
  const L = window.ARTLIB;
  const ART = window.ART;
  const TAU = Math.PI * 2;

  const NEON = {
    pink: "#ff2bd6",
    cyan: "#22e4ff",
    violet: "#8a5cff",
    lime: "#b6ff3b",
    orange: "#ff8a1f",
    yellow: "#ffe14a",
  };
  /** How hard each colour is driven: violet is dim to the eye, yellow and lime bright. */
  const POWER = { [NEON.pink]: 1, [NEON.cyan]: 0.9, [NEON.violet]: 1.35, [NEON.lime]: 0.82, [NEON.orange]: 1, [NEON.yellow]: 0.8 };

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Colour
  // ---------------------------------------------------------------------------------------------------------------------------------

  const toLin = (v) => Math.pow(v / 255, 2.2);
  const linHex = (hex) => L.hexRgb(hex).map(toLin);
  const mixRgb = (a, b, t) => a.map((v, i) => Math.round(L.mix(v, b[i], t)));
  const css = ([r, g, b], a = 1) => `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
  /** Linear light (0 to 1) to an sRGB byte, through a table. */
  const ENC = new Uint8ClampedArray(8193);
  for (let i = 0; i <= 8192; i++) ENC[i] = Math.round(Math.pow(i / 8192, 1 / 2.2) * 255);
  const enc = (v) => ENC[v <= 0 ? 0 : v >= 1 ? 8192 : (v * 8192) | 0];

  /** A hash of two integers and a seed, in [0, 1). */
  function hash(a, b, s) {
    let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(s | 0, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Shapes, drawn in a box about 100 units across (y down), as SVG path data, one glass tube per path
  // ---------------------------------------------------------------------------------------------------------------------------------

  const pt = (p) => `${Math.round(p[0] * 1000) / 1000} ${Math.round(p[1] * 1000) / 1000}`;
  const poly = (points, closed = true) => `M ${points.map(pt).join(" L ")}${closed ? " Z" : ""}`;

  /** A circle starting (and so with its electrodes) at angle `start`. */
  function circle(cx, cy, r, start = -Math.PI / 2) {
    const a = [cx + Math.cos(start) * r, cy + Math.sin(start) * r];
    const b = [cx - Math.cos(start) * r, cy - Math.sin(start) * r];
    return `M ${pt(a)} A ${r} ${r} 0 1 1 ${pt(b)} A ${r} ${r} 0 1 1 ${pt(a)} Z`;
  }

  /** A polygon or polyline with its corners bent round, as glass is: each corner cut back by `r` and turned through a curve. */
  function corners(points, r, closed = true) {
    const n = points.length;
    const at = (i) => points[(i + n) % n];
    const cut = (i) => {
      const p = at(i);
      const a = at(i - 1);
      const b = at(i + 1);
      const la = Math.hypot(a[0] - p[0], a[1] - p[1]);
      const lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
      const k = Math.min(r, la * 0.45, lb * 0.45);
      return [
        [p[0] + ((a[0] - p[0]) / la) * k, p[1] + ((a[1] - p[1]) / la) * k],
        [p[0] + ((b[0] - p[0]) / lb) * k, p[1] + ((b[1] - p[1]) / lb) * k],
      ];
    };
    if (closed) {
      const m = [(at(0)[0] + at(1)[0]) / 2, (at(0)[1] + at(1)[1]) / 2];
      let d = `M ${pt(m)}`;
      for (let i = 1; i <= n; i++) {
        const [a, b] = cut(i);
        d += ` L ${pt(a)} Q ${pt(at(i))} ${pt(b)}`;
      }
      return `${d} L ${pt(m)} Z`;
    }
    let d = `M ${pt(points[0])}`;
    for (let i = 1; i < n - 1; i++) {
      const [a, b] = cut(i);
      d += ` L ${pt(a)} Q ${pt(points[i])} ${pt(b)}`;
    }
    return `${d} L ${pt(points[n - 1])}`;
  }

  const bez = ([p0, p1, p2, p3], t) => {
    const u = 1 - t;
    return [
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ];
  };
  const bezTan = ([p0, p1, p2, p3], t) => {
    const u = 1 - t;
    const x = 3 * u * u * (p1[0] - p0[0]) + 6 * u * t * (p2[0] - p1[0]) + 3 * t * t * (p3[0] - p2[0]);
    const y = 3 * u * u * (p1[1] - p0[1]) + 6 * u * t * (p2[1] - p1[1]) + 3 * t * t * (p3[1] - p2[1]);
    const l = Math.hypot(x, y) || 1;
    return [x / l, y / l];
  };

  /**
   * A tube bent round a spine (a cubic curve) and back, `width(t)` either side of it, with hairpin turns at both ends: a palm's frond or
   * trunk. It starts at the base's turn, where its electrodes go.
   */
  function outline(spine, width, steps = 64) {
    const left = [];
    const right = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const p = bez(spine, t);
      const g = bezTan(spine, t);
      const n = [-g[1], g[0]];
      const w = width(t);
      left.push([p[0] + n[0] * w, p[1] + n[1] * w]);
      right.push([p[0] - n[0] * w, p[1] - n[1] * w]);
    }
    /** The hairpin round the tip: from the left side through the spine's direction to the right side. */
    const tipTurn = () => {
      const p = bez(spine, 1);
      const g = bezTan(spine, 1);
      const n = [-g[1], g[0]];
      const w = width(1);
      const out = [];
      for (let k = 1; k < 12; k++) {
        const a = (Math.PI * k) / 12;
        out.push([p[0] + (n[0] * Math.cos(a) + g[0] * Math.sin(a)) * w, p[1] + (n[1] * Math.cos(a) + g[1] * Math.sin(a)) * w]);
      }
      return out;
    };
    // The base's turn, from its apex to the left side; the left side; the tip's turn; the right side; and back round to the apex.
    const p0 = bez(spine, 0);
    const g0 = bezTan(spine, 0);
    const n0 = [-g0[1], g0[0]];
    const w0 = width(0);
    const baseArc = (a0, a1) => {
      const out = [];
      for (let k = 0; k <= 8; k++) {
        const a = a0 + ((a1 - a0) * k) / 8;
        out.push([p0[0] + (n0[0] * Math.cos(a) - g0[0] * Math.sin(a)) * w0, p0[1] + (n0[1] * Math.cos(a) - g0[1] * Math.sin(a)) * w0]);
      }
      return out;
    };
    const tip = tipTurn();
    const points = [...baseArc(Math.PI / 2, 0), ...left, ...tip, ...right.reverse(), ...baseArc(Math.PI, Math.PI / 2)];
    return poly(points, true);
  }

  /** A crescent: the part of one circle outside another, its two tips bent round. */
  function crescent(R, ox, oy, r, trim = 3) {
    const d = Math.hypot(ox, oy);
    const a = (R * R - r * r + d * d) / (2 * d);
    const hh = Math.sqrt(Math.max(0, R * R - a * a));
    const ux = ox / d;
    const uy = oy / d;
    const P1 = [a * ux - hh * uy, a * uy + hh * ux];
    const P2 = [a * ux + hh * uy, a * uy - hh * ux];
    const ang = (c, p) => Math.atan2(p[1] - c[1], p[0] - c[0]);
    const norm = (v) => ((v % TAU) + TAU) % TAU;
    const arc = (c, rad, a0, a1, through, steps) => {
      let span = norm(a1 - a0);
      if (norm(through - a0) > span) span -= TAU;
      const out = [];
      for (let i = 0; i <= steps; i++) {
        const t = a0 + (span * i) / steps;
        out.push([c[0] + Math.cos(t) * rad, c[1] + Math.sin(t) * rad]);
      }
      return { out, span };
    };
    const away = Math.atan2(-oy, -ox);
    const outer = arc([0, 0], R, ang([0, 0], P1), ang([0, 0], P2), away, 160);
    const inner = arc([ox, oy], r, ang([ox, oy], P2), ang([ox, oy], P1), away, 160);
    // Trim both arcs back from the tips and turn through each tip with a curve.
    const cutO = Math.ceil((trim / (Math.abs(outer.span) * R)) * 160);
    const cutI = Math.ceil((trim / (Math.abs(inner.span) * r)) * 160);
    const o = outer.out.slice(cutO, outer.out.length - cutO);
    const n = inner.out.slice(cutI, inner.out.length - cutI);
    let path = `M ${pt(o[0])}`;
    for (const p of o.slice(1)) path += ` L ${pt(p)}`;
    path += ` Q ${pt(P2)} ${pt(n[0])}`;
    for (const p of n.slice(1)) path += ` L ${pt(p)}`;
    path += ` Q ${pt(P1)} ${pt(o[0])} Z`;
    return path;
  }

  function starPoints(cx, cy, R, r, rot) {
    const out = [];
    for (let k = 0; k < 10; k++) {
      const a = rot + (k * Math.PI) / 5;
      const rad = k % 2 ? r : R;
      out.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
    }
    return out;
  }

  /**
   * The signs. Each tube: its path, colour, whether it is a closed loop (then `gapAt` is where its two ends meet), and the sign's four
   * standoffs in the same units.
   */
  /** A palm frond's half width along its spine: widest a third of the way out, a hairpin at the tip. */
  const frond = (wide) => (t) => Math.max(1.35, wide * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.72)), 1.15));

  const SIGNS = {
    heart: () => ({
      tubes: [
        {
          d: "M 0 -24 C -6 -38, -18 -44, -28 -42 C -42 -40, -50 -27, -48 -13 C -46 4, -28 20, -4 40 Q 0 43 4 40 C 28 20, 46 4, 48 -13 C 50 -27, 42 -40, 28 -42 C 18 -44, 6 -38, 0 -24 Z",
          color: NEON.pink,
          closed: true,
          hole: 1.3,
        },
        { d: "M -38.5 -14 C -39.5 -24, -34 -31.5, -25.5 -33.5", color: NEON.pink },
      ],
      standoffs: [[-22, -16], [22, -16], [-10, 16], [10, 16]],
    }),
    bolt: () => ({
      tubes: [{ d: corners([[12, -50], [-24, 4], [-2, 4], [-14, 50], [24, -8], [2, -8]], 3.2), color: NEON.yellow, closed: true, gapAt: [-6, -23] }],
      standoffs: [[4, -30], [-12, 0], [10, -2], [-6, 30]],
    }),
    crescent: () => ({
      tubes: [{ d: crescent(48, 19, -10, 42, 3.2), color: NEON.cyan, closed: true, gapAt: [36, 20] }],
      standoffs: [[-34, -16], [-30, 20], [-6, 36], [-10, -38]],
      rotate: -0.18,
    }),
    palm: () => ({
      tubes: [
        { d: outline([[7, 52], [11, 22], [6, -2], [-3, -21]], (t) => L.mix(4.6, 2.6, t)), color: NEON.orange, closed: true, hole: 0.8 },
        { d: outline([[-7, -29], [-18, -45], [-40, -47], [-53, -28]], frond(5.6)), color: NEON.lime, closed: true, hole: 0.7 },
        { d: outline([[-8, -22], [-22, -25], [-36, -14], [-40, 7]], frond(4.9)), color: NEON.lime, closed: true, hole: 0.7 },
        { d: outline([[0, -30], [11, -47], [34, -51], [50, -34]], frond(5.6)), color: NEON.lime, closed: true, hole: 0.7 },
        { d: outline([[2, -22], [16, -25], [31, -15], [35, 6]], frond(4.9)), color: NEON.lime, closed: true, hole: 0.7 },
      ],
      standoffs: [[-28, -30], [26, -32], [-2, 10], [16, 40]],
    }),
    star: () => {
      // The star flies up and to the right; three trails stream out behind it, the middle one longest, bending a little as they fade.
      const c = [20, -18];
      const th = Math.PI - 0.42;
      const dir = [Math.cos(th), Math.sin(th)];
      const n = [-dir[1], dir[0]];
      const at = (along, off) => [c[0] + dir[0] * along + n[0] * off, c[1] + dir[1] * along + n[1] * off];
      const trail = (start, len, off) => {
        const a = at(start, off);
        const b = at(start + len * 0.4, off + 0.6);
        const cc = at(start + len * 0.75, off + 2);
        const e = at(start + len, off + 4);
        return `M ${pt(a)} C ${pt(b)}, ${pt(cc)}, ${pt(e)}`;
      };
      return {
        tubes: [
          { d: corners(starPoints(c[0], c[1], 30, 13.5, -Math.PI / 2 + 0.22), 2.8), color: NEON.yellow, closed: true, gapAt: [32, -28] },
          { d: trail(37, 26, -11), color: NEON.pink, blockout: 1.1 },
          { d: trail(25, 44, 0), color: NEON.pink, blockout: 1.1 },
          { d: trail(30, 28, 11), color: NEON.pink, blockout: 1.1 },
        ],
        standoffs: [c.map((v, i) => v + [-7, 5][i]), c.map((v, i) => v + [8, -3][i]), at(42, -5.5), at(44, 6)],
      };
    },
    joystick: () => ({
      tubes: [
        { d: corners([[-42, 48], [-35, 20], [35, 20], [42, 48]], 5), color: NEON.cyan, closed: true, gapAt: [0, 48] },
        { d: "M -7 13 C -7.5 2, -8.5 -6, -9.5 -13", color: NEON.cyan },
        { d: circle(-10.5, -28, 13, Math.PI / 2 - 0.06), color: NEON.pink, closed: true },
        { d: circle(12, 34, 6, -Math.PI / 2), color: NEON.pink, closed: true },
        { d: circle(27, 34, 6, -Math.PI / 2), color: NEON.pink, closed: true },
      ],
      standoffs: [[-26, 34], [3, 40], [-24, -36], [6, -20]],
    }),
    cassette: () => ({
      tubes: [
        { d: corners([[-48, -31], [48, -31], [48, 31], [29, 31], [23, 21], [-23, 21], [-29, 31], [-48, 31]], 4.5), color: NEON.violet, closed: true, gapAt: [-40, 31] },
        { d: corners([[-35, -19], [35, -19], [35, 9], [-35, 9]], 6), color: NEON.pink, closed: true, gapAt: [0, 9] },
        { d: circle(-18, -5, 7.4, -Math.PI / 2), color: NEON.pink, closed: true },
        { d: circle(18, -5, 7.4, Math.PI / 2), color: NEON.pink, closed: true },
      ],
      standoffs: [[-41, -24], [41, -24], [-40, 22], [40, 22]],
      rotate: -0.07,
    }),
    cherries: () => ({
      tubes: [
        { d: circle(-21, 26, 17, -Math.PI / 2), color: NEON.pink, closed: true },
        { d: circle(19, 30, 17, -Math.PI / 2), color: NEON.pink, closed: true },
        { d: `M ${pt([-21 + Math.cos(3.35) * 11, 26 + Math.sin(3.35) * 11])} A 11 11 0 0 1 ${pt([-21 + Math.cos(4.85) * 11, 26 + Math.sin(4.85) * 11])}`, color: NEON.pink },
        { d: `M ${pt([19 + Math.cos(3.35) * 11, 30 + Math.sin(3.35) * 11])} A 11 11 0 0 1 ${pt([19 + Math.cos(4.85) * 11, 30 + Math.sin(4.85) * 11])}`, color: NEON.pink },
        { d: "M -20.5 6.5 C -18 -12, -6 -26, 2 -32 Q 5 -34.2 7 -31 C 12 -20, 18 -6, 19 10.5", color: NEON.lime },
        { d: "M 9.5 -34 C 15 -44, 27 -49, 36 -46 Q 40.5 -44.5 37.5 -41.5 C 29 -34, 18 -31, 9.5 -34 Z", color: NEON.lime, closed: true },
      ],
      standoffs: [[-12, 38], [26, 41], [-3, -4], [22, -26]],
    }),
  };

  // ---------------------------------------------------------------------------------------------------------------------------------
  // From path data to tubes in pixels
  // ---------------------------------------------------------------------------------------------------------------------------------

  let svgHost = null;
  /** Points every `step` units along a path (the last equal to the first on a closed one). */
  function sample(d, step) {
    if (!svgHost) {
      svgHost = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svgHost.setAttribute("width", "0");
      svgHost.setAttribute("height", "0");
      svgHost.style.position = "absolute";
      document.body.appendChild(svgHost);
    }
    const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
    el.setAttribute("d", d);
    svgHost.appendChild(el);
    const total = el.getTotalLength();
    const n = Math.max(8, Math.ceil(total / step));
    const out = [];
    for (let i = 0; i <= n; i++) {
      const p = el.getPointAtLength((i / n) * total);
      out.push([p.x, p.y]);
    }
    el.remove();
    return { pts: out, total };
  }

  const cache = new Map();
  function unitSign(key) {
    if (cache.has(key)) return cache.get(key);
    const def = SIGNS[key]();
    const rot = def.rotate ?? 0;
    const turn = ([x, y]) => [x * Math.cos(rot) - y * Math.sin(rot), x * Math.sin(rot) + y * Math.cos(rot)];
    const tubes = def.tubes.map((t) => {
      const s = sample(t.d, 0.12);
      return { ...t, pts: s.pts.map(turn), total: s.total };
    });
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const t of tubes) {
      for (const [x, y] of t.pts) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
    const u = { tubes, standoffs: def.standoffs.map(turn), box: [x0, y0, x1, y1] };
    cache.set(key, u);
    return u;
  }

  /**
   * A sign placed in the picture: its tubes as pixel polylines, split into the lit run, the black-painted blockouts at the ends, and the
   * points where the glass turns back through the backer. `size` is its larger side in pixels, `T` the tube's width.
   */
  function place(key, { x, y, size, rot = 0, T }) {
    const u = unitSign(key);
    const [x0, y0, x1, y1] = u.box;
    const s = size / Math.max(x1 - x0, y1 - y0);
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const c = Math.cos(rot);
    const sn = Math.sin(rot);
    const tf = ([px, py]) => {
      const ax = (px - mx) * s;
      const ay = (py - my) * s;
      return [x + ax * c - ay * sn, y + ax * sn + ay * c];
    };
    const tubes = u.tubes.map((t) => {
      const pts = t.pts.map(tf);
      const n = pts.length - 1;
      const dl = (t.total * s) / n;
      const blk = Math.max(2, Math.round(((t.blockout ?? 1.5) * T) / dl));
      const range = (a, b) => {
        const out = [];
        for (let i = a; i <= b; i++) out.push(pts[((i % n) + n) % n]);
        return out;
      };
      if (t.closed) {
        let g = 0;
        if (t.gapAt) {
          let best = Infinity;
          t.pts.forEach(([px, py], i) => {
            const dd = Math.hypot(px - t.gapAt[0], py - t.gapAt[1]);
            if (dd < best) {
              best = dd;
              g = i;
            }
          });
        }
        const hole = Math.max(1, Math.round(((t.hole ?? 0.45) * T) / dl));
        return {
          color: t.color,
          lit: [range(g + hole + blk, g + n - hole - blk)],
          dark: [range(g + hole, g + hole + blk), range(g + n - hole - blk, g + n - hole)],
          ends: [pts[(g + hole) % n], pts[(g + n - hole) % n]],
          full: pts,
          closed: true,
        };
      }
      return { color: t.color, lit: [pts.slice(blk, n - blk + 1)], dark: [pts.slice(0, blk + 1), pts.slice(n - blk, n + 1)], ends: [pts[0], pts[n]], full: pts, closed: false };
    });
    let bx0 = Infinity;
    let by0 = Infinity;
    let bx1 = -Infinity;
    let by1 = -Infinity;
    for (const t of tubes) {
      for (const [px, py] of t.full) {
        bx0 = Math.min(bx0, px);
        by0 = Math.min(by0, py);
        bx1 = Math.max(bx1, px);
        by1 = Math.max(by1, py);
      }
    }
    return { key, T, tubes, standoffs: u.standoffs.map(tf), box: [bx0, by0, bx1, by1], x, y, size };
  }

  const pathOf = (pts, close = false) => {
    const p = new Path2D();
    p.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]);
    if (close) p.closePath();
    return p;
  };

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Light: the signs as small lights in front of the wall
  // ---------------------------------------------------------------------------------------------------------------------------------

  /** Lights every `ds` pixels along every lit run, each with its colour (linear) times its length. */
  function lightsOf(signs, ds, gain = 1) {
    const out = [];
    for (const sign of signs) {
      for (const t of sign.tubes) {
        const c = linHex(t.color);
        const p = (POWER[t.color] ?? 1) * gain * (sign.gain ?? 1);
        for (const run of t.lit) {
          let acc = ds / 2;
          for (let i = 1; i < run.length; i++) {
            const [ax, ay] = run[i - 1];
            const [bx, by] = run[i];
            const seg = Math.hypot(bx - ax, by - ay);
            acc += seg;
            while (acc >= ds) {
              acc -= ds;
              const f = 1 - acc / Math.max(seg, 1e-6);
              out.push({ x: ax + (bx - ax) * f, y: ay + (by - ay) * f, z: sign.z ?? 0, r: c[0] * ds * p, g: c[1] * ds * p, b: c[2] * ds * p });
            }
          }
        }
      }
    }
    return out;
  }

  /**
   * The light falling on the wall, on a grid `q` pixels apart: per colour channel the three components of Σ I·(L − P)/|L − P|³ for lights
   * `z` in front of the wall (so the wall's relief can be lit per pixel later), and a broad term Σ I/(d² + zb²) for the light the room
   * scatters about.
   */
  function lightField(w, h, lights, { q = 4, z, zb }) {
    const gw = Math.ceil(w / q) + 2;
    const gh = Math.ceil(h / q) + 2;
    const F = new Float32Array(gw * gh * 12);
    const n = lights.length;
    const LX = new Float32Array(n);
    const LY = new Float32Array(n);
    const LZ = new Float32Array(n);
    const LR = new Float32Array(n);
    const LG = new Float32Array(n);
    const LB = new Float32Array(n);
    lights.forEach((l, i) => {
      LX[i] = l.x;
      LY[i] = l.y;
      LZ[i] = z + l.z;
      LR[i] = l.r;
      LG[i] = l.g;
      LB[i] = l.b;
    });
    const zb2 = zb * zb;
    for (let gy = 0; gy < gh; gy++) {
      const py = gy * q;
      for (let gx = 0; gx < gw; gx++) {
        const px = gx * q;
        let xr = 0;
        let xg = 0;
        let xb = 0;
        let yr = 0;
        let yg = 0;
        let yb = 0;
        let zr = 0;
        let zg = 0;
        let zbb = 0;
        let br = 0;
        let bg = 0;
        let bb = 0;
        for (let i = 0; i < n; i++) {
          const dx = LX[i] - px;
          const dy = LY[i] - py;
          const lz = LZ[i];
          const d2 = dx * dx + dy * dy;
          const a = d2 + lz * lz;
          const inv = 1 / (a * Math.sqrt(a));
          const wide = 1 / (d2 + zb2);
          const r = LR[i];
          const g = LG[i];
          const b = LB[i];
          const sx = dx * inv;
          const sy = dy * inv;
          const sz = lz * inv;
          xr += r * sx;
          xg += g * sx;
          xb += b * sx;
          yr += r * sy;
          yg += g * sy;
          yb += b * sy;
          zr += r * sz;
          zg += g * sz;
          zbb += b * sz;
          br += r * wide;
          bg += g * wide;
          bb += b * wide;
        }
        const o = (gy * gw + gx) * 12;
        F[o] = xr;
        F[o + 1] = xg;
        F[o + 2] = xb;
        F[o + 3] = yr;
        F[o + 4] = yg;
        F[o + 5] = yb;
        F[o + 6] = zr;
        F[o + 7] = zg;
        F[o + 8] = zbb;
        F[o + 9] = br;
        F[o + 10] = bg;
        F[o + 11] = bb;
      }
    }
    return { F, gw, gh, q, z, zb };
  }

  /** The field's twelve values at a pixel, interpolated, into `S`. */
  function fieldAt(field, x, y, S) {
    const { F, gw, q } = field;
    const fx = x / q;
    const fy = y / q;
    const gx = fx | 0;
    const gy = fy | 0;
    const tx = fx - gx;
    const ty = fy - gy;
    const o00 = (gy * gw + gx) * 12;
    const o10 = o00 + 12;
    const o01 = o00 + gw * 12;
    const o11 = o01 + 12;
    const w00 = (1 - tx) * (1 - ty);
    const w10 = tx * (1 - ty);
    const w01 = (1 - tx) * ty;
    const w11 = tx * ty;
    for (let k = 0; k < 12; k++) S[k] = F[o00 + k] * w00 + F[o10 + k] * w10 + F[o01 + k] * w01 + F[o11 + k] * w11;
    return S;
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // The wall and the backers, per pixel
  // ---------------------------------------------------------------------------------------------------------------------------------

  /**
   * The acrylic backers' outline: every tube stroked wide and every closed one filled, blurred and later read at its half value, so the
   * cut follows the sign smoothly and bridges the small gaps, as a router's contour cut does.
   */
  function backerMask(w, h, signs) {
    const m = L.canvas(w, h);
    const mc = m.getContext("2d");
    mc.fillStyle = "#fff";
    mc.strokeStyle = "#fff";
    mc.lineJoin = "round";
    mc.lineCap = "round";
    for (const s of signs) {
      if (s.noBacker) continue;
      for (const t of s.tubes) {
        const p = pathOf(t.full, t.closed);
        if (t.closed) mc.fill(p);
        mc.lineWidth = s.T * (s.margin ?? 4.4);
        mc.stroke(p);
      }
    }
    const b = L.canvas(w, h);
    const bc = b.getContext("2d");
    bc.filter = `blur(${Math.round(signs[0]?.T * 1.1 || 10)}px)`;
    bc.drawImage(m, 0, 0);
    const data = bc.getImageData(0, 0, w, h).data;
    const B = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) B[i] = data[i * 4 + 3] / 255;
    return B;
  }

  /**
   * Dark painted brick (or concrete), lit by the field: a height map for the bricks' relief and chips, an albedo with each brick a little
   * different and the paint worn here and there to the red brick under it, damp patches and streaks that shine; then the light, the
   * backers' clear acrylic over it, a filmic curve, and sRGB.
   */
  function paintWall(ctx, w, h, field, B, o) {
    const {
      seed,
      course,
      tint = [0.12, 0.1, 0.135],
      ambient = [0.016, 0.011, 0.028],
      expo = 1,
      kd = 5,
      kb = 0.12,
      bump = 0.45,
      wet = 0.35,
      concrete = false,
      ambientFrom = 0.3,
    } = o;
    const nA = L.simplex(seed);
    const nB = L.simplex(seed + 11);
    const nC = L.simplex(seed + 23);
    const nD = L.simplex(seed + 37);
    const H = new Float32Array(w * h);
    const AL = new Float32Array(w * h * 3);
    const WT = new Float32Array(w * h);
    const ch = course;
    const bl = course * 3.15;
    const mw = course * 0.17;
    const rad = mw * 0.75;
    const bev = mw * 0.75;
    for (let y = 0; y < h; y++) {
      const row = Math.floor(y / ch);
      const v = y - row * ch;
      const shift = (row & 1 ? 0.5 * bl : 0) + (hash(row, 7, seed) - 0.5) * bl * 0.1;
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const r1 = nA(x * 0.035, y * 0.035) * 0.4 + nA(x * 0.14 + 9, y * 0.14 + 4) * 0.3 + nA(x * 0.7, y * 0.7) * 0.3;
        const big = nD(x * 0.0012 + 3, y * 0.0016);
        // Damp: broad patches, and runs streaking down from them.
        const runs = L.smooth(0.25, 0.7, nC(x * 0.035 + 5, y * 0.0016)) * L.smooth(-0.3, 0.3, nC(x * 0.002, y * 0.002 + 9));
        const damp = Math.max(L.smooth(-0.15, 0.55, nC(x * 0.0022, y * 0.0011) + nC(x * 0.02 + 5, y * 0.0018) * 0.45), runs);
        let face;
        let bv;
        let wear = 0;
        if (concrete) {
          face = 1;
          bv = 0.9 + nB(x * 0.004, y * 0.004) * 0.12 + nB(x * 0.02, y * 0.02) * 0.06;
          H[i] = r1 * 0.5 + nB(x * 0.03, y * 0.03) * 0.8;
        } else {
          const X = x + shift;
          const col = Math.floor(X / bl);
          const u = X - col * bl;
          const qx = Math.abs(u - bl / 2) - (bl / 2 - mw / 2 - rad);
          const qy = Math.abs(v - ch / 2) - (ch / 2 - mw / 2 - rad);
          const ox = qx > 0 ? qx : 0;
          const oy = qy > 0 ? qy : 0;
          let sdf = Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - rad;
          sdf += nB(x * 0.022, y * 0.03) * mw * 0.45 + nB(x * 0.07 + 31, y * 0.07 - 17) * mw * 0.12;
          // A chip or two knocked out of some bricks' arrises: a ragged notch on an edge.
          for (let c = 0; c < 2; c++) {
            const hk = hash(row * 7 + c, col * 13 + c, seed + 91);
            if (hk > 0.2) continue;
            const side = Math.floor(hash(col + c, row, seed + 92) * 4);
            const along = hash(row, col + 3 * c, seed + 93);
            const cu = side < 2 ? mw / 2 + along * (bl - mw) : side === 2 ? mw / 2 : bl - mw / 2;
            const cv = side === 0 ? mw / 2 : side === 1 ? ch - mw / 2 : mw / 2 + along * (ch - mw);
            const rc = mw * (0.7 + hash(c, row + col, seed + 94) * 1.1);
            const dd = Math.hypot(u - cu, (v - cv) * 1.3) + nB(x * 0.08 + c * 40, y * 0.08) * mw * 0.3;
            sdf = Math.max(sdf, rc - dd);
          }
          face = L.smooth(mw * 0.25, -bev, sdf);
          const hb = hash(row, col, seed);
          const hc = hash(col, row, seed + 5);
          bv = 0.7 + hb * 0.5;
          wear = L.smooth(0.5, 0.68, nC(x * 0.004 + hb * 9, y * 0.006) * 0.75 + nA(x * 0.03, y * 0.03) * 0.25) * face * (hc > 0.7 ? 0.9 : 0.15);
          const tilt = (hc - 0.5) * 0.9;
          H[i] = face * mw * 0.55 + face * (r1 * mw * 0.06 + tilt * (u / bl - 0.5) * mw * 0.12) - wear * mw * 0.08 + (1 - face) * r1 * mw * 0.1;
        }
        const k = (face * bv * (1 + r1 * 0.16) + (1 - face) * (0.46 + r1 * 0.12)) * (0.84 + 0.16 * big);
        let ar = tint[0] * k;
        let ag = tint[1] * k;
        let ab = tint[2] * k;
        if (wear > 0) {
          ar = L.mix(ar, 0.26 * bv, wear * 0.7);
          ag = L.mix(ag, 0.085 * bv, wear * 0.7);
          ab = L.mix(ab, 0.07 * bv, wear * 0.7);
        }
        // Damp darkens the paint a little and makes it shine.
        const dk = 1 - damp * 0.18;
        AL[i * 3] = ar * dk;
        AL[i * 3 + 1] = ag * dk;
        AL[i * 3 + 2] = ab * dk;
        WT[i] = damp * wet * (0.65 + 0.35 * face);
      }
    }
    const img = ctx.createImageData(w, h);
    const D = img.data;
    const S = new Float32Array(12);
    const kdz = (field.z / 2) * kd;
    const kbz = (field.zb / Math.PI) * kb;
    field.kdz = kdz;
    field.kbz = kbz;
    const amb = ambient;
    for (let y = 0; y < h; y++) {
      const ambY = 1 - ambientFrom + ambientFrom * (1 - y / h);
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const xl = x > 0 ? i - 1 : i;
        const xr = x < w - 1 ? i + 1 : i;
        const yu = y > 0 ? i - w : i;
        const yd = y < h - 1 ? i + w : i;
        let nx = -(H[xr] - H[xl]) * 0.5 * bump;
        let ny = -(H[yd] - H[yu]) * 0.5 * bump;
        const ninv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
        nx *= ninv;
        ny *= ninv;
        const nz = ninv;
        fieldAt(field, x, y, S);
        let er = Math.max(0, nx * S[0] + ny * S[3] + nz * S[6]) * kdz + S[9] * kbz + amb[0] * ambY * (0.75 + 0.25 * nz - 0.2 * ny);
        let eg = Math.max(0, nx * S[1] + ny * S[4] + nz * S[7]) * kdz + S[10] * kbz + amb[1] * ambY * (0.75 + 0.25 * nz - 0.2 * ny);
        let eb = Math.max(0, nx * S[2] + ny * S[5] + nz * S[8]) * kdz + S[11] * kbz + amb[2] * ambY * (0.75 + 0.25 * nz - 0.2 * ny);
        let cr = AL[i * 3] * er;
        let cg = AL[i * 3 + 1] * eg;
        let cb = AL[i * 3 + 2] * eb;
        // Wet sheen: the light's glint on the damp relief, toward the light's main direction.
        const wt = WT[i];
        if (wt > 0.002) {
          const lx = S[0] + S[1] + S[2];
          const ly = S[3] + S[4] + S[5];
          const lz = S[6] + S[7] + S[8];
          const ll = Math.sqrt(lx * lx + ly * ly + lz * lz) || 1;
          let hx = lx / ll;
          let hy = ly / ll;
          let hz = lz / ll + 1;
          const hl = Math.sqrt(hx * hx + hy * hy + hz * hz);
          hx /= hl;
          hy /= hl;
          hz /= hl;
          // The water's own fine relief, tilting the glint about.
          const mx = nx + nD(x * 0.33, y * 0.33) * 0.42;
          const my = ny + nD(x * 0.33 + 50, y * 0.33 - 50) * 0.42;
          const ml = 1 / Math.sqrt(mx * mx + my * my + nz * nz);
          const nh = Math.max(0, (mx * hx + my * hy + nz * hz) * ml);
          const nh2 = nh * nh;
          const nh8 = nh2 * nh2 * nh2 * nh2;
          const sp = (nh8 * nh8 * 0.6 + nh8 * 0.1) * wt * kdz * 0.14;
          cr += sp * Math.hypot(S[0], S[3], S[6]);
          cg += sp * Math.hypot(S[1], S[4], S[7]);
          cb += sp * Math.hypot(S[2], S[5], S[8]);
        }
        // The clear acrylic backer: a faint face, a cut edge that catches the light, a hairline of shade inside it, and its shadow.
        if (B) {
          const b = B[i];
          const sh = y > 10 ? B[i - 10 * w + 3] : 0;
          if (b > 0.003 || sh > 0.003) {
            const gx = (B[xr] - B[xl]) * 0.5;
            const gy = (B[yd] - B[yu]) * 0.5;
            const gl = Math.sqrt(gx * gx + gy * gy);
            const sd = (b - 0.5) / Math.max(gl, 0.004);
            const inside = L.clamp(sd + 0.5);
            const shade = L.smooth(0.25, 0.75, sh) * (1 - inside) * 0.22;
            cr *= 1 - shade;
            cg *= 1 - shade;
            cb *= 1 - shade;
            if (b > 0.05) {
              const lr = S[6] * kdz + S[9] * kbz;
              const lg = S[7] * kdz + S[10] * kbz;
              const lb = S[8] * kdz + S[11] * kbz;
              const band = Math.exp(-(sd / 1.15) * (sd / 1.15));
              const hair = Math.exp(-((sd - 2.6) / 1) * ((sd - 2.6) / 1));
              const ox2 = -gx / Math.max(gl, 1e-6);
              const oy2 = -gy / Math.max(gl, 1e-6);
              const facing = Math.max(0, ox2 * -0.55 + oy2 * -0.83);
              const tint2 = inside * 0.93 + (1 - inside);
              cr = cr * tint2 * (1 - hair * 0.4) + inside * lr * 0.0005 + band * (lr * 0.02 + facing * 0.012 + 0.0015);
              cg = cg * tint2 * (1 - hair * 0.4) + inside * lg * 0.0005 + band * (lg * 0.02 + facing * 0.012 + 0.0015);
              cb = cb * tint2 * (1 - hair * 0.4) + inside * lb * 0.0005 + band * (lb * 0.02 + facing * 0.013 + 0.0018);
            }
          }
        }
        // A filmic shoulder, then sRGB.
        const o4 = i * 4;
        D[o4] = enc(1 - Math.exp(-cr * expo));
        D[o4 + 1] = enc(1 - Math.exp(-cg * expo));
        D[o4 + 2] = enc(1 - Math.exp(-cb * expo));
        D[o4 + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Hardware and glass
  // ---------------------------------------------------------------------------------------------------------------------------------

  /** The colour of the light at a point, as an sRGB triple scaled to its brightest channel, and how strong it is. */
  function lightColourAt(field, x, y) {
    const S = fieldAt(field, Math.max(0, x), Math.max(0, y), new Float32Array(12));
    const kdz = field.kdz ?? 1;
    const kbz = field.kbz ?? 3;
    const r = S[6] * kdz + S[9] * kbz;
    const g = S[7] * kdz + S[10] * kbz;
    const b = S[8] * kdz + S[11] * kbz;
    const m = Math.max(r, g, b, 1e-9);
    return { rgb: [r / m, g / m, b / m].map((v) => Math.pow(v, 1 / 2.2) * 255), strength: m };
  }

  /** A brushed-steel standoff cap seen face on: a flat disc with a bevelled rim, coloured by the sign's light, and its shadow. */
  function standoff(ctx, x, y, r, field) {
    const { rgb, strength } = lightColourAt(field, x, y);
    const lit = L.clamp(Math.sqrt(strength) * 0.5, 0.22, 0.95);
    ctx.save();
    const sh = ctx.createRadialGradient(x + r * 0.25, y + r * 0.5, r * 0.5, x + r * 0.25, y + r * 0.5, r * 1.9);
    sh.addColorStop(0, "rgba(0,0,0,0.6)");
    sh.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = sh;
    ctx.beginPath();
    ctx.arc(x + r * 0.25, y + r * 0.5, r * 1.9, 0, TAU);
    ctx.fill();
    // The barrel's rim, dark, then the cap's face: brushed, a gradient across it.
    ctx.fillStyle = "#09080c";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    const face = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
    const tone = (k) => css(mixRgb(rgb.map((v) => v * lit * k), [120, 120, 130].map((v) => v * lit * k), 0.45));
    face.addColorStop(0, tone(1.15));
    face.addColorStop(0.45, tone(0.62));
    face.addColorStop(0.55, tone(0.78));
    face.addColorStop(1, tone(0.32));
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.8, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = "lighter";
    // The bevel catching the light on one side, and a fine bright edge.
    ctx.lineWidth = r * 0.16;
    ctx.strokeStyle = css(rgb, 0.5 * lit + 0.15);
    ctx.beginPath();
    ctx.arc(x, y, r * 0.89, -Math.PI * 0.95, -Math.PI * 0.1);
    ctx.stroke();
    ctx.lineWidth = Math.max(1, r * 0.06);
    ctx.strokeStyle = css(mixRgb(rgb, [255, 255, 255], 0.6), 0.55);
    ctx.beginPath();
    ctx.arc(x, y, r * 0.8, -Math.PI * 0.85, -Math.PI * 0.45);
    ctx.stroke();
    ctx.restore();
  }

  /** The sign's power lead: a dark cable from the backer's foot down out of the picture, its edge catching the light. */
  function cable(ctx, sign, h, field, B, w) {
    const [bx0, , bx1, by1] = sign.box;
    const cx = (bx0 + bx1) / 2 + (bx1 - bx0) * 0.12;
    let sy = by1;
    if (B) {
      for (let yy = Math.min(h - 2, Math.round(by1 + sign.T * 4)); yy > by1 - sign.T * 8; yy--) {
        if (B[yy * w + Math.round(cx)] > 0.5) {
          sy = yy - sign.T * 0.6;
          break;
        }
      }
    }
    const p = new Path2D();
    p.moveTo(cx, sy);
    p.bezierCurveTo(cx + 4, sy + (h - sy) * 0.45, cx + sign.T * 5, sy + (h - sy) * 0.55, cx + sign.T * 4, h + 40);
    const { rgb } = lightColourAt(field, cx, sy + 20);
    ctx.save();
    ctx.lineCap = "round";
    ctx.filter = `blur(${sign.T * 0.5}px)`;
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = sign.T * 0.5;
    ctx.translate(sign.T * 0.5, sign.T * 0.9);
    ctx.stroke(p);
    ctx.restore();
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = "#07060a";
    ctx.lineWidth = sign.T * 0.36;
    ctx.stroke(p);
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = css(rgb, 0.35);
    ctx.lineWidth = sign.T * 0.08;
    ctx.translate(-sign.T * 0.09, 0);
    ctx.stroke(p);
    ctx.restore();
    // The grommet where it leaves the acrylic.
    ctx.fillStyle = "#0b0a0f";
    ctx.beginPath();
    ctx.arc(cx, sy, sign.T * 0.42, 0, TAU);
    ctx.fill();
  }

  /** The black-painted ends of the tubes and the glass turning back through the acrylic. */
  function tubeEnds(ctx, sign, field) {
    const T = sign.T;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const t of sign.tubes) {
      for (const run of t.dark) {
        const p = pathOf(run);
        ctx.strokeStyle = "#0a090d";
        ctx.lineWidth = T * 0.96;
        ctx.stroke(p);
      }
      for (const [ex, ey] of t.ends) {
        ctx.fillStyle = "#050407";
        ctx.beginPath();
        ctx.arc(ex, ey, T * 0.58, 0, TAU);
        ctx.fill();
      }
    }
    // Glass highlights on the painted parts, in the light of the sign.
    ctx.globalCompositeOperation = "lighter";
    for (const t of sign.tubes) {
      const { rgb } = lightColourAt(field, t.ends[0][0], t.ends[0][1]);
      for (const run of t.dark) {
        const p = pathOf(run);
        ctx.save();
        ctx.translate(-T * 0.2, -T * 0.22);
        ctx.strokeStyle = css(mixRgb(rgb, [255, 255, 255], 0.45), 0.28);
        ctx.lineWidth = T * 0.16;
        ctx.stroke(p);
        ctx.restore();
      }
      for (const [ex, ey] of t.ends) {
        ctx.strokeStyle = css(rgb, 0.35);
        ctx.lineWidth = T * 0.1;
        ctx.beginPath();
        ctx.arc(ex, ey, T * 0.5, -Math.PI * 0.9, -Math.PI * 0.2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /**
   * The lit glass: from a wide haze in the air to the tube's saturated body, its brighter core and a near-white centre, each pass added
   * to the light already there.
   */
  function tubeGlow(ctx, sign, { haze = 1, bloom = 1, core: coreK = 1 } = {}) {
    const T = sign.T;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation = "lighter";
    for (const t of sign.tubes) {
      const rgb = L.hexRgb(t.color);
      const p = POWER[t.color] ?? 1;
      const core = mixRgb(rgb, [255, 255, 255], 0.62);
      const hot = mixRgb(rgb, [255, 255, 255], 0.9);
      const paths = t.lit.map((run) => pathOf(run));
      const passes = [
        [T * 10, T * 10, 0.085 * haze * p, rgb],
        [T * 4.5, T * 3.4, 0.2 * bloom * p, rgb],
        [T * 2.1, T * 1.2, 0.4 * bloom * p, rgb],
        [T * 1.25, T * 0.35, 0.6 * p, rgb],
        [T * 0.95, 0.7, 0.85, rgb],
        [T * 0.62 * coreK, T * 0.12, 0.8, core],
        [T * 0.3 * coreK, T * 0.05, 0.85, hot],
      ];
      for (const [lw, blur, alpha, col] of passes) {
        ctx.filter = blur > 0.4 ? `blur(${blur.toFixed(2)}px)` : "none";
        ctx.lineWidth = lw;
        ctx.strokeStyle = css(col, Math.min(1, alpha));
        for (const path of paths) ctx.stroke(path);
      }
    }
    ctx.restore();
  }

  function vignette(ctx, w, h, { strength = 0.55, cx = 0.5, cy = 0.5, inner = 0.35 } = {}) {
    const g = ctx.createRadialGradient(w * cx, h * cy, Math.min(w, h) * inner, w * cx, h * cy, Math.hypot(w, h) * 0.62);
    g.addColorStop(0, "rgba(4,2,8,0)");
    g.addColorStop(1, `rgba(4,2,8,${strength})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  /**
   * A wall of signs: the signs placed, their light worked out on the wall, the backers, the hardware and the glass. `signs` are
   * `{ key, x, y, size, rot }` with `x`, `y` and `size` in pixels.
   */
  function signWall(ctx, w, h, { seed, course, T, z, zb, signs, wall = {}, cables = false, q = 4, expo = 1, glow = {} }) {
    const placed = signs.map((s) => ({ ...place(s.key, { ...s, T: s.T ?? T }), gain: s.gain ?? 1 }));
    const lights = lightsOf(placed, Math.max(3, T * 0.45));
    const field = lightField(w, h, lights, { q, z, zb });
    const B = backerMask(w, h, placed);
    paintWall(ctx, w, h, field, B, { seed, course, expo, ...wall });
    if (cables) for (const s of placed) cable(ctx, s, h, field, B, w);
    for (const s of placed) {
      for (const [x, y] of s.standoffs) standoff(ctx, x, y, s.T * 1.05, field);
    }
    for (const s of placed) tubeEnds(ctx, s, field);
    for (const s of placed) tubeGlow(ctx, s, glow);
    return { placed, field };
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // The pictures: signs on the wall
  // ---------------------------------------------------------------------------------------------------------------------------------

  const PRODUCTS = {
    "sign-lightning": "bolt",
    "sign-crescent": "crescent",
    "sign-palm": "palm",
    "sign-heart": "heart",
    "sign-star": "star",
    "sign-joystick": "joystick",
    "sign-cassette": "cassette",
    "sign-cherries": "cherries",
  };
  /** The same wall, camera and hardware for all eight; a sign of open shape is drawn a little larger so they weigh alike. */
  const PRODUCT_SIZE = { star: 720, bolt: 660 };
  let productSeed = 500;
  for (const [name, key] of Object.entries(PRODUCTS)) {
    const seed = (productSeed += 17);
    ART[name] = {
      w: 1200,
      h: 1200,
      quality: 80,
      draw(ctx, w, h) {
        signWall(ctx, w, h, {
          seed,
          course: 54,
          T: 15,
          z: 52,
          zb: 340,
          signs: [{ key, x: w / 2, y: h * 0.485, size: PRODUCT_SIZE[key] ?? 640 }],
          cables: true,
          expo: 1,
          wall: {},
        });
        vignette(ctx, w, h, { strength: 0.6, inner: 0.3 });
        L.grain(ctx, w, h, seed, 5);
      },
    };
  }

  ART.wall = {
    w: 2400,
    h: 1200,
    quality: 76,
    draw(ctx, w, h) {
      signWall(ctx, w, h, {
        seed: 900,
        course: 46,
        T: 12,
        z: 44,
        zb: 300,
        q: 5,
        signs: [
          { key: "heart", x: w * 0.13, y: h * 0.53, size: 450 },
          { key: "bolt", x: w * 0.3, y: h * 0.37, size: 290, rot: 0.2, gain: 0.9 },
          { key: "crescent", x: w * 0.86, y: h * 0.5, size: 500 },
        ],
        wall: { wet: 0.6 },
      });
      vignette(ctx, w, h, { strength: 0.5, inner: 0.25 });
      L.grain(ctx, w, h, 901, 5);
    },
  };

  ART["tile-retro"] = {
    w: 1200,
    h: 900,
    quality: 80,
    draw(ctx, w, h) {
      signWall(ctx, w, h, {
        seed: 610,
        course: 40,
        T: 11,
        z: 40,
        zb: 260,
        wall: { kd: 3.6, kb: 0.08 },
        signs: [
          { key: "joystick", x: w * 0.3, y: h * 0.53, size: 420 },
          { key: "cassette", x: w * 0.72, y: h * 0.3, size: 360, rot: -0.06 },
          { key: "cherries", x: w * 0.74, y: h * 0.74, size: 290, rot: 0.08 },
        ],
      });
      vignette(ctx, w, h, { strength: 0.7, inner: 0.28 });
      L.grain(ctx, w, h, 611, 5);
    },
  };

  ART["tile-night"] = {
    w: 1200,
    h: 900,
    quality: 80,
    draw(ctx, w, h) {
      signWall(ctx, w, h, {
        seed: 620,
        course: 40,
        T: 11,
        z: 40,
        zb: 260,
        wall: { kd: 3.6, kb: 0.08 },
        signs: [
          { key: "palm", x: w * 0.32, y: h * 0.5, size: 560 },
          { key: "crescent", x: w * 0.74, y: h * 0.31, size: 300 },
          { key: "bolt", x: w * 0.76, y: h * 0.75, size: 270, rot: 0.3 },
        ],
      });
      vignette(ctx, w, h, { strength: 0.7, inner: 0.28 });
      L.grain(ctx, w, h, 621, 5);
    },
  };

  ART["tile-love"] = {
    w: 1200,
    h: 900,
    quality: 80,
    draw(ctx, w, h) {
      signWall(ctx, w, h, {
        seed: 630,
        course: 40,
        T: 11,
        z: 40,
        zb: 260,
        wall: { kd: 4, kb: 0.1 },
        signs: [
          { key: "heart", x: w * 0.34, y: h * 0.56, size: 460, rot: -0.08 },
          { key: "star", x: w * 0.75, y: h * 0.27, size: 380, rot: -0.05 },
        ],
      });
      vignette(ctx, w, h, { strength: 0.7, inner: 0.28 });
      L.grain(ctx, w, h, 631, 5);
    },
  };

  // ---------------------------------------------------------------------------------------------------------------------------------
  // The hero: a synthwave night
  // ---------------------------------------------------------------------------------------------------------------------------------

  /**
   * A grid floor drawn per pixel in perspective, each line's coverage worked out from its true distance to the pixel (so the far grid
   * fades into an even glow rather than shimmering), warmer near the sun's axis. Returns a canvas of light to add.
   */
  function gridFloor(w, h, hy, vx, f, { S, lineW, near, far, warm, warmAxis, warmWidth }) {
    const gh = h - hy;
    const grid = L.canvas(w, gh);
    const gc = grid.getContext("2d");
    const gi = gc.createImageData(w, gh);
    const GD = gi.data;
    const cover = (d, wpx, spacing) => {
      const ww = Math.max(wpx, 0.75);
      const i = (Math.min(wpx, ww) / ww) * Math.exp(-(d / ww) * (d / ww));
      return L.mix((2 * wpx) / spacing, i, L.smooth(2.5, 9, spacing));
    };
    for (let yy = 0; yy < gh; yy++) {
      const dy = yy + 0.5;
      const Z = f / dy;
      const pxZ = (dy * dy) / f;
      const zz = Z / S;
      const ih = cover(Math.abs(zz - Math.round(zz)) * S * pxZ, lineW * pxZ, S * pxZ);
      const pxX = f / Z;
      const fog = Math.exp(-Z / 30);
      const t = L.smooth(0, 1, Math.min(1, Math.log(Z) / Math.log(70)));
      const base = mixRgb(near, far, t);
      const bright = 0.3 + 0.7 * fog + 0.25 * (1 - t);
      const heat = Math.exp(-dy / (gh * 0.55));
      for (let xx = 0; xx < w; xx++) {
        const X = ((xx + 0.5 - vx) * Z) / f;
        const xl = Math.round(X / S) * S;
        const slant = 1 / Math.sqrt(1 + xl * xl);
        const iv = cover(Math.abs(X - xl) * pxX * slant, lineW * pxX * slant, S * pxX * slant);
        const I = Math.min(1, ih + iv) * bright;
        const wk = Math.exp(-Math.pow((xx - warmAxis) / warmWidth, 2)) * heat;
        const o = (yy * w + xx) * 4;
        GD[o] = L.mix(base[0], warm[0], wk);
        GD[o + 1] = L.mix(base[1], warm[1], wk);
        GD[o + 2] = L.mix(base[2], warm[2], wk);
        GD[o + 3] = Math.round(I * 255);
      }
    }
    gc.putImageData(gi, 0, 0);
    return grid;
  }

  /** Thin clouds as a mask of stretched noise in a few bands. */
  function cloudLayer(w, h, seed, bands) {
    const q = 2;
    const cw = Math.ceil(w / q);
    const chh = Math.ceil(h / q);
    const c = L.canvas(cw, chh);
    const cc = c.getContext("2d");
    const img = cc.createImageData(cw, chh);
    const n = L.simplex(seed);
    for (let y = 0; y < chh; y++) {
      const Y = y * q;
      let env = 0;
      for (const b of bands) env = Math.max(env, Math.exp(-Math.pow((Y - b.y) / b.th, 2)) * b.a);
      if (env < 0.01) continue;
      for (let x = 0; x < cw; x++) {
        const X = x * q;
        let hx = 0;
        for (const b of bands) {
          const e = Math.exp(-Math.pow((Y - b.y) / b.th, 2));
          hx = Math.max(hx, e * L.smooth(b.x0, b.x0 + (b.x1 - b.x0) * 0.25, X) * (1 - L.smooth(b.x1 - (b.x1 - b.x0) * 0.3, b.x1, X)));
        }
        const v = L.fbm(n, X * 0.0028, Y * 0.045, 5) + L.fbm(n, X * 0.011 + 5, Y * 0.09, 3) * 0.35;
        const a = L.smooth(-0.05, 0.45, v) * hx * env;
        const o = (y * cw + x) * 4;
        img.data[o] = 255;
        img.data[o + 1] = 255;
        img.data[o + 2] = 255;
        img.data[o + 3] = Math.round(L.clamp(a) * 255);
      }
    }
    cc.putImageData(img, 0, 0);
    return c;
  }

  /** A canvas of `src`'s shape filled with one colour. */
  function tinted(src, color) {
    const c = L.canvas(src.width, src.height);
    const cc = c.getContext("2d");
    cc.drawImage(src, 0, 0);
    cc.globalCompositeOperation = "source-in";
    cc.fillStyle = color;
    cc.fillRect(0, 0, c.width, c.height);
    return c;
  }

  ART.hero = {
    w: 2560,
    h: 1440,
    quality: 80,
    draw(ctx, w, h) {
      const hy = Math.round(h * 0.64);
      const vx = w * 0.68;
      const R = h * 0.2;
      const cy = hy - R * 0.72;
      const f = h * 0.95;
      const random = L.rng(1201);

      // The sky, deepening upward, hot at the horizon, with a faint violet haze and stars thinning toward the glow.
      const sky = ctx.createLinearGradient(0, 0, 0, hy);
      sky.addColorStop(0, "#04020a");
      sky.addColorStop(0.35, "#0b0520");
      sky.addColorStop(0.6, "#1c0a3a");
      sky.addColorStop(0.8, "#41105a");
      sky.addColorStop(0.93, "#7c1a6e");
      sky.addColorStop(1, "#c42a86");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, hy);
      L.nebula(ctx, w, hy, 1203, {
        colors: ["#170733", "#38105e", "#6a1a7a", "#3a1a8a"],
        mask: (u, v) => L.smooth(0.15, 0.95, v) * (0.25 + 0.75 * L.smooth(0.25, 0.8, u)),
        scale: 1.6,
        strength: 0.6,
        detail: 6,
        blur: 26,
      });
      const skyStars = (x, y) => (1 - L.smooth(0.3, 0.88, y / hy)) * (0.5 + 0.5 * L.smooth(0, 0.45, x / w)) * (1 - 0.85 * Math.exp(-Math.pow(Math.hypot(x - vx, y - cy) / (R * 2.4), 2)));
      L.stars(ctx, w, hy, L.rng(1204), { count: 3400, max: 1.3, alpha: 0.85, where: skyStars });
      L.stars(ctx, w, hy, L.rng(1205), { count: 60, max: 2.1, spikes: 4, where: skyStars });

      // The sun's glow, then the sun, striped across its lower half.
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const glow = ctx.createRadialGradient(vx, cy, R * 0.85, vx, cy, R * 3.6);
      glow.addColorStop(0, "rgba(255,80,150,0.5)");
      glow.addColorStop(0.25, "rgba(255,45,170,0.2)");
      glow.addColorStop(1, "rgba(110,20,140,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, hy);
      ctx.restore();
      const sun = L.canvas(Math.ceil(R * 2 + 4), Math.ceil(R * 2 + 4));
      const sc = sun.getContext("2d");
      const so = R + 2;
      const sg = sc.createLinearGradient(0, so - R, 0, so + R * 0.72);
      sg.addColorStop(0, "#fff6b0");
      sg.addColorStop(0.16, NEON.yellow);
      sg.addColorStop(0.5, NEON.orange);
      sg.addColorStop(0.8, "#ff3f8f");
      sg.addColorStop(1, NEON.pink);
      sc.fillStyle = sg;
      sc.beginPath();
      sc.arc(so, so, R, 0, TAU);
      sc.fill();
      sc.globalCompositeOperation = "destination-out";
      for (let k = 0; k < 8; k++) {
        const t = k / 7;
        const yy = so + R * (0.04 + t * 0.66);
        const gap = 2.5 + t * t * R * 0.075;
        sc.fillRect(0, yy - gap / 2, R * 2 + 4, gap);
      }
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.filter = `blur(${R * 0.14}px)`;
      ctx.globalAlpha = 0.7;
      ctx.drawImage(sun, vx - so, cy - so);
      ctx.restore();
      ctx.drawImage(sun, vx - so, cy - so);

      // Thin clouds drifting across the sun, their undersides lit.
      const clouds = cloudLayer(w, hy, 1207, [
        { y: cy - R * 0.5, th: R * 0.07, a: 0.95, x0: vx - R * 3.2, x1: vx + R * 2.2 },
        { y: cy - R * 0.12, th: R * 0.05, a: 0.85, x0: vx - R * 1.6, x1: vx + R * 3.4 },
        { y: cy + R * 0.32, th: R * 0.04, a: 0.7, x0: vx - R * 3.6, x1: vx + R * 1.1 },
        { y: hy * 0.3, th: R * 0.09, a: 0.45, x0: w * 0.05, x1: w * 0.62 },
      ]);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.55;
      ctx.drawImage(tinted(clouds, "#ff6a9a"), 0, R * 0.012, w, hy);
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = 0.92;
      ctx.drawImage(tinted(clouds, "#1a0730"), 0, -R * 0.012, w, hy);
      ctx.restore();

      // Distant mountains: low by the sun, rising to both sides, a rim of light along their ridge.
      const nM = L.simplex(1209);
      const ridge = (x) => {
        const d = Math.abs(x - vx) / w;
        const env = 0.15 + L.smooth(0.06, 0.45, d) * 0.85;
        const n = L.fbm(nM, x * 0.0016, 0.3, 5);
        const peaks = 1 - Math.abs(L.fbm(nM, x * 0.0009 + 7, 1.7, 4));
        return hy - h * 0.1 * env * (0.45 + 0.35 * n + 0.45 * peaks * peaks);
      };
      const mPath = new Path2D();
      mPath.moveTo(0, hy + 2);
      for (let x = 0; x <= w; x += 4) mPath.lineTo(x, ridge(x));
      mPath.lineTo(w, hy + 2);
      mPath.closePath();
      const mg = ctx.createLinearGradient(0, hy - h * 0.12, 0, hy);
      mg.addColorStop(0, "#26103f");
      mg.addColorStop(1, "#4a1660");
      ctx.fillStyle = mg;
      ctx.fill(mPath);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.lineWidth = 2;
      ctx.filter = "blur(1.5px)";
      const rim = ctx.createLinearGradient(0, 0, w, 0);
      rim.addColorStop(0, "rgba(170,80,255,0.15)");
      rim.addColorStop(vx / w - 0.2, "rgba(255,90,200,0.45)");
      rim.addColorStop(vx / w, "rgba(255,140,170,0.8)");
      rim.addColorStop(vx / w + 0.2, "rgba(255,90,200,0.45)");
      rim.addColorStop(1, "rgba(170,80,255,0.2)");
      ctx.strokeStyle = rim;
      const rPath = new Path2D();
      for (let x = 0; x <= w; x += 4) (x === 0 ? rPath.moveTo.bind(rPath) : rPath.lineTo.bind(rPath))(x, ridge(x));
      ctx.stroke(rPath);
      ctx.restore();

      // The city on the horizon in front of the sun: stepped towers, a few spires, lit windows.
      const city = new Path2D();
      const windows = [];
      let x = vx - R * 1.75;
      while (x < vx + R * 1.85) {
        const bw = 16 + random() * 38;
        const tall = Math.exp(-Math.pow((x - vx) / (R * 1.3), 2));
        const bh = 16 + random() * 34 * (0.4 + tall) + (random() < 0.14 ? 46 + random() * 46 : 0);
        city.rect(x, hy - bh, bw, bh + 2);
        if (bh > 50 && random() < 0.6) city.rect(x + bw * 0.2, hy - bh - 10, bw * 0.6, 12);
        if (random() < 0.18) city.rect(x + bw * 0.45, hy - bh - 18 - random() * 20, 2.2, 32);
        for (let wy = hy - bh + 5; wy < hy - 4; wy += 6) {
          for (let wx = x + 3; wx < x + bw - 3; wx += 5) {
            if (random() < 0.1) windows.push([wx, wy, random()]);
          }
        }
        x += bw + (random() < 0.3 ? random() * 7 : 0);
      }
      ctx.fillStyle = "#0c0515";
      ctx.fill(city);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const [wx, wy, k] of windows) {
        ctx.fillStyle = k < 0.55 ? "rgba(255,214,120,0.85)" : k < 0.8 ? "rgba(34,228,255,0.8)" : "rgba(255,43,214,0.85)";
        ctx.fillRect(wx, wy, 2, 3);
      }
      ctx.restore();

      // The floor: dark wet glass.
      const floor = ctx.createLinearGradient(0, hy, 0, h);
      floor.addColorStop(0, "#2c0a38");
      floor.addColorStop(0.12, "#13061f");
      floor.addColorStop(1, "#05020a");
      ctx.fillStyle = floor;
      ctx.fillRect(0, hy, w, h - hy);

      // The sun in the wet floor: its mirror image, broken into ripples and fading toward us.
      const refl = L.canvas(w, h - hy);
      const rc = refl.getContext("2d");
      const nR = L.simplex(1211);
      const sunTop = cy - R;
      for (let yy = 0; yy < hy - sunTop; yy++) {
        const srcY = hy - 1 - yy - (cy - so);
        if (srcY < 0 || srcY >= sun.height) continue;
        const ripple = nR(yy * 0.08, 1.3) * (4 + yy * 0.08) + nR(yy * 0.35, 7.1) * 2;
        const streak = 0.15 + 0.85 * L.smooth(-0.15, 0.55, nR(yy * 0.13, 3.3)) * (0.6 + 0.4 * Math.sin(yy * 0.9));
        const fade = Math.exp(-yy / (R * 0.55));
        rc.globalAlpha = L.clamp(streak * fade);
        const squash = 1 + yy * 0.0025;
        rc.drawImage(sun, 0, srcY, sun.width, 1, vx - so * squash + ripple, yy, sun.width * squash, 1);
      }
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.filter = "blur(1.2px)";
      ctx.drawImage(refl, 0, hy);
      ctx.filter = "blur(14px)";
      ctx.globalAlpha = 0.5;
      ctx.drawImage(refl, 0, hy);
      ctx.restore();
      // The sun's path on the wet floor: a soft column of light under it.
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const path = ctx.createLinearGradient(0, hy, 0, h);
      path.addColorStop(0, "rgba(255,70,170,0.32)");
      path.addColorStop(0.3, "rgba(255,90,120,0.12)");
      path.addColorStop(1, "rgba(255,90,120,0)");
      ctx.fillStyle = path;
      ctx.filter = `blur(${R * 0.25}px)`;
      ctx.beginPath();
      ctx.moveTo(vx - R * 0.8, hy);
      ctx.lineTo(vx + R * 0.8, hy);
      ctx.lineTo(vx + R * 1.5, h);
      ctx.lineTo(vx - R * 1.5, h);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      // The city's lights, drawn out into streaks on the wet floor.
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const [wx, , k] of windows) {
        if (random() > 0.35) continue;
        const len = 20 + random() * 50;
        const g = ctx.createLinearGradient(0, hy, 0, hy + len);
        const col = k < 0.55 ? "255,214,120" : k < 0.8 ? "34,228,255" : "255,43,214";
        g.addColorStop(0, `rgba(${col},0.35)`);
        g.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(wx, hy + 1, 2, len);
      }
      ctx.restore();

      // The grid.
      const grid = gridFloor(w, h, hy, vx, f, {
        S: 0.6,
        lineW: 0.011,
        near: L.hexRgb("#a04cff"),
        far: L.hexRgb("#ff3fd0"),
        warm: L.hexRgb("#ff8a6a"),
        warmAxis: vx,
        warmWidth: R * 1.1,
      });
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.filter = "blur(12px)";
      ctx.globalAlpha = 0.85;
      ctx.drawImage(grid, 0, hy);
      ctx.filter = "blur(3.5px)";
      ctx.globalAlpha = 0.8;
      ctx.drawImage(grid, 0, hy);
      ctx.filter = "none";
      ctx.globalAlpha = 1;
      ctx.drawImage(grid, 0, hy);
      ctx.restore();

      // Wireframe mountains standing on the grid to both sides of the sun, drawn far to near so the nearer ridges hide the farther.
      const terrain = L.canvas(w, h);
      const tc = terrain.getContext("2d");
      const nT = L.simplex(1213);
      const rows = 28;
      const Zfar = 64;
      const Znear = 12;
      const dX = 0.5;
      const envAt = (xs) => {
        const right = L.smooth(vx + R * 1.25, vx + R * 2.7, xs);
        const left = L.smooth(vx - R * 1.3, vx - R * 2.3, xs) * L.smooth(w * 0.1, w * 0.4, xs) * 0.62;
        return Math.max(right, left);
      };
      const heightAt = (X, Z) => {
        const xs = vx + (X * f) / Z;
        const e = envAt(xs);
        if (e <= 0) return 0;
        const ridged = 1 - Math.abs(L.fbm(nT, X * 0.045, Z * 0.05, 4));
        const body = (L.fbm(nT, X * 0.018 + 9, Z * 0.02, 3) + 1) / 2;
        const taper = L.smooth(Znear, Znear * 2.1, Z);
        const raw = e * taper * (0.25 * body + 0.75 * ridged * ridged) - 0.12;
        return raw > 0 ? raw * (0.9 + 0.2 * Z) : 0;
      };
      const project = (X, Z, H) => [vx + (X * f) / Z, hy + (f * (1 - H)) / Z];
      let prev = null;
      for (let i = 0; i <= rows; i++) {
        const Z = Zfar * Math.pow(Znear / Zfar, i / rows);
        const kmin = Math.floor(((-60 - vx) * Z) / f / dX);
        const kmax = Math.ceil(((w + 60 - vx) * Z) / f / dX);
        const row = new Map();
        for (let k = kmin; k <= kmax; k++) {
          const X = k * dX;
          const H = heightAt(X, Z);
          row.set(k, { H, p: project(X, Z, H), base: project(X, Z, 0) });
        }
        const depth = i / rows;
        const fog = 0.25 + 0.75 * depth;
        const lineCol = (xs) => {
          const near = Math.exp(-Math.pow((xs - vx) / (R * 2.6), 2));
          return mixRgb(L.hexRgb("#8a5cff"), L.hexRgb("#ff4fd8"), 0.35 + 0.65 * near);
        };
        tc.lineCap = "round";
        tc.lineJoin = "round";
        // The lines running toward us, from the row behind to this one.
        if (prev) {
          for (const [k, a] of prev) {
            const b = row.get(k);
            if (!b || a.H < 0.04 || b.H < 0.04) continue;
            tc.strokeStyle = css(lineCol(b.p[0]), 0.55 * fog);
            tc.lineWidth = 1 + depth * 0.9;
            tc.beginPath();
            tc.moveTo(a.p[0], a.p[1]);
            tc.lineTo(b.p[0], b.p[1]);
            tc.stroke();
          }
        }
        // This row's body, hiding what is behind it, then its ridge line.
        const ks = [...row.keys()].sort((a, b) => a - b);
        let run = [];
        const flush = () => {
          if (run.length > 1) {
            const body = new Path2D();
            body.moveTo(run[0].base[0], run[0].base[1]);
            for (const r of run) body.lineTo(r.p[0], r.p[1]);
            body.lineTo(run[run.length - 1].base[0], run[run.length - 1].base[1]);
            body.closePath();
            const g = tc.createLinearGradient(0, hy - h * 0.2, 0, hy + f / Z);
            g.addColorStop(0, "#12061f");
            g.addColorStop(1, "#06020c");
            tc.fillStyle = g;
            tc.fill(body);
            for (let j = 1; j < run.length; j++) {
              tc.strokeStyle = css(lineCol(run[j].p[0]), (0.6 + 0.4 * depth) * fog);
              tc.lineWidth = 1.2 + depth * 1.2;
              tc.beginPath();
              tc.moveTo(run[j - 1].p[0], run[j - 1].p[1]);
              tc.lineTo(run[j].p[0], run[j].p[1]);
              tc.stroke();
            }
          }
          run = [];
        };
        for (const k of ks) {
          const r = row.get(k);
          if (r.H > 0.04) run.push(r);
          else flush();
        }
        flush();
        prev = row;
      }
      ctx.drawImage(terrain, 0, 0);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.filter = "blur(6px)";
      ctx.globalAlpha = 0.7;
      ctx.drawImage(terrain, 0, 0);
      ctx.filter = "blur(20px)";
      ctx.globalAlpha = 0.5;
      ctx.drawImage(terrain, 0, 0);
      ctx.restore();

      // The horizon: a hot line and the haze where floor meets sky.
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const haze = ctx.createLinearGradient(0, hy - h * 0.05, 0, hy + h * 0.07);
      haze.addColorStop(0, "rgba(255,60,170,0)");
      haze.addColorStop(0.42, "rgba(255,60,170,0.22)");
      haze.addColorStop(0.5, "rgba(255,90,180,0.32)");
      haze.addColorStop(1, "rgba(150,40,200,0)");
      ctx.fillStyle = haze;
      ctx.fillRect(0, hy - h * 0.05, w, h * 0.12);
      const line = ctx.createLinearGradient(0, 0, w, 0);
      line.addColorStop(0, "rgba(255,80,200,0.2)");
      line.addColorStop(vx / w, "rgba(255,170,190,0.95)");
      line.addColorStop(1, "rgba(255,80,200,0.35)");
      ctx.fillStyle = line;
      ctx.filter = "blur(1px)";
      ctx.fillRect(0, hy - 1, w, 2.5);
      ctx.filter = "blur(8px)";
      ctx.globalAlpha = 0.6;
      ctx.fillRect(0, hy - 4, w, 8);
      ctx.restore();

      // Calm on the left for the words.
      const calm = ctx.createLinearGradient(0, 0, w * 0.55, 0);
      calm.addColorStop(0, "rgba(5,2,10,0.74)");
      calm.addColorStop(0.55, "rgba(5,2,10,0.4)");
      calm.addColorStop(1, "rgba(5,2,10,0)");
      ctx.fillStyle = calm;
      ctx.fillRect(0, 0, w, h);
      vignette(ctx, w, h, { strength: 0.45, cx: 0.62, cy: 0.5, inner: 0.3 });
      L.grain(ctx, w, h, 1299, 4);
    },
  };

  // ---------------------------------------------------------------------------------------------------------------------------------
  // The story: the workshop's bench at night
  // ---------------------------------------------------------------------------------------------------------------------------------

  const v3 = {
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    norm: (a) => {
      const l = Math.hypot(a[0], a[1], a[2]) || 1;
      return [a[0] / l, a[1] / l, a[2] / l];
    },
  };

  /** A pinhole camera in centimetres: x right, y up, z out of the wall toward the camera. */
  function camera(C, T, f, w, h) {
    const F = v3.norm(v3.sub(T, C));
    const Rt = v3.norm(v3.cross(F, [0, 1, 0]));
    const U = v3.cross(Rt, F);
    const cx = w / 2;
    const cy = h / 2;
    return {
      C,
      f,
      project(P) {
        const v = v3.sub(P, C);
        const z = v3.dot(v, F);
        return [cx + (f * v3.dot(v, Rt)) / z, cy - (f * v3.dot(v, U)) / z, z];
      },
      ray(x, y) {
        const a = (x - cx) / f;
        const b = (y - cy) / f;
        return v3.norm([F[0] + Rt[0] * a - U[0] * b, F[1] + Rt[1] * a - U[1] * b, F[2] + Rt[2] * a - U[2] * b]);
      },
    };
  }

  /** Points along a chain of cubic curves in 3D, about `step` cm apart. */
  function chain3(curves, step = 0.6) {
    const out = [];
    for (const c of curves) {
      let len = 0;
      for (let i = 1; i <= 20; i++) {
        const a = bez3(c, (i - 1) / 20);
        const b = bez3(c, i / 20);
        len += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      }
      const n = Math.max(2, Math.ceil(len / step));
      for (let i = out.length ? 1 : 0; i <= n; i++) out.push(bez3(c, i / n));
    }
    return out;
  }
  function bez3([p0, p1, p2, p3], t) {
    const u = 1 - t;
    return [0, 1, 2].map((k) => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]);
  }

  ART.story = {
    w: 1600,
    h: 1200,
    quality: 80,
    draw(ctx, w, h) {
      const cam = camera([0, 48, 150], [0, 8, 35], 1250, w, h);
      const P = (p) => cam.project(p);
      const flat = (pts) => pts.map((p) => P(p));
      const random = L.rng(1401);
      const seamY = P([0, 0, 0])[1];

      // --- The tubes, in the world (centimetres) ----------------------------------------------------------------------------
      const r = 0.75;
      // An upright cyan wave held in a clamp stand in front of the wall.
      const wave = [];
      for (let i = 0; i <= 160; i++) {
        const t = i / 160;
        wave.push([-10 + 64 * t, 17 + 9.5 * Math.sin(t * Math.PI * 2.35 + 0.2) * (1 - 0.2 * t) + 3 * t, 20]);
      }
      // A heart half bent, lying on the bench: one lobe, the point and part of the other side, the rest still straight glass.
      const heartUnit = sample(SIGNS.heart().tubes[0].d, 0.25).pts;
      const cut = Math.floor(heartUnit.length * 0.87);
      const heart = heartUnit.slice(0, cut).map(([x, y]) => [-30 + x * 0.4, r, 50 + y * 0.4]);
      {
        const a = heart[heart.length - 6];
        const b = heart[heart.length - 1];
        const d = v3.norm(v3.sub(b, a));
        for (let k = 1; k <= 16; k++) heart.push([b[0] + d[0] * k, r, b[2] + d[2] * k]);
      }
      // A long pink S-curve lying nearer, on the right.
      const sCurve = chain3([
        [[6, r, 92], [16, r, 74], [30, r, 96], [40, r, 80]],
        [[40, r, 80], [48, r, 68], [60, r, 76], [74, r, 64]],
      ]);
      const lit = [
        { pts: wave, color: NEON.cyan },
        { pts: heart.slice(4, heart.length - 18), color: NEON.pink },
        { pts: sCurve.slice(5, sCurve.length - 5), color: NEON.pink },
      ];
      // Blue gas jets along a ribbon burner at the back.
      const flames = [];
      for (let x = -68; x <= -34; x += 1.9) flames.push({ base: [x, 7.2, 9], tip: [x + random.gauss() * 0.25, 7.2 + 2.8 + random() * 1.4, 9] });

      // --- The light -------------------------------------------------------------------------------------------------------
      const lights = [];
      for (const t of lit) {
        const c = linHex(t.color).map((v) => v * (POWER[t.color] ?? 1));
        // Glass lying on the steel lights it as if from a little higher: its glow scatters and the polish spreads it.
        const lying = t.pts[0][1] < 2;
        for (let i = 0; i < t.pts.length; i += 2) lights.push([t.pts[i][0], Math.max(t.pts[i][1], 1.8), t.pts[i][2], ...c.map((v) => v * (lying ? 0.7 : 1))]);
      }
      for (const fl of flames) lights.push([fl.base[0], fl.base[1] + 2, fl.base[2], 0.003, 0.016, 0.1]);
      const nl = lights.length;
      const LP = new Float32Array(nl * 6);
      lights.forEach((l, i) => LP.set(l, i * 6));
      /** The surface a pixel sees: the wall (z = 0) or the bench (y = 0), its point and normal. */
      const surf = (x, y) => {
        const d = cam.ray(x, y);
        const C = cam.C;
        const tb = d[1] < 0 ? -C[1] / d[1] : Infinity;
        const tw = d[2] < 0 ? -C[2] / d[2] : Infinity;
        if (tb < tw) return { id: 1, p: [C[0] + d[0] * tb, 0, C[2] + d[2] * tb], n: [0, 1, 0] };
        return { id: 0, p: [C[0] + d[0] * tw, C[1] + d[1] * tw, 0], n: [0, 0, 1] };
      };
      const q = 3;
      const gw = Math.ceil(w / q) + 2;
      const gh = Math.ceil(h / q) + 2;
      const E = new Float32Array(gw * gh * 3);
      for (let gy = 0; gy < gh; gy++) {
        for (let gx = 0; gx < gw; gx++) {
          const { p, n } = surf(gx * q, gy * q);
          let er = 0;
          let eg = 0;
          let eb = 0;
          for (let i = 0; i < nl; i++) {
            const o = i * 6;
            const dx = LP[o] - p[0];
            const dy = LP[o + 1] - p[1];
            const dz = LP[o + 2] - p[2];
            const d2 = dx * dx + dy * dy + dz * dz + 2;
            const cos = (dx * n[0] + dy * n[1] + dz * n[2]) / Math.sqrt(d2);
            if (cos <= 0) continue;
            const k = cos / d2;
            er += LP[o + 3] * k;
            eg += LP[o + 4] * k;
            eb += LP[o + 5] * k;
          }
          const o = (gy * gw + gx) * 3;
          E[o] = er;
          E[o + 1] = eg;
          E[o + 2] = eb;
        }
      }
      const lightAt = (x, y) => {
        const fx = L.clamp(x / q, 0, gw - 1.001);
        const fy = L.clamp(y / q, 0, gh - 1.001);
        const ix = fx | 0;
        const iy = fy | 0;
        const tx = fx - ix;
        const ty = fy - iy;
        const out = [0, 0, 0];
        for (let c = 0; c < 3; c++) {
          const a = E[(iy * gw + ix) * 3 + c];
          const b = E[(iy * gw + ix + 1) * 3 + c];
          const cc = E[((iy + 1) * gw + ix) * 3 + c];
          const dd = E[((iy + 1) * gw + ix + 1) * 3 + c];
          out[c] = (a * (1 - tx) + b * tx) * (1 - ty) + (cc * (1 - tx) + dd * tx) * ty;
        }
        return out;
      };

      // --- The surfaces, per pixel -----------------------------------------------------------------------------------------
      const nA = L.simplex(1403);
      const nB = L.simplex(1404);
      const img = ctx.createImageData(w, h);
      const D = img.data;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const { id, p } = surf(x + 0.5, y + 0.5);
          const e = lightAt(x, y);
          let alb;
          let expo;
          if (id === 1) {
            // Blackened steel: brushed along its length, blotched, scorched behind the burner, a few old scratches.
            const brushed = nA(p[0] * 0.06, p[2] * 2.6) * 0.5 + nA(p[0] * 0.25, p[2] * 11) * 0.35;
            const blot = L.fbm(nB, p[0] * 0.03, p[2] * 0.03, 4);
            const scorch = Math.exp(-Math.pow((p[0] + 51) / 22, 2) - Math.pow((p[2] - 16) / 9, 2));
            const k = (0.13 + brushed * 0.03 + blot * 0.035) * (1 - scorch * 0.5);
            alb = [k * 0.92, k * 0.95, k * 1.08];
            expo = 13;
          } else {
            // Dark concrete, and a pegboard on the left with its rows of holes.
            const mott = L.fbm(nB, p[0] * 0.04 + 40, p[1] * 0.04, 5);
            let k = 0.08 + mott * 0.022 + nA(p[0] * 0.9, p[1] * 0.9) * 0.008;
            if (p[0] > -120 && p[0] < -24 && p[1] > 16 && p[1] < 90) {
              const hx = ((p[0] + 120) % 2.54) - 1.27;
              const hy = ((p[1] - 16) % 2.54) - 1.27;
              const hole = L.smooth(0.36, 0.26, Math.hypot(hx, hy));
              const edge = Math.min(p[0] + 120, -24 - p[0], p[1] - 16) < 0.6 ? 1.5 : 1;
              k = (0.1 + mott * 0.012) * (1 - hole * 0.9) * edge;
            }
            alb = [k * 0.95, k * 0.92, k * 1.05];
            expo = 9;
          }
          const amb = 0.0012 + 0.0016 * (1 - y / h);
          const o = (y * w + x) * 4;
          D[o] = enc(1 - Math.exp(-alb[0] * (e[0] * expo + amb * 5)));
          D[o + 1] = enc(1 - Math.exp(-alb[1] * (e[1] * expo + amb * 5)));
          D[o + 2] = enc(1 - Math.exp(-alb[2] * (e[2] * expo + amb * 9)));
          D[o + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      const colourAt = (pt2) => {
        const e = lightAt(pt2[0], pt2[1]);
        const m = Math.max(e[0], e[1], e[2], 1e-9);
        return { rgb: e.map((v) => Math.pow(v / m, 1 / 2.2) * 255), k: m };
      };

      // --- Helpers for things drawn over the surfaces ----------------------------------------------------------------------
      const path2 = (pts2, close = false) => pathOf(pts2.map((p) => [p[0], p[1]]), close);
      const rimLight = (pts2, width, alpha, close = false) => {
        const { rgb, k } = colourAt(pts2[Math.floor(pts2.length / 2)]);
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = css(rgb, alpha * L.clamp(Math.sqrt(k) * 4, 0.2, 1));
        ctx.lineWidth = width;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke(path2(pts2, close));
        ctx.restore();
      };
      const solid = (pts3, fill) => {
        ctx.fillStyle = fill;
        ctx.fill(path2(flat(pts3), true));
      };
      const contactShadow = (cx3, rx, rz, a = 0.6) => {
        const c = P(cx3);
        const e1 = P([cx3[0] + rx, cx3[1], cx3[2]]);
        const e2 = P([cx3[0], cx3[1], cx3[2] + rz]);
        ctx.save();
        ctx.translate(c[0], c[1]);
        ctx.scale(Math.max(1, Math.abs(e1[0] - c[0])), Math.max(1, Math.abs(e2[1] - c[1])));
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        g.addColorStop(0, `rgba(0,0,0,${a})`);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, 1, 0, TAU);
        ctx.fill();
        ctx.restore();
      };
      const tubeT = (pts3) => (2 * r * cam.f) / P(pts3[Math.floor(pts3.length / 2)])[2];
      /** A box standing on the bench: its front and top faces, the top's front edge catching the light. */
      const box = (x0, x1, z0, z1, hgt, front, top) => {
        contactShadow([(x0 + x1) / 2, 0, (z0 + z1) / 2], (x1 - x0) * 0.62, (z1 - z0) * 0.9, 0.75);
        solid([[x0, 0, z1], [x1, 0, z1], [x1, hgt, z1], [x0, hgt, z1]], front);
        solid([[x0, hgt, z1], [x1, hgt, z1], [x1, hgt, z0], [x0, hgt, z0]], top);
        rimLight(flat([[x0, hgt, z1], [x1, hgt, z1]]), 1.3, 0.55);
      };
      const glass = (pts3, alpha = 1) => {
        // Clear unlit glass: a faint body and two bright edges in the colour of the light around it.
        const pts2 = flat(pts3);
        const T = tubeT(pts3);
        const { rgb, k } = colourAt(pts2[Math.floor(pts2.length / 2)]);
        const a2 = alpha * L.clamp(Math.sqrt(k) * 5, 0.25, 1);
        ctx.save();
        ctx.lineCap = "round";
        ctx.strokeStyle = `rgba(110,125,165,${0.1 * alpha})`;
        ctx.lineWidth = T;
        ctx.stroke(path2(pts2));
        ctx.globalCompositeOperation = "lighter";
        ctx.filter = "blur(0.6px)";
        for (const [off, a] of [[-0.3, 0.38], [0.28, 0.14]]) {
          ctx.save();
          ctx.translate(0, off * T);
          ctx.strokeStyle = css(mixRgb(rgb, [255, 255, 255], 0.3), a * a2);
          ctx.lineWidth = Math.max(1, T * 0.13);
          ctx.stroke(path2(pts2));
          ctx.restore();
        }
        ctx.restore();
      };
      const electrode = (pts3, end) => {
        // The tube's end: a short black-painted run and the electrode's metal cap.
        const i0 = end ? pts3.length - 1 : 0;
        const pts2 = flat(end ? pts3.slice(-7) : pts3.slice(0, 7));
        const T = tubeT(pts3);
        ctx.save();
        ctx.lineCap = "round";
        ctx.strokeStyle = "#0b0a0e";
        ctx.lineWidth = T;
        ctx.stroke(path2(pts2));
        const c = P(pts3[i0]);
        const { rgb } = colourAt(c);
        const g = ctx.createLinearGradient(c[0] - T, c[1] - T, c[0] + T, c[1] + T);
        g.addColorStop(0, css(mixRgb(rgb, [200, 200, 210], 0.5).map((v) => v * 0.75)));
        g.addColorStop(1, "#16151b");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(c[0], c[1], T * 0.62, 0, TAU);
        ctx.fill();
        ctx.restore();
      };
      const lead = (from3, to3, sag = 6) => {
        const mid = [(from3[0] + to3[0]) / 2 + sag, 0.4, (from3[2] + to3[2]) / 2 + sag];
        const pts3 = chain3([[from3, [from3[0], 0.4, from3[2] + sag], mid, mid], [mid, mid, [to3[0], 0.4, to3[2] + sag * 0.4], to3]], 1);
        const pts2 = flat(pts3);
        ctx.save();
        ctx.lineCap = "round";
        ctx.strokeStyle = "#060508";
        ctx.lineWidth = Math.max(2, tubeT(pts3) * 0.4);
        ctx.stroke(path2(pts2));
        ctx.restore();
        rimLight(pts2.map((p) => [p[0], p[1] - 1]), 1, 0.3);
      };
      const glow = (target, pts2, T, color, o) => tubeGlow(target, { T, tubes: [{ color, lit: [pts2.map((p) => [p[0], p[1]])] }] }, o);
      /** A lit tube; `mirrorY` draws its image in the polished steel first, mirrored through the bench and softened. */
      const neon = (pts3, color, { mirror = 0, strength = 0.55, reach = 40, sharp = true } = {}) => {
        const T = tubeT(pts3);
        if (mirror) {
          const m = L.canvas(w, h);
          const mc = m.getContext("2d");
          glow(mc, pts3.map(([x, y, z]) => P([x, -y - mirror, z])), T, color, { haze: 0.5, bloom: 0.8 });
          mc.globalCompositeOperation = "destination-in";
          const y0 = P([0, 0, pts3[0][2]])[1];
          const fade = mc.createLinearGradient(0, y0, 0, y0 + reach * 6);
          fade.addColorStop(0, `rgba(0,0,0,${strength})`);
          fade.addColorStop(1, "rgba(0,0,0,0)");
          mc.fillStyle = fade;
          mc.fillRect(0, 0, w, h);
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          if (sharp) {
            ctx.filter = "blur(3.5px)";
            ctx.drawImage(m, 0, 0);
          }
          ctx.filter = "blur(9px)";
          ctx.globalAlpha = sharp ? 0.7 : 0.9;
          ctx.drawImage(m, 0, 0);
          ctx.restore();
        }
        glow(ctx, flat(pts3), T, color, { haze: 1.3, bloom: 1.1, core: Math.min(1, 14 / T) });
      };

      // --- On the wall: the pegboard's tools and the rack of glass stock, a little out of focus ------------------------------
      const onWall = (pts) => pts.map(([x, y]) => [x, y, 0.5]);
      const hang = (pts) => {
        const pts2 = flat(onWall(pts));
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.filter = "blur(4px)";
        ctx.translate(3, 5);
        ctx.fill(path2(pts2, true));
        ctx.restore();
        ctx.fillStyle = "#0c0a10";
        ctx.fill(path2(pts2, true));
        rimLight(pts2, 1.2, 0.3, true);
      };
      // Pliers hanging jaws up.
      hang([[-106, 48], [-105, 54], [-104, 55.5], [-103, 54], [-102, 48], [-101.4, 45], [-99.5, 31], [-101, 30.5], [-103.6, 42], [-106.2, 30.5], [-107.7, 31], [-105.6, 45]]);
      // A spanner.
      hang([[-90, 30], [-88, 30], [-88.3, 50], [-86.4, 52], [-86.8, 56], [-88.6, 54.6], [-90.6, 56], [-91.2, 52], [-89.4, 50]]);
      // A coil of lead wire on its hook.
      {
        const ring = [];
        for (let i = 0; i <= 48; i++) ring.push([-66 + Math.cos((i / 48) * TAU) * 6.5, 44 + Math.sin((i / 48) * TAU) * 6.5, 0.8]);
        const pts2 = flat(ring);
        ctx.save();
        ctx.strokeStyle = "#09080c";
        ctx.lineWidth = 7;
        ctx.stroke(path2(pts2, true));
        ctx.restore();
        rimLight(pts2.slice(24, 48), 1.4, 0.35);
      }
      // A hand torch.
      hang([[-45, 28], [-42.6, 28], [-42.2, 44], [-41, 45.5], [-41, 53], [-46.6, 53], [-46.6, 45.5], [-45.4, 44]]);
      // Glass stock leaning in a rack on the right.
      for (let i = 0; i < 8; i++) {
        const x = 52 + i * 3.1 + random() * 0.8;
        glass([[x, 1.5, 6 + random() * 2], [x + 2 + random() * 1.5, 72, 1.5]], 0.45);
      }
      // A shallow depth of field: the wall a touch soft behind the bench.
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, seamY + 1);
      ctx.clip();
      ctx.filter = "blur(1.6px)";
      ctx.drawImage(ctx.canvas, 0, 0);
      ctx.restore();

      // --- On the bench, back to front --------------------------------------------------------------------------------------
      // The ribbon burner and its jets.
      box(-72, -30, 4, 13, 7, "#0c0b10", "#16141c");
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const fl of flames) {
        const b = P(fl.base);
        const t = P(fl.tip);
        const wpx = Math.abs(P([fl.base[0] + 0.55, fl.base[1], fl.base[2]])[0] - b[0]);
        const g = ctx.createLinearGradient(b[0], b[1], t[0], t[1]);
        g.addColorStop(0, "rgba(170,225,255,0.95)");
        g.addColorStop(0.3, "rgba(70,130,255,0.8)");
        g.addColorStop(1, "rgba(40,60,255,0)");
        ctx.fillStyle = g;
        ctx.filter = "blur(0.7px)";
        ctx.beginPath();
        ctx.moveTo(b[0] - wpx, b[1]);
        ctx.quadraticCurveTo(b[0] - wpx * 0.9, (b[1] + t[1]) / 2, t[0], t[1]);
        ctx.quadraticCurveTo(b[0] + wpx * 0.9, (b[1] + t[1]) / 2, b[0] + wpx, b[1]);
        ctx.closePath();
        ctx.fill();
      }
      ctx.filter = "blur(18px)";
      ctx.fillStyle = "rgba(60,110,255,0.3)";
      const fb0 = P([-68, 9, 9]);
      const fb1 = P([-34, 9, 9]);
      ctx.fillRect(fb0[0], fb0[1] - 16, fb1[0] - fb0[0], 26);
      ctx.restore();

      // The transformer.
      box(56, 78, 5, 17, 10, "#0d0c11", "#17151d");

      // The clamp stand behind the wave, the wave and its image in the steel.
      contactShadow([22, 0, 17], 8, 5, 0.75);
      {
        const base = [];
        for (let i = 0; i <= 40; i++) base.push([22 + Math.cos((i / 40) * TAU) * 6.5, 1, 17 + Math.sin((i / 40) * TAU) * 4.5]);
        solid(base, "#0c0b10");
        rimLight(flat(base.slice(2, 19)), 1.4, 0.5);
        const rodA = P([22, 1, 17]);
        const rodB = P([22, 24, 17]);
        ctx.save();
        ctx.strokeStyle = "#0e0d12";
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(rodA[0], rodA[1]);
        ctx.lineTo(rodB[0], rodB[1]);
        ctx.stroke();
        ctx.restore();
        rimLight([[rodA[0] - 3, rodA[1]], [rodB[0] - 3, rodB[1]]], 1.4, 0.7);
      }
      lead(wave[0], [56, 0, 13], 5);
      lead(wave[wave.length - 1], [60, 0, 16], 2);
      neon(wave.slice(4, wave.length - 4), NEON.cyan, { mirror: 0.001, strength: 0.32, reach: 55 });
      electrode(wave, false);
      electrode(wave, true);
      {
        // The clamp's jaw where it holds the glass.
        const at = wave[Math.round(((22 + 10) / 64) * 160)];
        solid([[at[0] - 1.7, at[1] - 2, 20.8], [at[0] + 1.7, at[1] - 2, 20.8], [at[0] + 1.7, at[1] + 2, 20.8], [at[0] - 1.7, at[1] + 2, 20.8]], "#121117");
        rimLight(flat([[at[0] - 1.7, at[1] + 2, 20.8], [at[0] + 1.7, at[1] + 2, 20.8]]), 1.2, 0.8);
      }

      // The heart being bent, its straight remainder still clear glass, its lead to the transformer.
      contactShadow([-30, 0, 50], 24, 20, 0.3);
      lead(heart[4], [56, 0, 15], 8);
      glass(heart.slice(heart.length - 20));
      neon(heart.slice(4, heart.length - 18), NEON.pink, { mirror: 0.5, strength: 0.5, reach: 8, sharp: false });
      electrode(heart.slice(0, 9), false);

      // Clear offcuts lying across the front.
      glass([[-64, r, 80], [-24, r, 95]]);
      glass([[-61, r, 85], [-19, r, 99]], 0.8);

      // The pink S, its leads off the bench to the right.
      lead(sCurve[sCurve.length - 1], [100, 0, 70], 4);
      lead(sCurve[0], [4, 0, 130], 2);
      neon(sCurve.slice(5, sCurve.length - 5), NEON.pink, { mirror: 0.5, strength: 0.5, reach: 8, sharp: false });
      electrode(sCurve, false);
      electrode(sCurve, true);

      // A spool of lead wire standing on the bench.
      {
        const sx = 50;
        const sz = 42;
        const ring = (y, rad) => {
          const out = [];
          for (let i = 0; i <= 48; i++) out.push([sx + Math.cos((i / 48) * TAU) * rad, y, sz + Math.sin((i / 48) * TAU) * rad]);
          return out;
        };
        contactShadow([sx, 0, sz + 1], 7, 5, 0.75);
        const bottom = flat(ring(0.2, 5.2));
        const top = flat(ring(5.5, 5.2));
        // The drum's side: the bottom rim's near half, then the top rim's near half back.
        const side = path2([...bottom.slice(0, 25), ...top.slice(0, 25).reverse()], true);
        ctx.fillStyle = "#0b0a0f";
        ctx.fill(side);
        ctx.fillStyle = "#141219";
        ctx.fill(path2(top, true));
        rimLight(top.slice(24, 48), 1.4, 0.7);
        rimLight(bottom.slice(2, 22), 1.2, 0.35);
        ctx.fillStyle = "#050407";
        ctx.fill(path2(flat(ring(5.5, 1.4)), true));
        // Turns of wire on the drum.
        for (let k = 0; k < 6; k++) rimLight(flat(ring(1.2 + k * 0.75, 5.25)).slice(0, 25), 0.8, 0.12);
      }

      // Fine scratches in the steel, seen only where the light catches them.
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 170; i++) {
        const x0 = -110 + random() * 220;
        const z0 = 2 + random() * 110;
        const a = random.gauss() * 0.12;
        const len = 1.5 + Math.pow(random(), 2) * 9;
        const pa = P([x0, 0.05, z0]);
        const pb = P([x0 + Math.cos(a) * len, 0.05, z0 + Math.sin(a) * len]);
        const { rgb, k } = colourAt(pa);
        const alpha = L.clamp(Math.sqrt(k) * 1.2, 0, 0.16) * (0.4 + random() * 0.6);
        if (alpha < 0.02) continue;
        ctx.strokeStyle = css(mixRgb(rgb, [255, 255, 255], 0.3), alpha);
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(pa[0], pa[1]);
        ctx.lineTo(pb[0], pb[1]);
        ctx.stroke();
      }
      ctx.restore();

      // Air: a faint haze lit by the tubes, then the lens.
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.filter = "blur(40px)";
      ctx.globalAlpha = 0.09;
      ctx.drawImage(ctx.canvas, 0, 0);
      ctx.restore();
      vignette(ctx, w, h, { strength: 0.75, cx: 0.5, cy: 0.5, inner: 0.25 });
      L.grain(ctx, w, h, 1409, 6);
    },
  };

  // ---------------------------------------------------------------------------------------------------------------------------------
  // The scanlines: a seamless tile of fine lines and faint noise, mostly transparent
  // ---------------------------------------------------------------------------------------------------------------------------------

  ART.scan = {
    w: 512,
    h: 512,
    alpha: true,
    quality: 70,
    draw(ctx, w, h) {
      // Every fourth row a soft dark line; a faint band rolling down every 256 rows; sparse specks of grit. Each row and pixel stands
      // alone and every period divides 512, so the tile repeats without a seam.
      const img = ctx.createImageData(w, h);
      const random = L.rng(77);
      const line = [0, 0.15, 0.58, 0.15];
      for (let y = 0; y < h; y++) {
        const roll = 0.88 + 0.12 * Math.sin((y / 256) * TAU);
        for (let x = 0; x < w; x++) {
          const o = (y * w + x) * 4;
          const n = random();
          const light = n > 0.993;
          const grit = n < 0.07 ? 0.05 : 0;
          img.data[o] = light ? 255 : 0;
          img.data[o + 1] = light ? 255 : 0;
          img.data[o + 2] = light ? 255 : 0;
          img.data[o + 3] = Math.round(L.clamp(light ? 0.07 : line[y % 4] * 0.85 * roll + grit) * 255);
        }
      }
      ctx.putImageData(img, 0, 0);
    },
  };
})();
