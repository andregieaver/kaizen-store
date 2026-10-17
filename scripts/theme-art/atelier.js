/* global window */
/**
 * Atelier's art (`docs/signature-themes.md`): a small ceramics studio of quiet luxury, photographed in soft window light. Hand-thrown
 * stoneware on plinths against warm plaster, the window's frame falling across the wall, iron speckle in the clay. Each pot is a lathe
 * profile turned into a distance field and drawn by a small ray tracer (soft shadows from the window, ambient occlusion, glaze that pools
 * and breaks), so the light is the same in every picture. Everything comes from fixed seeds. No words, numbers, logos or people anywhere.
 */
(() => {
  const L = window.ARTLIB;
  const ART = window.ART;
  const TAU = Math.PI * 2;
  const { clamp, smooth, mix } = L;

  // -------------------------------------------------------------------------------------------------------------------------------
  // Colour: albedos are kept in linear light, shading happens there, and the picture is turned back to sRGB at the end.
  // -------------------------------------------------------------------------------------------------------------------------------

  const toLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const lin = (hex) => L.hexRgb(hex).map((v) => toLin(v / 255));
  const toSrgb = (v) => (v <= 0 ? 0 : v >= 1 ? 1 : v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  /** A gentle shoulder: highlights roll off instead of clipping. */
  const shoulder = (x) => (x < 0.66 ? x : 0.66 + 0.34 * (1 - Math.exp(-(x - 0.66) / 0.55)));

  /** The theme's colours. Glaze albedos sit a little below their palette colour, since window light lifts a lit glaze above it. */
  const PALETTE = {
    plaster: "#ebe5db",
    warmWhite: "#f4efe7",
    chalk: "#e9e4d8",
    clay: "#b8714f",
    charcoal: "#2b2926",
    sage: "#9aa58d",
    ochre: "#c49a56",
  };

  /** An integer hash in [0, 1). */
  function hash(i, j, s) {
    let h = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  /**
   * Iron spots: dots scattered on a jittered grid in surface units (cm), most tiny and a few larger; `core` is the dark spot, `halo` the
   * softer bleed around it in a glaze.
   */
  const SPECK = { core: 0, halo: 0 };
  function speckle(u, v, cell, density, rMin, rMax, seed, aa) {
    const i0 = Math.floor(u / cell);
    const j0 = Math.floor(v / cell);
    let core = 0;
    let halo = 0;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const i = i0 + di;
        const j = j0 + dj;
        if (hash(i, j, seed) > density) continue;
        const cx = (i + hash(i, j, seed + 1)) * cell;
        const cy = (j + hash(i, j, seed + 2)) * cell;
        const r = rMin + (rMax - rMin) * Math.pow(hash(i, j, seed + 3), 4);
        const d = Math.hypot(u - cx, v - cy);
        // Some spots sit under the glaze and blur; a dot smaller than a pixel fades instead of vanishing.
        const deep = hash(i, j, seed + 4);
        const soft = Math.max(aa * 0.7, r * (0.3 + 1.6 * deep * deep));
        const fade = Math.min(1, (r / Math.max(aa * 0.5, 1e-4)) ** 1.2) * (1 - 0.55 * deep);
        const c = (1 - smooth(r - soft * 0.5, r + soft * 0.5, d)) * fade;
        if (c > core) core = c;
        const hl = (1 - smooth(r * 0.8, r * 3.5 + soft, d)) * fade * (0.35 + 0.65 * hash(i, j, seed + 5));
        if (hl > halo) halo = hl;
      }
    }
    SPECK.core = core;
    SPECK.halo = halo;
    return core;
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // Profiles: a pot's silhouette as points [r, y] in cm from the foot up, smooth between points, a corner where a point says "c".
  // -------------------------------------------------------------------------------------------------------------------------------

  /** Centripetal Catmull-Rom between p1 and p2 (no overshoot on uneven points). */
  function crSegment(p0, p1, p2, p3, n, out) {
    const step = (a, b) => Math.max(1e-4, Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5));
    const t0 = 0;
    const t1 = t0 + step(p0, p1);
    const t2 = t1 + step(p1, p2);
    const t3 = t2 + step(p2, p3);
    const lerp = (a, b, ta, tb, t) => [(a[0] * (tb - t) + b[0] * (t - ta)) / (tb - ta), (a[1] * (tb - t) + b[1] * (t - ta)) / (tb - ta)];
    for (let k = 0; k < n; k++) {
      const t = t1 + ((t2 - t1) * k) / n;
      const a1 = lerp(p0, p1, t0, t1, t);
      const a2 = lerp(p1, p2, t1, t2, t);
      const a3 = lerp(p2, p3, t2, t3, t);
      const b1 = lerp(a1, a2, t0, t2, t);
      const b2 = lerp(a2, a3, t1, t3, t);
      out.push(lerp(b1, b2, t1, t2, t));
    }
  }

  function smoothRun(pts, n) {
    const out = [];
    if (pts.length === 2) {
      for (let k = 0; k < n; k++) out.push([mix(pts[0][0], pts[1][0], k / n), mix(pts[0][1], pts[1][1], k / n)]);
      out.push(pts[1]);
      return out;
    }
    const m = pts.length;
    const first = [2 * pts[0][0] - pts[1][0], 2 * pts[0][1] - pts[1][1]];
    const last = [2 * pts[m - 1][0] - pts[m - 2][0], 2 * pts[m - 1][1] - pts[m - 2][1]];
    for (let i = 0; i < m - 1; i++) crSegment(i === 0 ? first : pts[i - 1], pts[i], pts[i + 1], i + 2 < m ? pts[i + 2] : last, n, out);
    out.push(pts[m - 1]);
    return out;
  }

  function profileLine(spec, n = 16) {
    const runs = [];
    let run = [];
    for (const p of spec) {
      run.push([p[0], p[1]]);
      if (p[2] === "c" && run.length > 1) {
        runs.push(run);
        run = [[p[0], p[1]]];
      }
    }
    if (run.length > 1) runs.push(run);
    const out = [];
    runs.forEach((r, k) => {
      const s = smoothRun(r, n);
      if (k > 0) s.shift();
      for (const p of s) {
        const prev = out[out.length - 1];
        if (!prev || Math.hypot(prev[0] - p[0], prev[1] - p[1]) > 1e-6) out.push(p);
      }
    });
    return out;
  }

  /** A closed polygon from a right-hand profile and its mirror, flattened. */
  function mirrorPoly(right) {
    const left = right
      .slice()
      .reverse()
      .filter((p) => p[0] > 1e-9)
      .map((p) => [-p[0], p[1]]);
    const all = right.concat(left);
    const flat = new Float64Array(all.length * 2);
    all.forEach((p, i) => {
      flat[i * 2] = p[0];
      flat[i * 2 + 1] = p[1];
    });
    return flat;
  }

  /** Signed distance to a polygon (negative inside), after Inigo Quilez. */
  function sdPolygon(v, x, y) {
    const n = v.length / 2;
    let d = (x - v[0]) ** 2 + (y - v[1]) ** 2;
    let s = 1;
    for (let i = 0, j = n - 1; i < n; j = i, i++) {
      const vix = v[i * 2];
      const viy = v[i * 2 + 1];
      const ex = v[j * 2] - vix;
      const ey = v[j * 2 + 1] - viy;
      const wx = x - vix;
      const wy = y - viy;
      const ee = ex * ex + ey * ey;
      let h = ee > 0 ? (wx * ex + wy * ey) / ee : 0;
      h = h < 0 ? 0 : h > 1 ? 1 : h;
      const bx = wx - ex * h;
      const by = wy - ey * h;
      const dd = bx * bx + by * by;
      if (dd < d) d = dd;
      const c1 = y >= viy;
      const c2 = y < v[j * 2 + 1];
      const c3 = ex * wy > ey * wx;
      if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
    }
    return s * Math.sqrt(d);
  }

  /** A polygon's distance field sampled on a grid over (r >= 0, y), read back bilinearly. */
  function makeGrid(poly, rMax, yMin, yMax, cell, box) {
    const nx = Math.ceil(rMax / cell) + 2;
    const ny = Math.ceil((yMax - yMin) / cell) + 2;
    const data = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      const y = yMin + j * cell;
      for (let i = 0; i < nx; i++) data[j * nx + i] = sdPolygon(poly, i * cell, y);
    }
    return { data, nx, ny, cell, inv: 1 / cell, yMin, xMax: (nx - 1) * cell, yMax: yMin + (ny - 1) * cell, box };
  }

  function sampleGrid(g, x, y) {
    let cx = x < 0 ? 0 : x;
    let cy = y;
    let ex = 0;
    let ey = 0;
    if (cx > g.xMax) {
      ex = cx - g.xMax;
      cx = g.xMax;
    }
    if (cy < g.yMin) {
      ey = g.yMin - cy;
      cy = g.yMin;
    } else if (cy > g.yMax) {
      ey = cy - g.yMax;
      cy = g.yMax;
    }
    const fx = cx * g.inv;
    const fy = (cy - g.yMin) * g.inv;
    let i = Math.floor(fx);
    let j = Math.floor(fy);
    if (i > g.nx - 2) i = g.nx - 2;
    if (j > g.ny - 2) j = g.ny - 2;
    const tx = fx - i;
    const ty = fy - j;
    const k = j * g.nx + i;
    const d = g.data;
    const v = (d[k] * (1 - tx) + d[k + 1] * tx) * (1 - ty) + (d[k + g.nx] * (1 - tx) + d[k + g.nx + 1] * tx) * ty;
    if (ex === 0 && ey === 0) return v;
    const out = Math.sqrt(ex * ex + ey * ey);
    // Outside the grid: at least as far as the shape's own box.
    const b = g.box;
    const bx = Math.max(x - b[0], 0);
    const by = Math.max(b[1] - y, y - b[2], 0);
    return Math.max(out, v - out, Math.sqrt(bx * bx + by * by));
  }

  const smin = (a, b, k) => {
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - h * h * k * 0.25;
  };
  const smax = (a, b, k) => -smin(-a, -b, k);

  /** The inside of a pot: its outer profile moved in by the wall's thickness, a floor, and a rounded corner between them. */
  function offsetInner(outer, t, floorY, fillet) {
    const pts = [];
    for (let i = 0; i < outer.length; i++) {
      const a = outer[Math.max(0, i - 1)];
      const b = outer[Math.min(outer.length - 1, i + 1)];
      const tx = b[0] - a[0];
      const ty = b[1] - a[1];
      const len = Math.hypot(tx, ty) || 1;
      pts.push([outer[i][0] - (ty / len) * t, outer[i][1] + (tx / len) * t]);
    }
    const rAt = (y) => {
      for (let i = 1; i < pts.length; i++) {
        if (pts[i][1] >= y && pts[i - 1][1] < y) {
          const f = (y - pts[i - 1][1]) / (pts[i][1] - pts[i - 1][1]);
          return mix(pts[i - 1][0], pts[i][0], f);
        }
      }
      return pts[0][0];
    };
    const yA = floorY + fillet;
    const rF = rAt(floorY);
    const rA = rAt(yA);
    const f = Math.min(fillet, rF * 0.7);
    const out = [[0, floorY]];
    out.push([Math.max(0.01, rF - f), floorY]);
    for (let k = 1; k < 10; k++) {
      const s = k / 10;
      const p0 = [rF - f, floorY];
      const p1 = [rF, floorY];
      const p2 = [rA, yA];
      out.push([(1 - s) ** 2 * p0[0] + 2 * (1 - s) * s * p1[0] + s * s * p2[0], (1 - s) ** 2 * p0[1] + 2 * (1 - s) * s * p1[1] + s * s * p2[1]]);
    }
    for (const p of pts) if (p[1] > yA + 1e-3) out.push(p);
    return out;
  }

  /**
   * A thrown pot as a distance function in its own cm: an outer solid less an inner cavity, the lip rounded, and optional carved flutes,
   * a pulled spout, a handle and the small unevenness of a hand-made thing.
   */
  function vessel(o) {
    const outer = profileLine(o.outer);
    const H = outer[outer.length - 1][1];
    let rMax = 0;
    for (const p of outer) rMax = Math.max(rMax, p[0]);
    const t = o.thickness ?? 0.6;
    let cavity = null;
    if (!o.solid) {
      const floorY = o.floor ?? t * 1.8;
      const inner = o.inner ? profileLine(o.inner) : offsetInner(outer, t, floorY, o.fillet ?? t * 3);
      const lastR = inner[inner.length - 1][0];
      inner.push([lastR, H + Math.max(3, H * 0.4)]);
      cavity = inner;
    }
    const lipK = o.lip ?? t * 0.9;
    const wob = o.wobble ? L.simplex(o.seed ?? 1) : null;
    const wobAmp = o.wobble ?? 0;
    const ridges = o.ridges ?? null;
    const spout = o.spout ?? null;
    const handle = o.handle ? handleShape(o.handle) : null;
    const needTheta = Boolean(wob || ridges || spout);
    let gO = null;
    let gC = null;
    const reach = Math.max(rMax + (spout ? spout.amount : 0), handle ? handle.reach : 0);
    const shape = {
      H: H + (spout ? spout.lift : 0),
      rBound: reach + 0.6,
      rMax,
      thickness: t,
      outerLine: outer,
      step: needTheta || handle ? 0.7 : 0.92,
      build(cell) {
        const margin = Math.max(4, Math.max(H, rMax) * 0.45);
        gO = makeGrid(mirrorPoly(outer), rMax + margin, -margin, H + margin, cell, [rMax, 0, H]);
        if (cavity) {
          const top = H + Math.max(3, H * 0.4);
          // The cavity's own box is not a bound for its inside, so it gets none (a far point is outside it anyway).
          gC = makeGrid(mirrorPoly(cavity), rMax + margin, -margin, top + margin, cell, [rMax, -1e9, 1e9]);
        }
      },
      /** Distance in the pot's own cm. Also leaves which surface is nearest in `shape.part`. */
      sdf(px, py, pz) {
        const rho = Math.sqrt(px * px + pz * pz);
        let rO = rho;
        let rI = rho;
        let y = py;
        if (needTheta) {
          const th = Math.atan2(px, pz);
          if (wob) {
            const w = wobAmp * wob(Math.cos(th) * 0.9 + py * 0.035, Math.sin(th) * 0.9 - py * 0.02);
            rO -= w;
            rI -= w;
          }
          if (ridges && py > ridges.from && py < ridges.to) {
            const band = smooth(ridges.from, ridges.from + ridges.ease, py) * (1 - smooth(ridges.to - ridges.ease, ridges.to, py));
            const f = (((th / TAU) * ridges.count) % 1 + 1) % 1;
            const g = 1 - (2 * f - 1) ** 2;
            rO += ridges.depth * g * band;
          }
          if (spout) {
            let c = Math.cos(th - spout.at);
            c = c > 0 ? Math.pow(c, spout.sharp) : 0;
            const along = smooth(spout.from, H, py);
            const s = spout.amount * c * along * along * smooth(0, rMax * 0.5, rho);
            rO -= s;
            rI -= s;
            y -= spout.lift * c * along * along;
          }
        }
        let d = sampleGrid(gO, rO, y);
        if (gC) d = smax(d, -sampleGrid(gC, rI, y), lipK);
        if (handle) d = smin(d, handle.sdf(px, py, pz), handle.join);
        return d;
      },
      /** How much of the surface near a point is the inside (0 outside, 1 inside) and the handle. */
      parts(px, py, pz, out) {
        const rho = Math.sqrt(px * px + pz * pz);
        let rO = rho;
        let rI = rho;
        let y = py;
        if (needTheta && spout) {
          const th = Math.atan2(px, pz);
          let c = Math.cos(th - spout.at);
          c = c > 0 ? Math.pow(c, spout.sharp) : 0;
          const along = smooth(spout.from, H, py);
          const s = spout.amount * c * along * along * smooth(0, rMax * 0.5, rho);
          rO -= s;
          rI -= s;
          y -= spout.lift * c * along * along;
        }
        const dO = sampleGrid(gO, rO, y);
        const dC = gC ? -sampleGrid(gC, rI, y) : -1e9;
        out.inner = gC ? smooth(-lipK * 0.6, lipK * 0.6, dC - dO) : 0;
        out.handle = handle ? 1 - smooth(-0.3, 0.3, handle.sdf(px, py, pz) - Math.max(dO, dC)) : 0;
        out.lipY = H;
      },
    };
    return shape;
  }

  /** A pulled handle: a flattened strap along a curve in the plane at angle `at` around the pot. */
  function handleShape(o) {
    const line = profileLine(o.path, 12);
    const sa = Math.sin(o.at);
    const ca = Math.cos(o.at);
    let u0 = Infinity;
    let u1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const [u, y] of line) {
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    const a = o.width;
    const b = o.thick;
    const m = Math.max(a, b);
    return {
      reach: u1 + b,
      join: o.join ?? 0.8,
      sdf(px, py, pz) {
        const u = px * sa + pz * ca;
        const w = px * ca - pz * sa;
        // The strap lies within its path's box grown by its thickness; far from that box, the distance to it is a safe answer.
        const qx = Math.max(u0 - b - u, u - u1 - b, 0);
        const qy = Math.max(y0 - b - py, py - y1 - b, 0);
        const qw = Math.max(Math.abs(w) - a, 0);
        const far = Math.sqrt(qx * qx + qy * qy + qw * qw);
        if (far > 2 + m) return far;
        let best = Infinity;
        for (let i = 0; i < line.length - 1; i++) {
          const ax = line[i][0];
          const ay = line[i][1];
          const ex = line[i + 1][0] - ax;
          const ey = line[i + 1][1] - ay;
          const wx = u - ax;
          const wy = py - ay;
          const h = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey));
          const dx = wx - ex * h;
          const dy = wy - ey * h;
          const dd = dx * dx + dy * dy;
          if (dd < best) best = dd;
        }
        const dp = Math.sqrt(best);
        const q = Math.sqrt((dp / b) ** 2 + (w / a) ** 2);
        return (q - 1) * Math.min(a, b) * 0.85;
      },
    };
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // The renderer: a camera with a shifted lens (verticals stay vertical), the wall, floor and plinths, the pots, one window's light.
  // -------------------------------------------------------------------------------------------------------------------------------

  const norm3 = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };

  /** Ray against a vertical cylinder (axis at x, z; radius r; between y0 and y1): the t range inside it, or null. */
  function rayCylinder(ox, oy, oz, dx, dy, dz, cx, cz, r, y0, y1) {
    const px = ox - cx;
    const pz = oz - cz;
    const a = dx * dx + dz * dz;
    let t0 = -Infinity;
    let t1 = Infinity;
    if (a > 1e-12) {
      const b = px * dx + pz * dz;
      const c = px * px + pz * pz - r * r;
      const disc = b * b - a * c;
      if (disc < 0) return null;
      const s = Math.sqrt(disc);
      t0 = (-b - s) / a;
      t1 = (-b + s) / a;
    } else if (px * px + pz * pz > r * r) return null;
    if (Math.abs(dy) > 1e-12) {
      let s0 = (y0 - oy) / dy;
      let s1 = (y1 - oy) / dy;
      if (s0 > s1) [s0, s1] = [s1, s0];
      t0 = Math.max(t0, s0);
      t1 = Math.min(t1, s1);
    } else if (oy < y0 || oy > y1) return null;
    if (t1 < Math.max(t0, 0)) return null;
    RANGE[0] = Math.max(t0, 0);
    RANGE[1] = t1;
    return RANGE;
  }
  const RANGE = [0, 0];

  function raySlab(ox, oy, oz, dx, dy, dz, b, pad) {
    let t0 = 0;
    let t1 = Infinity;
    const o = [ox, oy, oz];
    const d = [dx, dy, dz];
    for (let k = 0; k < 3; k++) {
      const lo = b.min[k] - pad;
      const hi = b.max[k] + pad;
      if (Math.abs(d[k]) < 1e-12) {
        if (o[k] < lo || o[k] > hi) return null;
      } else {
        let s0 = (lo - o[k]) / d[k];
        let s1 = (hi - o[k]) / d[k];
        if (s0 > s1) [s0, s1] = [s1, s0];
        if (s0 > t0) t0 = s0;
        if (s1 < t1) t1 = s1;
        if (t1 < t0) return null;
      }
    }
    RANGE[0] = t0;
    RANGE[1] = t1;
    return RANGE;
  }

  function sdBox(b, x, y, z) {
    const qx = Math.abs(x - b.cx) - b.hx + b.r;
    const qy = Math.abs(y - b.cy) - b.hy + b.r;
    const qz = Math.abs(z - b.cz) - b.hz + b.r;
    const ox = Math.max(qx, 0);
    const oy = Math.max(qy, 0);
    const oz = Math.max(qz, 0);
    return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - b.r;
  }

  /** A pot's distance in world units. */
  function objSdf(o, x, y, z) {
    const lx = (x - o.x) * o.inv;
    let ly = (y - o.y) * o.inv;
    let lz = (z - o.z) * o.inv;
    const px = o.cr * lx - o.sr * lz;
    lz = o.sr * lx + o.cr * lz;
    if (o.flip) {
      ly = o.shape.H - ly;
      lz = -lz;
    }
    return o.shape.sdf(px, ly, lz) * o.s;
  }

  function objLocal(o, x, y, z, out) {
    const lx = (x - o.x) * o.inv;
    let ly = (y - o.y) * o.inv;
    let lz = (z - o.z) * o.inv;
    const px = o.cr * lx - o.sr * lz;
    lz = o.sr * lx + o.cr * lz;
    if (o.flip) {
      ly = o.shape.H - ly;
      lz = -lz;
    }
    out.px = px;
    out.py = ly;
    out.pz = lz;
  }

  /**
   * Draws a scene into the picture. A scene: `cam` (`pos`, and `frame` [x0, y0, x1, y1, z]: the part of the plane at depth z the picture
   * shows), `light` (`dir` toward the window, `color`, `power`), `sky`/`ground`/`ambient`, `exposure`, `wall` (`z`, `paint`), `floor`
   * (`y`, `paint`), `boxes`, `objects`, `window` (the panes' light on the wall), `soft` (shadow sharpness), `ao` (radius, cm).
   */
  function render(ctx, w, h, S) {
    const [cx, cy, cz] = S.cam.pos;
    const [fx0, fy0, fx1, fy1, fz] = S.cam.frame;
    const pw = (fx1 - fx0) / w;
    const ph = (fy1 - fy0) / h;
    const pixAngle = pw / (cz - fz);
    const Ld = norm3(S.light.dir);
    const [Lx, Ly, Lz] = Ld;
    const kc = lin(S.light.color ?? "#fff1de");
    const kp = S.light.power ?? 1;
    const sky = lin(S.sky ?? "#f3efe9");
    const ground = lin(S.ground ?? "#c9b8a2");
    const amb = S.ambient ?? 0.5;
    const ambField = S.ambientField ?? null;
    const fill = S.fill ? { d: norm3(S.fill.dir), c: lin(S.fill.color ?? "#e9edf2"), p: S.fill.power ?? 0.1 } : null;
    const exposure = S.exposure ?? 1;
    const soft = S.soft ?? 7;
    const aoR = S.ao ?? 5;
    const wallZ = S.wall.z;
    const floor = S.floor ?? null;
    const W = S.window ?? null;
    // The window's light on the wall: a lattice of panes, read in wall coordinates after following the light back to the wall.
    if (W && !W.fn) {
      const det = W.a[0] * W.b[1] - W.a[1] * W.b[0];
      W.ia = [W.b[1] / det, -W.b[0] / det];
      W.ib = [-W.a[1] / det, W.a[0] / det];
      W.si = Math.abs(det) / Math.hypot(W.b[0], W.b[1]);
      W.sj = Math.abs(det) / Math.hypot(W.a[0], W.a[1]);
    }
    // Basis around the light for the window's reflection in glaze.
    const T1 = norm3([-Lz, 0, Lx]);
    const T2 = norm3([T1[1] * Lz - T1[2] * Ly, T1[2] * Lx - T1[0] * Lz, T1[0] * Ly - T1[1] * Lx]);
    const reflW = S.reflection ?? { w: 0.3, h: 0.42, bars: 0.022 };

    const boxes = (S.boxes ?? []).map((b, i) => ({
      ...b,
      i,
      cx: (b.min[0] + b.max[0]) / 2,
      cy: (b.min[1] + b.max[1]) / 2,
      cz: (b.min[2] + b.max[2]) / 2,
      hx: (b.max[0] - b.min[0]) / 2,
      hy: (b.max[1] - b.min[1]) / 2,
      hz: (b.max[2] - b.min[2]) / 2,
      r: b.r ?? 0.35,
    }));
    const objects = (S.objects ?? []).map((o, i) => {
      const s = o.s ?? 1;
      const rot = o.rot ?? 0;
      const ob = {
        ...o,
        i,
        s,
        inv: 1 / s,
        cr: Math.cos(rot),
        sr: Math.sin(rot),
        x: o.x,
        y: o.y ?? 0,
        z: o.z,
      };
      ob.R = o.shape.rBound * s;
      ob.y0 = ob.y - 0.4 * s;
      ob.y1 = ob.y + (o.shape.H + 0.8) * s;
      ob.cyMid = (ob.y0 + ob.y1) / 2;
      return ob;
    });
    // Each pot's grids at about half a pixel where it stands.
    for (const o of objects) {
      if (o.shape.built) continue;
      const dist = Math.hypot(cx - o.x, cy - o.cyMid, cz - o.z);
      const cell = Math.max(0.012, (pixAngle * dist * 0.6) / o.s);
      o.shape.build(cell);
      o.shape.built = true;
    }

    const HIT = { t: 0, kind: 0, idx: -1 };
    const KIND_NONE = 0;
    const KIND_WALL = 1;
    const KIND_FLOOR = 2;
    const KIND_BOX = 3;
    const KIND_OBJ = 4;

    function trace(ox, oy, oz, dx, dy, dz) {
      let best = Infinity;
      let kind = KIND_NONE;
      let idx = -1;
      if (dz < 0) {
        const t = (wallZ - oz) / dz;
        if (t > 0) {
          best = t;
          kind = KIND_WALL;
        }
      }
      if (floor && dy < 0) {
        const t = (floor.y - oy) / dy;
        if (t > 0 && t < best) {
          best = t;
          kind = KIND_FLOOR;
        }
      }
      for (const b of boxes) {
        const r = raySlab(ox, oy, oz, dx, dy, dz, b, 0.05);
        if (!r || r[0] >= best) continue;
        let t = r[0];
        const tEnd = Math.min(r[1], best);
        for (let i = 0; i < 64; i++) {
          const d = sdBox(b, ox + dx * t, oy + dy * t, oz + dz * t);
          if (d < pixAngle * t * 0.2) {
            if (t < best) {
              best = t;
              kind = KIND_BOX;
              idx = b.i;
            }
            break;
          }
          t += d;
          if (t > tEnd) break;
        }
      }
      for (const o of objects) {
        const r = rayCylinder(ox, oy, oz, dx, dy, dz, o.x, o.z, o.R, o.y0, o.y1);
        if (!r || r[0] >= best) continue;
        let t = r[0];
        const tEnd = Math.min(r[1], best);
        const step = o.shape.step;
        for (let i = 0; i < 220; i++) {
          const d = objSdf(o, ox + dx * t, oy + dy * t, oz + dz * t);
          if (d < pixAngle * t * 0.25) {
            if (t < best) {
              best = t;
              kind = KIND_OBJ;
              idx = o.i;
            }
            break;
          }
          t += Math.max(d * step, pixAngle * t * 0.1);
          if (t > tEnd) break;
        }
      }
      HIT.t = best;
      HIT.kind = kind;
      HIT.idx = idx;
    }

    // Occluders near a ray toward the light, gathered once per point.
    const cand = new Array(objects.length + boxes.length);
    function softShadow(px, py, pz) {
      let n = 0;
      let tEnd = 0;
      let stepK = 0.9;
      for (const o of objects) {
        const dist = Math.hypot(px - o.x, py - o.cyMid, pz - o.z);
        // Far enough from the ray that even its penumbra cannot reach the point.
        const m = (dist + o.R) / soft + 0.5;
        const r = rayCylinder(px, py, pz, Lx, Ly, Lz, o.x, o.z, o.R + m, o.y0 - m, o.y1 + m);
        if (r) {
          cand[n++] = o;
          tEnd = Math.max(tEnd, r[1]);
          if (o.shape.step < stepK) stepK = o.shape.step;
        }
      }
      const nObj = n;
      for (const b of boxes) {
        if (b.noShadow) continue;
        const pad = 1 + (Math.max(0, sdBox(b, px, py, pz)) + 40) / soft;
        const r = raySlab(px, py, pz, Lx, Ly, Lz, b, pad);
        if (r && r[1] > 0.01) {
          cand[n++] = b;
          tEnd = Math.max(tEnd, r[1]);
        }
      }
      if (n === 0) return 1;
      let res = 1;
      let t = 0.02;
      for (let i = 0; i < 90; i++) {
        const x = px + Lx * t;
        const y = py + Ly * t;
        const z = pz + Lz * t;
        let hh = Infinity;
        for (let k = 0; k < n; k++) {
          const d = k < nObj ? objSdf(cand[k], x, y, z) : sdBox(cand[k], x, y, z);
          if (d < hh) hh = d;
        }
        if (hh < 0.002) return 0;
        res = Math.min(res, (soft * hh) / t);
        t += clamp(hh * stepK, 0.04, 8);
        if (res < 0.003 || t > tEnd) break;
      }
      res = clamp(res);
      return res * res * (3 - 2 * res);
    }

    const aoCand = new Array(objects.length + boxes.length);
    function ambientOcclusion(px, py, pz, nx, ny, nz) {
      let n = 0;
      for (const o of objects) {
        const dxz = Math.hypot(px - o.x, pz - o.z) - o.R;
        const dyy = Math.max(o.y0 - py, py - o.y1, 0);
        if (Math.hypot(Math.max(dxz, 0), dyy) < aoR * 1.3) aoCand[n++] = o;
      }
      const nObj = n;
      for (const b of boxes) {
        if (sdBox(b, px, py, pz) < aoR * 1.3) aoCand[n++] = b;
      }
      let occ = 0;
      let wsum = 0;
      let wgt = 1;
      for (let i = 1; i <= 5; i++) {
        const hr = aoR * Math.pow(i / 5, 1.6);
        const x = px + nx * hr;
        const y = py + ny * hr;
        const z = pz + nz * hr;
        let d = z - wallZ;
        if (floor) d = Math.min(d, y - floor.y);
        for (let k = 0; k < n; k++) {
          const dd = k < nObj ? objSdf(aoCand[k], x, y, z) : sdBox(aoCand[k], x, y, z);
          if (dd < d) d = dd;
        }
        occ += clamp((hr - d) / hr) * wgt;
        wsum += wgt;
        wgt *= 0.8;
      }
      const o = occ / wsum;
      return clamp(1 - 0.72 * o * (0.6 + 0.4 * o));
    }

    function windowPattern(x, y, extraSoft) {
      const rx = x - W.o[0];
      const ry = y - W.o[1];
      const fi = rx * W.ia[0] + ry * W.ia[1];
      const fj = rx * W.ib[0] + ry * W.ib[1];
      const sft = W.soft + extraSoft;
      // Inside the frame.
      const open = W.open ?? 0;
      const ei = Math.min(fi, W.ni - fi) * W.si - W.frame;
      const ej = Math.min(fj, W.nj + open - fj) * W.sj - W.frame;
      let v = smooth(-sft, sft, Math.min(ei, ej));
      if (v <= 0) return 0;
      // Below the lattice (a door's or a low window's single pane) only the transom's shadow crosses the light.
      const di = Math.abs(fi - Math.round(fi)) * W.si;
      const dj = Math.abs(fj - Math.round(fj)) * W.sj;
      const mull = smooth(W.bar - sft, W.bar + sft, di);
      const tran = smooth(W.bar - sft, W.bar + sft, dj);
      v *= mix(1, mull, smooth(W.nj + 0.08, W.nj - 0.08, fj)) * mix(1, tran, smooth(W.nj + 0.6, W.nj + 0.4, fj));
      return v;
    }

    function windowLight(px, py, pz) {
      if (!W) return 1;
      const s = (pz - wallZ) / Lz;
      const qx = px - s * Lx;
      const qy = py - s * Ly;
      if (W.fn) return W.fn(qx, qy);
      const v = windowPattern(qx, qy, -Math.min(W.soft * 0.5, s * (W.sharpen ?? 0.03)));
      return mix(W.outside ?? 0, 1, v);
    }

    const M = { r: 0, g: 0, b: 0, rough: 0.8, spec: 0, bu: 0, bv: 0, bx: 0, by: 0, wrap: 0.1, sss: 0, coat: 0 };
    const Q = { px: 0, py: 0, pz: 0, rho: 0, theta: 0, y: 0, inner: 0, handle: 0, lipY: 0, aa: 0, H: 0, shape: null, nx: 0, ny: 0, nz: 0 };
    const OUT = [0, 0, 0];

    function shade(ox, oy, oz, dx, dy, dz) {
      trace(ox, oy, oz, dx, dy, dz);
      const t = HIT.t;
      if (HIT.kind === KIND_NONE) {
        OUT[0] = OUT[1] = OUT[2] = 0;
        return 0;
      }
      const px = ox + dx * t;
      const py = oy + dy * t;
      const pz = oz + dz * t;
      const aa = pixAngle * t;
      let nx = 0;
      let ny = 0;
      let nz = 1;
      M.rough = 0.85;
      M.spec = 0.02;
      M.bu = 0;
      M.bv = 0;
      M.bx = 0;
      M.by = 0;
      M.wrap = 0.12;
      M.sss = 0;
      M.coat = 0;
      let id = HIT.kind * 1000;
      if (HIT.kind === KIND_WALL) {
        S.wall.paint(px, py, M, aa);
        nx = -M.bx;
        ny = -M.by;
        nz = 1;
      } else if (HIT.kind === KIND_FLOOR) {
        floor.paint(px, pz, M, aa);
        nx = -M.bx;
        ny = 1;
        nz = -M.by;
      } else if (HIT.kind === KIND_BOX) {
        const b = boxes[HIT.idx];
        const e = Math.max(aa * 0.5, 0.01);
        nx = sdBox(b, px + e, py, pz) - sdBox(b, px - e, py, pz);
        ny = sdBox(b, px, py + e, pz) - sdBox(b, px, py - e, pz);
        nz = sdBox(b, px, py, pz + e) - sdBox(b, px, py, pz - e);
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l;
        ny /= l;
        nz /= l;
        const ax = Math.abs(nx);
        const ay = Math.abs(ny);
        const az = Math.abs(nz);
        const face = ay > ax && ay > az ? (ny > 0 ? 0 : 1) : az > ax ? 2 : nx > 0 ? 3 : 4;
        id += HIT.idx * 10 + face;
        b.paint(face, px, py, pz, M, aa);
        // The texture's bump on the face, in its own plane.
        if (face === 0 || face === 1) {
          nx -= M.bx;
          nz -= M.by;
        } else if (face === 2) {
          nx -= M.bx;
          ny -= M.by;
        } else {
          nz -= M.bx;
          ny -= M.by;
        }
      } else {
        const o = objects[HIT.idx];
        const e = Math.max(aa * 0.6, o.shape.thickness * 0.04);
        nx = objSdf(o, px + e, py, pz) - objSdf(o, px - e, py, pz);
        ny = objSdf(o, px, py + e, pz) - objSdf(o, px, py - e, pz);
        nz = objSdf(o, px, py, pz + e) - objSdf(o, px, py, pz - e);
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l;
        ny /= l;
        nz /= l;
        objLocal(o, px, py, pz, Q);
        o.shape.parts(Q.px, Q.py, Q.pz, Q);
        Q.rho = Math.hypot(Q.px, Q.pz);
        Q.theta = Math.atan2(Q.px, Q.pz);
        Q.y = Q.py;
        Q.H = o.shape.H;
        Q.aa = aa / o.s;
        Q.shape = o.shape;
        Q.nx = nx;
        Q.ny = ny;
        Q.nz = nz;
        Q.flip = Boolean(o.flip);
        o.paint(Q, M);
        id += o.i * 10 + (Q.inner > 0.5 ? 1 : 0) + (Q.handle > 0.5 ? 2 : 0);
        // Bump along the pot: v up its side, u around it.
        if (M.bv !== 0 || M.bu !== 0) {
          let tvx = -ny * nx;
          let tvy = 1 - ny * ny;
          let tvz = -ny * nz;
          const tl = Math.hypot(tvx, tvy, tvz) || 1;
          tvx /= tl;
          tvy /= tl;
          tvz /= tl;
          if (o.flip) {
            tvx = -tvx;
            tvy = -tvy;
            tvz = -tvz;
          }
          const tux = tvy * nz - tvz * ny;
          const tuy = tvz * nx - tvx * nz;
          const tuz = tvx * ny - tvy * nx;
          nx -= M.bv * tvx + M.bu * tux;
          ny -= M.bv * tvy + M.bu * tuy;
          nz -= M.bv * tvz + M.bu * tuz;
        }
      }
      // The geometric normal for offsets, the shading normal for light.
      const gl = Math.hypot(nx, ny, nz) || 1;
      nx /= gl;
      ny /= gl;
      nz /= gl;
      let gx = nx;
      let gy = ny;
      let gz = nz;
      if (HIT.kind === KIND_WALL) {
        gx = 0;
        gy = 0;
        gz = 1;
      } else if (HIT.kind === KIND_FLOOR) {
        gx = 0;
        gy = 1;
        gz = 0;
      }
      const vx = -dx;
      const vy = -dy;
      const vz = -dz;
      // Light from the window.
      const ndl = nx * Lx + ny * Ly + nz * Lz;
      const wrap = M.wrap;
      let diff = (ndl + wrap) / (1 + wrap);
      if (diff < 0) diff = 0;
      let vis = 0;
      const eo = Math.max(aa * 1.5, 0.03);
      const sx = px + gx * eo;
      const sy = py + gy * eo;
      const sz = pz + gz * eo;
      if (diff > 0 || M.spec > 0) {
        const win = windowLight(sx, sy, sz);
        if (win > 0.002) vis = win * softShadow(sx, sy, sz);
      }
      const ao = ambientOcclusion(sx, sy, sz, gx, gy, gz);
      const up = 0.5 + 0.5 * ny;
      let af = amb * ao;
      if (ambField) af *= ambField(px, py, pz);
      const hr = sky[0] * up + ground[0] * (1 - up);
      const hg = sky[1] * up + ground[1] * (1 - up);
      const hb = sky[2] * up + ground[2] * (1 - up);
      // Wax and thin clay let a little light through on the shadow side.
      const sss = M.sss * vis * Math.max(0, -ndl * 0.5 + 0.5) * 0.6;
      const kd = kp * diff * vis + sss * kp;
      let r = M.r * (kc[0] * kd + hr * af);
      let g = M.g * (kc[1] * kd + hg * af);
      let b = M.b * (kc[2] * kd + hb * af);
      // The room's fill from the front right: soft, no shadow but the occlusion.
      if (fill) {
        const fd = Math.max(0, (nx * fill.d[0] + ny * fill.d[1] + nz * fill.d[2] + 0.4) / 1.4) * fill.p * ao;
        r += M.r * fill.c[0] * fd;
        g += M.g * fill.c[1] * fd;
        b += M.b * fill.c[2] * fd;
      }
      // Glaze: the window seen in it, and the room at grazing angles.
      if (M.spec > 0) {
        const ndv = Math.max(0, nx * vx + ny * vy + nz * vz);
        const fr = 0.04 + 0.96 * Math.pow(1 - ndv, 5);
        const rx = 2 * ndv * nx - vx;
        const ry = 2 * ndv * ny - vy;
        const rz = 2 * ndv * nz - vz;
        const c = rx * Lx + ry * Ly + rz * Lz;
        let spec = 0;
        if (c > 0.05) {
          const ua = (rx * T1[0] + ry * T1[1] + rz * T1[2]) / c;
          const ub = (rx * T2[0] + ry * T2[1] + rz * T2[2]) / c;
          const rough = M.rough;
          const sft = 0.02 + rough * rough * 0.9;
          let win = smooth(-sft, sft, reflW.w - Math.abs(ua)) * smooth(-sft, sft, reflW.h - Math.abs(ub));
          if (win > 0) {
            const bar = reflW.bars;
            win *= smooth(bar - sft * 0.6, bar + sft * 0.6, Math.abs(ua));
            win *= smooth(bar - sft * 0.6, bar + sft * 0.6, Math.abs(Math.abs(ub) - reflW.h / 3));
          }
          spec = (win / (1 + rough * rough * 14)) * fr * 16 * vis;
        }
        const env = fr * (0.35 + af) * (1 - M.rough * 0.6) * 1.1;
        const ks = M.spec;
        r += ks * (sky[0] * kp * spec + (sky[0] * (0.5 + 0.5 * ry) + ground[0] * (0.5 - 0.5 * ry)) * env);
        g += ks * (sky[1] * kp * spec + (sky[1] * (0.5 + 0.5 * ry) + ground[1] * (0.5 - 0.5 * ry)) * env);
        b += ks * (sky[2] * kp * spec + (sky[2] * (0.5 + 0.5 * ry) + ground[2] * (0.5 - 0.5 * ry)) * env);
      }
      OUT[0] = r * exposure;
      OUT[1] = g * exposure;
      OUT[2] = b * exposure;
      return id;
    }

    // First pass: one ray per pixel.
    const buf = new Float32Array(w * h * 3);
    const ids = new Int32Array(w * h);
    const ray = (sxp, syp) => {
      const tx = fx0 + sxp * pw;
      const ty = fy1 - syp * ph;
      let dx = tx - cx;
      let dy = ty - cy;
      let dz = fz - cz;
      const l = Math.hypot(dx, dy, dz);
      dx /= l;
      dy /= l;
      dz /= l;
      return shade(cx, cy, cz, dx, dy, dz);
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = y * w + x;
        ids[k] = ray(x + 0.5, y + 0.5);
        buf[k * 3] = OUT[0];
        buf[k * 3 + 1] = OUT[1];
        buf[k * 3 + 2] = OUT[2];
      }
    }
    // Second pass: edges again with four rays each.
    const lum = (k) => buf[k * 3] * 0.3 + buf[k * 3 + 1] * 0.55 + buf[k * 3 + 2] * 0.15;
    const mark = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = y * w + x;
        if (x + 1 < w && (ids[k] !== ids[k + 1] || Math.abs(Math.sqrt(lum(k)) - Math.sqrt(lum(k + 1))) > 0.09)) mark[k] = mark[k + 1] = 1;
        if (y + 1 < h && (ids[k] !== ids[k + w] || Math.abs(Math.sqrt(lum(k)) - Math.sqrt(lum(k + w))) > 0.09)) mark[k] = mark[k + w] = 1;
      }
    }
    const offsets = [
      [0.375, 0.125],
      [0.875, 0.375],
      [0.625, 0.875],
      [0.125, 0.625],
    ];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = y * w + x;
        if (!mark[k]) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        for (const [ox, oy] of offsets) {
          ray(x + ox, y + oy);
          r += OUT[0];
          g += OUT[1];
          b += OUT[2];
        }
        buf[k * 3] = r / 4;
        buf[k * 3 + 1] = g / 4;
        buf[k * 3 + 2] = b / 4;
      }
    }
    finish(ctx, w, h, buf, S);
  }

  /** Linear light to the picture: the shoulder, a soft vignette, film grain, sRGB. */
  function finish(ctx, w, h, buf, S) {
    const img = ctx.createImageData(w, h);
    const random = L.rng(S.grainSeed ?? 5);
    const vig = S.vignette ?? 0.12;
    const grain = S.grain ?? 0.012;
    const sat = S.saturation ?? 0.86;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = y * w + x;
        const u = x / w - 0.5;
        const v = y / h - 0.5;
        const fall = 1 - vig * smooth(0.15, 0.75, Math.sqrt(u * u * 1.2 + v * v));
        const n = (random() + random() - 1) * grain;
        const r0 = buf[k * 3];
        const g0 = buf[k * 3 + 1];
        const b0 = buf[k * 3 + 2];
        const lum = r0 * 0.2126 + g0 * 0.7152 + b0 * 0.0722;
        const rgb = [lum + (r0 - lum) * sat, lum + (g0 - lum) * sat, lum + (b0 - lum) * sat];
        for (let c = 0; c < 3; c++) {
          const val = toSrgb(shoulder(Math.max(0, rgb[c]) * fall)) + n;
          img.data[k * 4 + c] = clamp(val) * 255 + 0.5;
        }
        img.data[k * 4 + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // Surfaces: plaster, travertine, oak, the floor
  // -------------------------------------------------------------------------------------------------------------------------------

  /** Limewashed plaster: soft clouds, faint trowel sweeps, a fine relief the window light rakes across. */
  function plaster(seed, { color = PALETTE.plaster, scale = 1 } = {}) {
    const n1 = L.simplex(seed);
    const n2 = L.simplex(seed + 1);
    const n3 = L.simplex(seed + 2);
    const c = lin(color);
    return (x, y, out) => {
      const X = x / scale;
      const Y = y / scale;
      const cloud = L.fbm(n1, X * 0.011, Y * 0.011, 4);
      const mid = L.fbm(n2, X * 0.05, Y * 0.05, 3);
      const sweep = n3(X * 0.018 + Y * 0.03, Y * 0.07 - X * 0.012);
      const k = 1 + cloud * 0.03 + mid * 0.009 + sweep * 0.007;
      out.r = c[0] * k * (1 + cloud * 0.012);
      out.g = c[1] * k;
      out.b = c[2] * k * (1 - cloud * 0.02);
      const e = 0.6;
      const hgt = (a, b) => n2(a * 0.16 + b * 0.05, b * 0.3) * 0.03 + n3(a * 0.9 + b * 0.3, b * 0.6) * 0.006;
      const h0 = hgt(X, Y);
      out.bx = (hgt(X + e, Y) - h0) / e;
      out.by = (hgt(X, Y + e) - h0) / e;
      out.rough = 0.95;
      out.spec = 0;
      out.wrap = 0.05;
    };
  }

  /** Travertine: soft bedding in long bands, many small voids stretched along it, a little honey in the stone. */
  function travertine(seed, { color = "#e0d6c6", scale = 1 } = {}) {
    const n1 = L.simplex(seed);
    const n2 = L.simplex(seed + 1);
    const n3 = L.simplex(seed + 2);
    const c = lin(color);
    const warm = lin("#cdbba0");
    const pale = lin("#e8e0d3");
    return (face, x, y, z, out, aa) => {
      // Faces read the stone in their own plane: bands run along x, and along z on the sides.
      const a = (face === 3 || face === 4 ? z : x) / scale;
      const b = (face === 0 || face === 1 ? z * 0.5 + 30 : y) / scale;
      const warp = L.fbm(n2, a * 0.015, b * 0.04, 3) * 2.5;
      const band = L.fbm(n1, a * 0.004, (b + warp) * 0.11, 4);
      const fine = n3(a * 0.03, (b + warp) * 0.9);
      const t = clamp(0.55 + band * 0.75 + fine * 0.08);
      const blend = 0.5;
      let r = mix(c[0], mix(warm[0], pale[0], t), blend);
      let g = mix(c[1], mix(warm[1], pale[1], t), blend);
      let bb = mix(c[2], mix(warm[2], pale[2], t), blend);
      // Voids: small, stretched along the bedding, gathered in some bands more than others.
      const dens = 0.1 + 0.22 * smooth(-0.2, 0.5, n2(a * 0.01, (b + warp) * 0.18));
      const pit = speckle(a * 0.34, (b + warp) * 1.2, 0.36, dens, 0.03, 0.11, seed + 9, aa * 0.4);
      const shade = 1 - pit * 0.2 - SPECK.halo * 0.025;
      out.r = r * shade;
      out.g = g * shade;
      out.b = bb * shade * 0.985;
      out.bx = 0;
      out.by = 0;
      out.rough = 0.8;
      out.spec = 0.04;
      out.wrap = 0.08;
    };
  }

  /** A microcement floor: warm grey, softly clouded, a little sheen. */
  function microcement(seed, { color = "#cdc1b0" } = {}) {
    const n1 = L.simplex(seed);
    const n2 = L.simplex(seed + 1);
    const c = lin(color);
    return (x, z, out) => {
      const k = 1 + L.fbm(n1, x * 0.01, z * 0.02, 4) * 0.06 + n2(x * 0.12, z * 0.2) * 0.012;
      out.r = c[0] * k;
      out.g = c[1] * k;
      out.b = c[2] * k;
      out.bx = 0;
      out.by = 0;
      out.rough = 0.6;
      out.spec = 0.08;
      out.wrap = 0.05;
    };
  }

  /** Oiled oak: honey with long grain, its rays and pores along the plank. */
  function oak(seed) {
    const n1 = L.simplex(seed);
    const n2 = L.simplex(seed + 1);
    const light = lin("#c9a681");
    const dark = lin("#9c7651");
    return (face, x, y, z, out, aa) => {
      const a = x;
      const b = face === 0 || face === 1 ? z * 0.9 : face === 2 ? y * 3 + 50 : y * 3 + z;
      const warp = L.fbm(n1, a * 0.006, b * 0.04, 3) * 7;
      const ring = 0.5 + 0.5 * Math.sin((b + warp) * 2.1 + n2(a * 0.02, b * 0.3) * 1.5);
      const fig = L.fbm(n2, a * 0.02, (b + warp) * 0.25, 3);
      const t = clamp(0.55 + fig * 0.5 - Math.pow(ring, 6) * 0.35);
      const pore = speckle(a * 0.18, (b + warp) * 2.2, 0.5, 0.25, 0.04, 0.12, seed + 3, aa * 0.3);
      const k = 1 - pore * 0.22;
      out.r = mix(dark[0], light[0], t) * k;
      out.g = mix(dark[1], light[1], t) * k;
      out.b = mix(dark[2], light[2], t) * k;
      out.bx = 0;
      out.by = 0;
      out.rough = 0.6;
      out.spec = 0.1;
      out.wrap = 0.1;
    };
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // Glazes
  // -------------------------------------------------------------------------------------------------------------------------------

  const TOAST = "#b48d6c";

  /**
   * A thrown pot's surface: a glaze that varies as it is thick or thin (pooled darker, broken lighter at the lip), ending above a raw,
   * speckled foot with a wavy line and a drip or two; throwing rings under it; iron spots everywhere.
   */
  function glaze(o) {
    const g = lin(o.color);
    const gPool = lin(o.pool ?? o.color);
    const gThin = lin(o.thin ?? o.color);
    const clay = lin(o.clay ?? TOAST);
    const inner = o.inner ? lin(o.inner) : null;
    const innerPool = o.innerPool ? lin(o.innerPool) : inner;
    const spot = lin(o.spot ?? "#5b3a26");
    const seed = o.seed ?? 1;
    const nA = L.simplex(seed);
    const nB = L.simplex(seed + 1);
    const nC = L.simplex(seed + 2);
    const random = L.rng(seed + 3);
    const drips = Array.from({ length: o.drips ?? 2 }, () => ({ at: random.range(-1.1, 1.1), len: random.range(0.35, 0.9), w: random.range(0.06, 0.1) }));
    const flash = lin(o.flash ?? "#b9774a");
    const line = o.line ?? 1.2;
    const rough = o.rough ?? 0.5;
    const spec = o.spec ?? 0.35;
    const rings = o.rings ?? 0.02;
    const ringStep = o.ringStep ?? 1.3;
    const speck = o.speck ?? 0.18;
    const speckSize = o.speckSize ?? 1;
    const lipBand = o.lipBand ?? 0.9;
    const lipThin = o.lipThin ?? (o.lipBand ? 1.3 : 0.75);
    const raw = Boolean(o.raw);
    const cloud = o.cloud ? lin(o.cloud) : null;
    const cloudAmt = o.cloudAmt ?? 0.5;
    return (q, out) => {
      const u = q.theta * Math.max(q.rho, 0.5);
      const v = q.y;
      const isInner = q.inner > 0.5;
      // On a near-flat surface (a dish's floor) the texture is read from above, not around.
      const flat = smooth(0.6, 0.85, Math.abs(q.ny));
      // Thickness of the glaze: 1 as applied, more where it pooled, less where it broke over an edge.
      let low = L.fbm(nA, u * 0.07 + (isInner ? 40 : 0), v * 0.07, 3);
      let mid = nB(u * 0.35, v * 0.35);
      if (flat > 0) {
        low = mix(low, L.fbm(nA, q.px * 0.07 + 40, q.pz * 0.07, 3), flat);
        mid = mix(mid, nB(q.px * 0.35, q.pz * 0.35), flat);
      }
      let thick = 1 + low * 0.35 + mid * 0.07;
      thick -= smooth(q.lipY - lipBand, q.lipY - lipBand * 0.08, v) * lipThin;
      // The glaze line above the foot, with a drip or two below it.
      let gl = line + 0.2 * nC(q.theta * 1.6, 3.3) + 0.03 * nC(q.theta * 7, 7.1);
      for (const d of drips) {
        const dt = Math.atan2(Math.sin(q.theta - d.at), Math.cos(q.theta - d.at));
        const x = dt / d.w;
        // A drip: a rounded tongue of glaze, narrow where it left the line.
        gl -= d.len * Math.exp(-x * x * (1 + 0.6 * Math.abs(x)));
      }
      const onGlaze = raw ? 0 : isInner ? 1 : smooth(gl - 0.05, gl + 0.05, v);
      if (!isInner && !raw) thick += 0.45 * Math.exp(-(((v - gl - 0.18) / 0.16) ** 2));
      if (isInner) thick += 0.6 * (1 - smooth(q.shape.thickness * 2, q.shape.thickness * 2 + 2.5, v));
      const base = isInner && inner ? inner : g;
      const pool = isInner && innerPool ? innerPool : gPool;
      const tThin = smooth(0.15, 0.95, thick);
      const tPool = smooth(1.05, 1.8, thick);
      let r = mix(mix(gThin[0], base[0], tThin), pool[0], tPool);
      let gg = mix(mix(gThin[1], base[1], tThin), pool[1], tPool);
      let b = mix(mix(gThin[2], base[2], tThin), pool[2], tPool);
      // Milky clouds where the glaze ran thicker or thinner.
      if (cloud && !isInner) {
        const cv = smooth(-0.15, 0.55, L.fbm(nC, u * 0.045 + 5.3, v * 0.055 - 2.1, 4)) * cloudAmt;
        r = mix(r, cloud[0], cv);
        gg = mix(gg, cloud[1], cv);
        b = mix(b, cloud[2], cv);
      }
      // The raw foot: toasted clay with its own grain, and the warm flashing where the glaze's edge met it in the kiln.
      const cl = 1 + nB(u * 0.9, v * 0.9) * 0.06;
      const fl = raw || isInner ? 0 : Math.exp(-(((v - gl + 0.07) / 0.09) ** 2)) * 0.55;
      r = mix(mix(clay[0] * cl, flash[0], fl), r, onGlaze);
      gg = mix(mix(clay[1] * cl, flash[1], fl), gg, onGlaze);
      b = mix(mix(clay[2] * cl, flash[2], fl), b, onGlaze);
      // Iron spots bleeding through.
      const aa = q.aa;
      speckle(u, v, 0.32 * speckSize, speck, 0.01 * speckSize, 0.07 * speckSize, seed + 11, aa);
      let core = SPECK.core;
      let halo = SPECK.halo;
      if (flat > 0) {
        speckle(q.px, q.pz, 0.32 * speckSize, speck, 0.01 * speckSize, 0.07 * speckSize, seed + 11, aa);
        core = mix(core, SPECK.core, flat);
        halo = mix(halo, SPECK.halo, flat);
      }
      halo *= onGlaze * 0.8 + 0.2;
      r = mix(mix(r, r * 0.86 * (spot[0] / 0.3 + 0.7) * 0.6, halo * 0.35), spot[0], core * 0.85);
      gg = mix(mix(gg, gg * 0.84, halo * 0.35), spot[1], core * 0.85);
      b = mix(mix(b, b * 0.8, halo * 0.35), spot[2], core * 0.85);
      out.r = r;
      out.g = gg;
      out.b = b;
      out.rough = mix(0.9, rough - (tPool * 0.15), onGlaze);
      out.spec = mix(0.02, spec, onGlaze);
      // Throwing rings, felt more on the raw clay.
      const ph = (v / ringStep) * TAU + 2.2 * nA(q.theta * 1.3, v * 0.06);
      const amp = rings * (onGlaze ? 1 : 2.2) * (isInner ? 0.5 : 1) * (1 - q.handle);
      out.bv = amp * Math.cos(ph) * (TAU / ringStep) * 0.12;
      // A moon jar's two halves meet in a faint seam.
      if (o.seam && !isInner) {
        const sv = (v - o.seam) / 0.45;
        out.bv += -0.06 * 2 * sv * Math.exp(-sv * sv);
      }
      out.bu = 0;
      out.wrap = 0.12;
    };
  }

  /** Unglazed clay: its colour drifting as it dried, the wheel's rings, dark iron and pale grog in it, a chalky surface. */
  function rawClay(o = {}) {
    const c = lin(o.color ?? PALETTE.clay);
    const c2 = lin(o.dry ?? "#c9937a");
    const seed = o.seed ?? 3;
    const nA = L.simplex(seed);
    const nB = L.simplex(seed + 1);
    const rings = o.rings ?? 0.05;
    const ringStep = o.ringStep ?? 1.05;
    const dryAmt = o.dryAmt ?? 0.55;
    return (q, out) => {
      const u = q.theta * Math.max(q.rho, 0.5);
      const v = q.y;
      const dry = smooth(-0.4, 0.6, L.fbm(nA, u * 0.05, v * 0.05, 3)) * dryAmt;
      const k = 1 + nB(u * 0.6, v * 0.6) * 0.04 + nB(u * 3, v * 3) * 0.025;
      let r = mix(c[0], c2[0], dry) * k;
      let g = mix(c[1], c2[1], dry) * k;
      let b = mix(c[2], c2[2], dry) * k;
      if (q.inner > 0.5) {
        r *= 0.93;
        g *= 0.91;
        b *= 0.91;
      }
      speckle(u, v, 0.28, 0.16, 0.008, 0.05, seed + 11, q.aa);
      const dark = SPECK.core;
      speckle(u + 7.7, v + 3.1, 0.24, 0.12, 0.006, 0.032, seed + 21, q.aa);
      const pale = SPECK.core;
      r = mix(mix(r, r * 0.55, dark * 0.75), Math.min(1, r * 1.3), pale * 0.55);
      g = mix(mix(g, g * 0.52, dark * 0.75), Math.min(1, g * 1.32), pale * 0.55);
      b = mix(mix(b, b * 0.5, dark * 0.75), Math.min(1, b * 1.35), pale * 0.55);
      out.r = r;
      out.g = g;
      out.b = b;
      out.rough = 0.93;
      out.spec = 0.03;
      out.wrap = 0.16;
      const ph = (v / ringStep) * TAU + 2 * nA(q.theta * 1.2, v * 0.05);
      out.bv = rings * Math.cos(ph) * (TAU / ringStep) * 0.12 * (q.inner > 0.5 ? 0.6 : 1) * (1 - q.handle);
      out.bu = 0;
    };
  }

  /** Candle wax: cream, a little translucent, the faint rings of being dipped. */
  function wax(o = {}) {
    const c = lin(o.color ?? "#efe6d2");
    const n = L.simplex(o.seed ?? 7);
    return (q, out) => {
      const v = q.y;
      const k = 1 + n(q.theta * 1.5, v * 0.25) * 0.02;
      out.r = c[0] * k;
      out.g = c[1] * k;
      out.b = c[2] * k * 0.99;
      out.rough = 0.5;
      out.spec = 0.16;
      out.wrap = 0.45;
      out.sss = 0.9;
      out.bv = 0.01 * Math.cos((v / 0.55) * TAU) * 1.2;
      out.bu = 0;
    };
  }

  /** A wick, cotton, darkened at its trimmed tip. */
  function wick() {
    const cotton = lin("#d6ccbb");
    const tip = lin("#3d3632");
    return (q, out) => {
      const t = smooth(0.55, 0.9, q.y / q.H);
      out.r = mix(cotton[0], tip[0], t);
      out.g = mix(cotton[1], tip[1], t);
      out.b = mix(cotton[2], tip[2], t);
      out.rough = 0.95;
      out.spec = 0;
      out.wrap = 0.3;
      out.bv = 0;
      out.bu = 0;
    };
  }

  /** Raw clay outside and a glaze inside, the glaze lapping over the lip and a little way down, with its edge flashed warm. */
  function split(outside, inside, { over = 0.6, seed = 5 } = {}) {
    const n = L.simplex(seed);
    const flash = lin("#b4703f");
    const A = { r: 0, g: 0, b: 0, rough: 0, spec: 0, bu: 0, bv: 0, wrap: 0, sss: 0 };
    return (q, out) => {
      if (q.inner > 0.5) return inside(q, out);
      const edge = q.lipY - over + 0.18 * n(q.theta * 2.3, 1.7) + 0.05 * n(q.theta * 9, 4.2);
      const t = smooth(edge - 0.04, edge + 0.04, q.y);
      if (t >= 1) return inside(q, out);
      outside(q, out);
      const fl = Math.exp(-(((q.y - edge + 0.06) / 0.08) ** 2)) * 0.5;
      out.r = mix(out.r, flash[0], fl);
      out.g = mix(out.g, flash[1], fl);
      out.b = mix(out.b, flash[2], fl);
      if (t <= 0) return;
      for (const k in A) A[k] = out[k];
      inside(q, out);
      for (const k in A) out[k] = mix(A[k], out[k], t);
    };
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // The pieces (cm)
  // -------------------------------------------------------------------------------------------------------------------------------

  const SHAPES = {
    tallVase: () =>
      vessel({
        outer: [
          [4.9, 0, "c"],
          [5.5, 0.35, "c"],
          [5.5, 0.9],
          [5.3, 1.5],
          [6.4, 4],
          [7.9, 10],
          [8.5, 16],
          [8.1, 22],
          [6.6, 28.6],
          [4.6, 34],
          [3.5, 37.8],
          [3.25, 39.8],
          [3.55, 41.4],
          [3.85, 42, "c"],
        ],
        thickness: 0.6,
        floor: 1.2,
        wobble: 0.035,
        seed: 21,
      }),
    moonJar: () =>
      vessel({
        outer: [
          [6.8, 0, "c"],
          [7.4, 0.4, "c"],
          [7.5, 1.1],
          [9.6, 2.6],
          [13.2, 6.4],
          [15.9, 11.4],
          [16.8, 16.8],
          [16.3, 21.8],
          [14.4, 26.4],
          [11.2, 29.9],
          [8.7, 31.7],
          [8.3, 32.7],
          [8.6, 33.6],
          [8.9, 34, "c"],
        ],
        thickness: 0.8,
        floor: 1.4,
        wobble: 0.16,
        seed: 31,
      }),
    lowBowl: () =>
      vessel({
        outer: [
          [4.8, 0, "c"],
          [5.25, 0.35, "c"],
          [5.2, 1.0],
          [6.4, 1.5],
          [9.4, 3.2],
          [11.7, 5.3],
          [12.7, 7.1],
          [12.95, 7.9, "c"],
        ],
        thickness: 0.7,
        floor: 1.2,
        fillet: 2.6,
        wobble: 0.06,
        seed: 41,
      }),
    budTall: () =>
      vessel({
        outer: [
          [2.2, 0, "c"],
          [2.5, 0.3, "c"],
          [2.6, 0.8],
          [3.6, 3],
          [4.1, 6],
          [3.6, 9],
          [1.9, 11.8],
          [1.25, 13.3],
          [1.3, 14.5],
          [1.5, 15, "c"],
        ],
        thickness: 0.35,
        floor: 0.7,
        wobble: 0.03,
        seed: 51,
      }),
    budRound: () =>
      vessel({
        outer: [
          [2.4, 0, "c"],
          [2.7, 0.3, "c"],
          [2.8, 0.8],
          [4.3, 3.4],
          [4.8, 5.5],
          [4.2, 7.8],
          [2.3, 9.6],
          [1.15, 10.4],
          [1.1, 11.0],
          [1.3, 11.5, "c"],
        ],
        thickness: 0.35,
        floor: 0.7,
        wobble: 0.03,
        seed: 52,
      }),
    budBottle: () =>
      vessel({
        outer: [
          [2.6, 0, "c"],
          [2.9, 0.3, "c"],
          [3.0, 0.9],
          [3.15, 4],
          [3.2, 6.5],
          [2.95, 8.4],
          [1.7, 9.9],
          [1.05, 11],
          [1.0, 12.4],
          [1.2, 13, "c"],
        ],
        thickness: 0.35,
        floor: 0.7,
        wobble: 0.025,
        seed: 53,
      }),
    ridgeBowl: () =>
      vessel({
        outer: [
          [5.2, 0, "c"],
          [5.65, 0.35, "c"],
          [5.6, 1.0],
          [6.6, 1.5],
          [9.1, 3.3],
          [10.9, 5.5],
          [11.8, 7.7],
          [12.05, 9.4],
          [12.0, 9.6, "c"],
        ],
        thickness: 0.75,
        floor: 1.2,
        fillet: 2.6,
        ridges: { from: 1.6, to: 8.7, ease: 0.7, count: 34, depth: 0.3 },
        seed: 61,
      }),
    dish: () =>
      vessel({
        outer: [
          [8.8, 0, "c"],
          [9.3, 0.3, "c"],
          [9.3, 0.75],
          [10.6, 1.05],
          [14.2, 1.95],
          [16.2, 2.85],
          [16.85, 3.35],
          [17.0, 3.6, "c"],
        ],
        thickness: 0.65,
        floor: 0.85,
        fillet: 2.4,
        wobble: 0.05,
        seed: 71,
      }),
    cupTall: () =>
      vessel({
        outer: [
          [2.9, 0, "c"],
          [3.25, 0.3, "c"],
          [3.3, 0.9],
          [3.65, 1.3],
          [3.9, 3.0],
          [4.1, 6.0],
          [4.22, 8.4],
          [4.18, 9.0, "c"],
        ],
        thickness: 0.42,
        floor: 0.85,
        fillet: 1.0,
        wobble: 0.025,
        seed: 81,
      }),
    cupWide: () =>
      vessel({
        outer: [
          [3.0, 0, "c"],
          [3.35, 0.3, "c"],
          [3.4, 0.85],
          [3.9, 1.4],
          [4.4, 3.2],
          [4.6, 5.6],
          [4.62, 7.4],
          [4.55, 7.9, "c"],
        ],
        thickness: 0.42,
        floor: 0.85,
        fillet: 1.0,
        wobble: 0.025,
        seed: 82,
      }),
    pitcher: () =>
      vessel({
        outer: [
          [5.4, 0, "c"],
          [5.9, 0.35, "c"],
          [6.0, 1.0],
          [7.3, 3.6],
          [8.3, 8.6],
          [7.9, 13.2],
          [6.4, 17.4],
          [5.5, 20.0],
          [5.6, 22.2],
          [6.1, 23.6],
          [6.25, 24, "c"],
        ],
        thickness: 0.6,
        floor: 1.1,
        spout: { at: -1.12, amount: 2.4, sharp: 6, from: 17.5, lift: 0.9 },
        handle: {
          at: -1.12 + Math.PI,
          path: [
            [5.0, 21.0],
            [8.2, 21.3],
            [11.0, 19.9],
            [12.3, 16.4],
            [11.8, 12.0],
            [10.0, 8.6],
            [7.8, 6.3],
            [7.0, 5.6],
          ],
          width: 1.25,
          thick: 0.62,
          join: 0.9,
        },
        seed: 91,
      }),
    holderLow: () =>
      vessel({
        outer: [
          [5.0, 0, "c"],
          [5.5, 0.3, "c"],
          [5.6, 0.8],
          [5.1, 1.4],
          [3.4, 1.9],
          [2.2, 2.5],
          [1.95, 3.6],
          [1.95, 5.0],
          [2.15, 5.5, "c"],
        ],
        inner: [
          [0, 2.7, "c"],
          [1.2, 2.7, "c"],
          [1.2, 5.5, "c"],
        ],
        thickness: 0.7,
        lip: 0.45,
        wobble: 0.03,
        seed: 101,
      }),
    holderRound: () =>
      vessel({
        outer: [
          [2.6, 0, "c"],
          [2.95, 0.3, "c"],
          [3.1, 0.8],
          [3.9, 2.0],
          [4.15, 3.2],
          [3.8, 4.4],
          [2.7, 5.3],
          [2.0, 5.7],
          [1.95, 6.0],
          [2.1, 6.3, "c"],
        ],
        inner: [
          [0, 3.2, "c"],
          [1.2, 3.2, "c"],
          [1.2, 6.3, "c"],
        ],
        thickness: 0.7,
        lip: 0.45,
        wobble: 0.03,
        seed: 102,
      }),
    taper: (len) =>
      vessel({
        outer: [
          [1.13, 0, "c"],
          [1.13, 0.5],
          [1.09, len * 0.55],
          [1.02, len - 0.9],
          [0.88, len - 0.28],
          [0.45, len - 0.03],
          [0.0, len, "c"],
        ],
        solid: true,
        thickness: 0.6,
      }),
    wick: () =>
      vessel({
        outer: [
          [0.08, 0, "c"],
          [0.085, 0.4],
          [0.075, 0.9],
          [0.05, 1.15],
          [0.0, 1.2, "c"],
        ],
        solid: true,
        thickness: 0.05,
      }),
    // For the studio's shelves.
    jar: () =>
      vessel({
        outer: [
          [4.4, 0, "c"],
          [4.8, 0.3, "c"],
          [4.9, 0.9],
          [6.0, 3],
          [6.6, 7],
          [6.3, 11],
          [5.0, 13.6],
          [4.2, 14.3],
          [4.2, 15.2],
          [4.45, 15.6, "c"],
        ],
        thickness: 0.6,
        wobble: 0.05,
        seed: 111,
      }),
    bottle: () =>
      vessel({
        outer: [
          [3.6, 0, "c"],
          [4.0, 0.3, "c"],
          [4.1, 0.9],
          [4.6, 4],
          [4.7, 10],
          [4.3, 13],
          [2.4, 15.6],
          [1.4, 17.2],
          [1.3, 21.5],
          [1.55, 22, "c"],
        ],
        thickness: 0.5,
        wobble: 0.04,
        seed: 112,
      }),
    cylinder: () =>
      vessel({
        outer: [
          [4.2, 0, "c"],
          [4.55, 0.3, "c"],
          [4.6, 0.9],
          [4.75, 6],
          [4.8, 14],
          [4.7, 17.6],
          [4.85, 18, "c"],
        ],
        thickness: 0.55,
        wobble: 0.05,
        seed: 113,
      }),
    vaseNarrow: () =>
      vessel({
        outer: [
          [3.3, 0, "c"],
          [3.6, 0.3, "c"],
          [3.7, 0.9],
          [4.6, 4],
          [5.0, 8],
          [4.3, 13],
          [2.6, 17.5],
          [2.2, 20.5],
          [2.5, 22.6],
          [2.75, 23, "c"],
        ],
        thickness: 0.5,
        wobble: 0.04,
        seed: 114,
      }),
  };

  // -------------------------------------------------------------------------------------------------------------------------------
  // Glazes as named here
  // -------------------------------------------------------------------------------------------------------------------------------

  const GLAZE = {
    chalk: (seed, extra = {}) => glaze({ color: "#e2dccf", pool: "#d3cab9", thin: "#dcd5c7", seed, rough: 0.72, spec: 0.22, line: 1.1, speck: 0.13, speckSize: 0.85, ...extra }),
    warmWhite: (seed, extra = {}) =>
      glaze({ color: "#ebe5da", pool: "#e2d7c5", thin: "#e9e1d4", cloud: "#dfdfda", cloudAmt: 0.6, seed, rough: 0.24, spec: 0.6, line: 1.3, speck: 0.07, speckSize: 0.8, ...extra }),
    charcoal: (seed, extra = {}) =>
      glaze({ color: PALETTE.charcoal, pool: "#1d1b19", thin: "#6b4a35", spot: "#9b8a74", seed, rough: 0.34, spec: 0.6, line: 1.0, speck: 0.05, speckSize: 0.7, rings: 0.025, ...extra }),
    sage: (seed, extra = {}) => glaze({ color: PALETTE.sage, pool: "#7c8b6e", thin: "#bcc0aa", seed, rough: 0.3, spec: 0.55, line: 1.0, speck: 0.12, ...extra }),
    ochre: (seed, extra = {}) => glaze({ color: PALETTE.ochre, pool: "#9d6f34", thin: "#dcbf86", seed, rough: 0.3, spec: 0.55, line: 1.0, speck: 0.14, ...extra }),
    cream: (seed, extra = {}) => glaze({ color: "#ece4d4", pool: "#d7c8ad", thin: "#e6dccb", seed, rough: 0.35, spec: 0.5, speck: 0.12, ...extra }),
  };

  // -------------------------------------------------------------------------------------------------------------------------------
  // Scenes
  // -------------------------------------------------------------------------------------------------------------------------------

  /** The light every picture shares: from the upper left, a little in front. */
  const LIGHT = { dir: [-0.78, 0.46, 0.42], color: "#fff4e6", power: 1.05 };

  /**
   * The studio: the plaster wall at z = 0, plinths standing against it, pieces on them, a camera with a shifted lens framing `size` cm
   * across at the pieces. A piece without a `z` stands just clear of the wall. `window` is the panes' light on the wall.
   */
  function studio(w, h, { size, top = 0.7, elev = 0.12, items, plinths, window: win, floor = null, seed = 1, light = LIGHT, gap = 3.5, exposure = 1.12, cx = 0, ao = null, ambient = 0.46, dist: distance = null, ambientField = null, look: lookAt = null }) {
    const fw = size;
    const fh = (size * h) / w;
    const k = size / 44;
    const objects = items.map((it) => ({ ...it, z: it.z ?? it.shape.rBound * (it.s ?? 1) + gap }));
    const zMid = objects.reduce((sum, o) => sum + o.z, 0) / Math.max(1, objects.length);
    const dist = distance ?? size * 7;
    const y1 = fh * top;
    const y0 = y1 - fh;
    const look = lookAt ?? (y0 + y1) / 2;
    const xMid = cx;
    return {
      cam: { pos: [xMid, look + dist * Math.tan(elev), zMid + dist], frame: [xMid - fw / 2, y0, xMid + fw / 2, y1, zMid] },
      light,
      fill: { dir: [0.55, 0.15, 0.82], power: 0.13 },
      ambient,
      ambientField,
      ground: "#d2c3ae",
      exposure,
      vignette: 0.1,
      soft: 6,
      ao: ao ?? 4 * Math.sqrt(k),
      wall: { z: 0, paint: plaster(seed + 100, { scale: k }) },
      floor,
      boxes: plinths.map((p, i) => ({ r: 0.35 * Math.sqrt(k), paint: travertine(seed + 200 + i * 7, { scale: Math.sqrt(k) }), ...p })),
      objects,
      window: win ?? {
        fn: (x, y) => {
          const d = ((x - xMid + fw * 0.1) * 0.62 + (y - y1 * 0.55) * 0.78) / fw;
          return 1 - 0.5 * smooth(0.05, 0.7, d);
        },
      },
    };
  }

  /** A product's picture: one piece (or one set) on a plinth, 3:4. */
  function product(items, { size, elev = 0.12, top = 0.7, seed = 1 }) {
    return {
      w: 1200,
      h: 1600,
      quality: 84,
      draw(ctx, w, h) {
        const its = items();
        const depth = Math.max(...its.map((o) => (o.z ?? o.shape.rBound * (o.s ?? 1) + 3.5) + o.shape.rBound * (o.s ?? 1))) + 5;
        const half = Math.max(size * 0.34, ...its.map((o) => Math.abs(o.x) + o.shape.rBound * (o.s ?? 1) + size * 0.07));
        render(ctx, w, h, studio(w, h, { size, top, elev, seed, items: its, plinths: [{ min: [-half, -200, -2], max: [half, 0, depth] }] }));
      },
    };
  }

  /** A candle in its holder: the holder, the taper in its socket and the wick. */
  function candleSet(holder, socket, len, x, z, seed) {
    return [
      { shape: holder, x, z, y: 0, rot: seed, paint: GLAZE.charcoal(seed, { line: 0.6, drips: 1 }) },
      { shape: SHAPES.taper(len), x, z, y: socket, paint: wax({ seed }) },
      { shape: SHAPES.wick(), x: x + 0.02, z, y: socket + len - 0.15, paint: wick() },
    ];
  }

  ART["piece-tall-vase"] = product(() => [{ shape: SHAPES.tallVase(), x: 0, rot: -0.4, paint: GLAZE.chalk(51) }], { size: 52, elev: 0.16, top: 0.72 });
  ART["piece-moon-jar"] = product(() => [{ shape: SHAPES.moonJar(), x: 0, rot: 0.3, paint: GLAZE.warmWhite(41, { seam: 16.6 }) }], { size: 56, elev: 0.1, top: 0.72 });
  ART["piece-bud-vases"] = product(
    () => [
      { shape: SHAPES.budTall(), x: -6.2, z: 7, rot: 0.2, paint: GLAZE.sage(61, { line: 0.7, drips: 1 }) },
      { shape: SHAPES.budRound(), x: 1.6, z: 11.5, rot: 1.1, paint: GLAZE.ochre(62, { line: 0.7, drips: 1 }) },
      { shape: SHAPES.budBottle(), x: 7.6, z: 6.5, rot: 2.3, paint: GLAZE.chalk(63, { line: 0.7, drips: 1 }) },
    ],
    { size: 30, elev: 0.13, top: 0.72 },
  );
  ART["piece-ridge-bowl"] = product(
    () => [{ shape: SHAPES.ridgeBowl(), x: 0, rot: 0.2, paint: split(rawClay({ seed: 71 }), GLAZE.cream(72, { line: -1 }), { over: 0.7, seed: 73 }) }],
    { size: 40, elev: 0.3, top: 0.72 },
  );
  ART["piece-serving-dish"] = product(
    () => [{ shape: SHAPES.dish(), x: 0, rot: 0.5, paint: GLAZE.charcoal(81, { thin: "#d8cbb6", lipBand: 0.42, line: 0.5, drips: 0 }) }],
    { size: 58, elev: 0.4, top: 0.68 },
  );
  ART["piece-cups"] = product(
    () => [
      { shape: SHAPES.cupTall(), x: -4.6, z: 6.5, rot: 0.4, paint: GLAZE.sage(91, { line: 1.3, drips: 1 }) },
      { shape: SHAPES.cupWide(), x: 4.4, z: 11.5, rot: 2.1, paint: GLAZE.chalk(92, { line: 1.2, drips: 1 }) },
    ],
    { size: 27, elev: 0.22, top: 0.72 },
  );
  ART["piece-pitcher"] = product(() => [{ shape: SHAPES.pitcher(), x: 0, rot: 0, paint: GLAZE.ochre(101, { line: 1.2 }) }], { size: 40, elev: 0.14, top: 0.72 });
  ART["piece-candle-holders"] = product(
    () => [...candleSet(SHAPES.holderLow(), 2.7, 21, -5.2, 7.5, 111), ...candleSet(SHAPES.holderRound(), 3.2, 16, 6.0, 11.5, 112)],
    { size: 36, elev: 0.14, top: 0.72 },
  );

  /**
   * The window's frame on the wall: a lattice of panes (corner `o`, one pane along the transoms `a` and down the mullions `b`, cm) above a
   * single tall pane, so its bars fall on the wall above the pieces and nothing crosses the pieces themselves.
   */
  const lattice = (o, a, b, { ni = 9, nj = 2, open = 5, bar = 1.3, frame = 1.8, soft = 4, sharpen = 0.02 } = {}) => ({ o, a, b, ni, nj, open, bar, frame, soft, sharpen });

  /** The collections' tiles (4:5): a grouping on a plinth, the window's frame on the wall above. */
  function tile(build) {
    return { w: 1200, h: 1500, quality: 84, draw: (ctx, w, h) => render(ctx, w, h, build(w, h)) };
  }

  ART["tile-vases"] = tile((w, h) =>
    studio(w, h, {
      size: 84,
      top: 0.66,
      elev: 0.12,
      seed: 7,
      items: [
        { shape: SHAPES.tallVase(), x: -13, z: 12.5, rot: -0.4, paint: GLAZE.chalk(201) },
        { shape: SHAPES.moonJar(), x: 13, z: 22, rot: 0.6, paint: GLAZE.warmWhite(202, { seam: 16.6 }) },
        { shape: SHAPES.budTall(), x: -25, z: 26, rot: 0.2, paint: GLAZE.sage(203, { line: 0.7, drips: 1 }) },
        { shape: SHAPES.budRound(), x: -16.5, z: 33, rot: 1.1, paint: GLAZE.ochre(204, { line: 0.7, drips: 1 }) },
        { shape: SHAPES.budBottle(), x: -6.5, z: 36, rot: 2.3, paint: GLAZE.chalk(205, { line: 0.7, drips: 1 }) },
      ],
      plinths: [{ min: [-34, -200, -2], max: [36, 0, 44] }],
      window: lattice([-62, 108], [26, -9], [4, -27]),
    }),
  );

  ART["tile-tableware"] = tile((w, h) =>
    studio(w, h, {
      size: 64,
      top: 0.6,
      elev: 0.28,
      seed: 8,
      items: [
        { shape: SHAPES.dish(), x: -8, z: 19.5, rot: 0.5, paint: GLAZE.charcoal(211, { thin: "#d8cbb6", lipBand: 0.42, line: 0.5, drips: 0 }) },
        { shape: SHAPES.cupWide(), x: -10, z: 16, y: 0.86, rot: 2.1, paint: GLAZE.chalk(212, { line: 1.2, drips: 1 }) },
        { shape: SHAPES.ridgeBowl(), x: 14, z: 31, rot: 0.2, paint: split(rawClay({ seed: 213 }), GLAZE.cream(214, { line: -1 }), { over: 0.7, seed: 215 }) },
        { shape: SHAPES.cupTall(), x: -15, z: 41, rot: 0.4, paint: GLAZE.sage(216, { line: 1.3, drips: 1 }) },
      ],
      plinths: [{ min: [-30, -200, -2], max: [30, 0, 50] }],
      window: lattice([-56, 100], [22, -8], [3.5, -23], { bar: 1.1, soft: 3.4 }),
    }),
  );

  ART["tile-objects"] = tile((w, h) =>
    studio(w, h, {
      size: 64,
      top: 0.66,
      elev: 0.12,
      seed: 9,
      items: [
        { shape: SHAPES.pitcher(), x: -9, z: 14, rot: 0.25, paint: GLAZE.ochre(221, { line: 1.2 }) },
        ...candleSet(SHAPES.holderLow(), 2.7, 21, 11, 10, 222),
        ...candleSet(SHAPES.holderRound(), 3.2, 16, 18.5, 22, 223),
      ],
      plinths: [{ min: [-25, -200, -2], max: [27, 0, 34] }],
      window: lattice([-50, 90], [20, -7], [3.2, -21], { bar: 1.0, soft: 3.2 }),
    }),
  );

  /**
   * The home page's hero: a tall chalk vase, a moon jar and a low charcoal bowl on a long low travertine plinth in the right half; the
   * window's frame across the plaster above them; the left side plain for words.
   */
  ART.hero = {
    w: 2560,
    h: 1440,
    quality: 82,
    draw(ctx, w, h) {
      const S = studio(w, h, {
        size: 230,
        top: 0.66,
        elev: 0.05,
        cx: -50.6,
        seed: 3,
        ao: 7,
        ambient: 0.6,
        // Nearer the window (to the left) the wall has more of the sky's diffuse light.
        ambientField: (x, y) => 1 + 0.32 * smooth(-40, -170, x) * (0.75 + 0.25 * smooth(-30, 120, y)),
        items: [
          { shape: SHAPES.tallVase(), x: -29, z: 13, rot: -0.4, paint: GLAZE.chalk(301) },
          { shape: SHAPES.moonJar(), x: -1.5, z: 19.5, s: 0.92, rot: 0.6, paint: GLAZE.warmWhite(302, { seam: 16.6 }) },
          { shape: SHAPES.lowBowl(), x: 29.5, z: 29, s: 1.12, rot: 0.9, paint: GLAZE.charcoal(303, { line: 0.9, drips: 1 }) },
        ],
        plinths: [{ min: [-46, -30, -1], max: [46, 0, 46] }],
        floor: { y: -30, paint: microcement(305) },
        window: lattice([-56, 114], [30, -11], [5, -30], { ni: 8, nj: 2, open: 3.4, bar: 1.6, frame: 2.4, soft: 6.5 }),
      });
      render(ctx, w, h, S);
    },
  };

  /**
   * The story's picture: the studio's shelves, oak planks on the plaster, rows of pots drying (raw terracotta, pale bisque, grey
   * leather-hard stoneware) with a few glazed ones among them, bowls upside down so their rims dry evenly, the window's light across.
   */
  ART.story = {
    w: 1600,
    h: 1200,
    quality: 82,
    draw(ctx, w, h) {
      const RAW = {
        wet: (seed) => rawClay({ color: "#a9654a", dry: "#b8785a", dryAmt: 0.5, seed }),
        dry: (seed) => rawClay({ color: "#c08465", dry: "#cf9f83", dryAmt: 0.7, seed }),
        bisque: (seed) => rawClay({ color: "#d9bea6", dry: "#e0cab5", dryAmt: 0.45, rings: 0.035, seed }),
        grey: (seed) => rawClay({ color: "#aa9c8c", dry: "#c2b6a7", dryAmt: 0.6, seed }),
      };
      const S = SHAPES;
      let seed = 400;
      const put = (shape, x, z, y, paint, extra = {}) => ({ shape, x, z, y, rot: (seed++ * 1.7) % TAU, paint, ...extra });
      const shelves = [0, 40, 80];
      const [b0, b1, b2] = shelves;
      const items = [
        // The bottom shelf: larger jars, a bowl drying upside down.
        put(S.jar(), -60, 8.5, b0, RAW.wet(1)),
        put(S.cylinder(), -45.5, 7, b0, RAW.grey(2)),
        put(S.lowBowl(), -28, 11.5, b0, RAW.bisque(3), { s: 0.7, flip: true }),
        put(S.moonJar(), -8, 11, b0, GLAZE.chalk(5), { s: 0.52 }),
        put(S.cupTall(), 6, 16, b0, RAW.dry(6)),
        put(S.cupWide(), 15.5, 16.5, b0, GLAZE.sage(7, { line: 1.2, drips: 1 })),
        put(S.bottle(), 27, 7.5, b0, RAW.wet(8)),
        put(S.vaseNarrow(), 41, 7.5, b0, RAW.grey(9)),
        put(S.jar(), 57, 10.5, b0, RAW.bisque(10), { s: 1.1 }),
        // The middle shelf: bottles and vases, a pitcher, nested bowls.
        put(S.bottle(), -62, 7, b1, RAW.dry(11), { s: 0.9 }),
        put(S.vaseNarrow(), -50, 7.5, b1, GLAZE.charcoal(12, { line: 0.8, drips: 1 })),
        put(S.budBottle(), -41, 16, b1, RAW.grey(13)),
        put(S.cylinder(), -30, 7.5, b1, RAW.wet(14), { s: 0.95 }),
        put(S.lowBowl(), -14, 11, b1, RAW.dry(15), { s: 0.6 }),
        put(S.lowBowl(), -14, 11, b1 + 1.5, RAW.dry(16), { s: 0.56 }),
        put(S.lowBowl(), -14, 11, b1 + 3.0, RAW.dry(17), { s: 0.52 }),
        put(S.pitcher(), 4, 11, b1, RAW.bisque(18), { s: 0.68 }),
        put(S.tallVase(), 22, 8, b1, GLAZE.chalk(19), { s: 0.62 }),
        put(S.budRound(), 31.5, 16.5, b1, GLAZE.ochre(20, { line: 0.7, drips: 1 })),
        put(S.bottle(), 42, 7, b1, RAW.grey(21), { s: 0.82 }),
        put(S.jar(), 57, 8.5, b1, RAW.wet(22), { s: 0.85 }),
        // The top shelf: cups drying upside down in a row.
        ...[-60, -50, -40, -30, -20, -10].map((x, i) => put(i % 2 ? S.cupTall() : S.cupWide(), x, 9 + (i % 3) * 3.5, b2, i === 3 ? GLAZE.sage(30 + i, { line: 1.2 }) : RAW.bisque(30 + i), { flip: true })),
        put(S.cylinder(), 4, 8, b2, RAW.dry(40), { s: 0.8 }),
        put(S.jar(), 18, 9, b2, RAW.grey(41), { s: 0.8 }),
        put(S.budTall(), 30, 7, b2, GLAZE.sage(42, { line: 0.6 })),
        put(S.bottle(), 42, 7, b2, RAW.wet(43), { s: 0.75 }),
        put(S.cupWide(), 54, 14, b2, RAW.dry(44)),
      ];
      const plank = (y) => ({ min: [-140, y - 3.6, -1], max: [140, y, 22], r: 0.3, paint: oak(500 + y) });
      const scene = studio(w, h, {
        size: 150,
        top: 0.89,
        elev: 0,
        seed: 11,
        dist: 380,
        look: 45,
        ambient: 0.6,
        ao: 6,
        items,
        plinths: shelves.map(plank),
        window: lattice([-110, 150], [34, -13], [6, -36], { ni: 9, nj: 3, open: 2, bar: 1.8, frame: 2.6, soft: 6, sharpen: 0.01 }),
      });
      scene.soft = 4.5;
      render(ctx, w, h, scene);
    },
  };

  // -------------------------------------------------------------------------------------------------------------------------------
  // Flat pictures: the glaze up close, and the page's paper
  // -------------------------------------------------------------------------------------------------------------------------------

  /**
   * A macro of a large pot's side: a speckled cream glaze that ran down and pooled toward its edge, turning honey and amber where it is
   * thick, with two runs ending in glassy beads over the toasted clay below. The glaze stands on the pot in relief (a thickness field in
   * mm), drawn by the same renderer and window light as the rest; the upper part falls softly out of focus, calm enough to carry words.
   */
  ART.detail = {
    w: 2400,
    h: 1200,
    quality: 80,
    draw(ctx, w, h) {
      const nA = L.simplex(601);
      const nB = L.simplex(602);
      const nC = L.simplex(603);
      const random = L.rng(605);
      const W = 120;
      const H = 60;
      const sunion = (a, b, k) => {
        const hh = Math.max(k - Math.abs(a - b), 0) / k;
        return Math.max(a, b) + hh * hh * k * 0.25;
      };
      // The edge (mm, y downward): a gently falling line with broad soft sags, and two runs that got away.
      const lobes = [];
      for (let x = -4; x < W + 4; x += random.range(10, 22)) lobes.push({ x, depth: Math.pow(random(), 1.4) * 2.2 + 0.3, wid: random.range(4.5, 9) });
      const edgeAt = (x) => {
        let e = H * 0.6 + (x - W / 2) * 0.05 + 1.2 * L.fbm(nA, x * 0.02, 1.7, 3) + 0.2 * nA(x * 0.12, 5.1);
        for (const l of lobes) {
          const u = (x - l.x) / l.wid;
          if (Math.abs(u) < 3.5) e += l.depth * Math.exp(-u * u);
        }
        return e;
      };
      const drips = [
        { x: W * 0.33, len: 7.5, bulb: 2.5 },
        { x: W * 0.71, len: 3.8, bulb: 2.1 },
      ].map((d) => ({ ...d, neck: d.bulb * 0.72 }));
      const inDrip = (d, x, y) => {
        const top = edgeAt(d.x) + 1.2;
        const foot = edgeAt(d.x) + d.len;
        const ty = clamp(y, top, foot);
        const f = (ty - top) / (foot - top);
        const rad = mix(d.neck * 1.25, d.neck, smooth(0, 0.45, f));
        const tongue = rad - Math.hypot(x - d.x, y - ty);
        const bead = d.bulb - Math.hypot((x - d.x) * 0.97, (y - foot) * 1.05);
        return sunion(tongue, bead, d.bulb * 0.9);
      };
      // Thickness (mm) and how pooled the glaze is.
      const field = { h: 0, pool: 0 };
      const sample = (x, y) => {
        const a = edgeAt(x) - y;
        const flow = 0.3 * (1 + 0.14 * L.fbm(nB, x * 0.06, y * 0.012, 3));
        const roll = a > 0 ? 1 - Math.pow(1 - Math.min(a, 3) / 3, 2.2) : 0;
        const amount = clamp(0.95 + 0.6 * L.fbm(nB, x * 0.03 + 3, 0.5, 3), 0.5, 1.5);
        const reach = 3.4 + 2.2 * (0.5 + 0.5 * nC(x * 0.05, 2.2));
        const poolH = amount * 1.35 * Math.exp(-Math.max(0, a - 1.4) / reach);
        let hh = a > 0 ? (flow + poolH) * roll : 0;
        let pool = a > 0 ? smooth(0.25, 1.1, poolH + 0.12 * L.fbm(nC, x * 0.1, y * 0.1, 3)) : 1;
        for (const d of drips) {
          if (Math.abs(x - d.x) > d.bulb + 2.5) continue;
          const c = inDrip(d, x, y);
          if (c <= -0.4) continue;
          const q = clamp(c / d.bulb);
          const tip = smooth(-d.len, d.bulb * 0.5, y - edgeAt(d.x) - d.len * 0.6);
          const dome = c > 0 ? (0.6 + 0.75 * tip) * (1 - Math.pow(1 - q, 2.2)) : 0;
          hh = sunion(hh, dome, 0.35);
          pool = Math.max(pool, smooth(-0.2, 0.3, c));
        }
        field.h = Math.max(0, hh);
        field.pool = pool;
      };
      // The fields on a fine grid, read back smoothly.
      const cell = 0.05;
      const gx0 = -6;
      const gy0 = -6;
      const gnx = Math.ceil((W + 12) / cell);
      const gny = Math.ceil((H + 12) / cell);
      const TH = new Float32Array(gnx * gny);
      const PO = new Float32Array(gnx * gny);
      for (let j = 0; j < gny; j++) {
        for (let i = 0; i < gnx; i++) {
          sample(gx0 + i * cell, gy0 + j * cell);
          TH[j * gnx + i] = field.h;
          PO[j * gnx + i] = field.pool;
        }
      }
      const read = (arr, x, y) => {
        const fx = clamp((x - gx0) / cell, 0, gnx - 1.001);
        const fy = clamp((y - gy0) / cell, 0, gny - 1.001);
        const i = Math.floor(fx);
        const j = Math.floor(fy);
        const tx = fx - i;
        const ty = fy - j;
        const k = j * gnx + i;
        return (arr[k] * (1 - tx) + arr[k + 1] * tx) * (1 - ty) + (arr[k + gnx] * (1 - tx) + arr[k + gnx + 1] * tx) * ty;
      };
      // The pot: a big thrown cylinder, its side filling the frame; the glaze stands on it.
      const R = 10;
      const yTop = 15;
      const mmAt = (th, y) => [th * R * 10 + W / 2, (yTop - y) * 10];
      const pot = {
        H: 30,
        rBound: R + 0.6,
        rMax: R,
        thickness: 0.02,
        step: 0.75,
        built: true,
        build() {},
        sdf(px, py, pz) {
          const rho = Math.hypot(px, pz);
          const [xm, ym] = mmAt(Math.atan2(px, pz), py);
          return rho - R - read(TH, xm, ym) * 0.1;
        },
        parts(px, py, pz, out) {
          out.inner = 0;
          out.handle = 0;
          out.lipY = 1e9;
        },
      };
      const cream = lin("#ece6d8");
      const creamWarm = lin("#e5d8c0");
      const caramel = lin("#cba468");
      const amber = lin("#a26c2f");
      const deep = lin("#6a4019");
      const clay = lin("#774636");
      const clayLight = lin("#8d5a45");
      const flash = lin("#ad6a3e");
      const spot = lin("#3e271b");
      const paint = (q, out) => {
        const [x, y] = mmAt(q.theta, q.y);
        const t = read(TH, x, y);
        const P = read(PO, x, y);
        const glazed = smooth(0, 0.025, t);
        const cv = 0.5 + 0.5 * L.fbm(nB, x * 0.06, y * 0.06, 3);
        let r = mix(clay[0], clayLight[0], cv);
        let g = mix(clay[1], clayLight[1], cv);
        let b = mix(clay[2], clayLight[2], cv);
        const below = y - edgeAt(x);
        const fl = below > 0 ? Math.exp(-below / 4) * (0.55 + 0.45 * L.fbm(nB, x * 0.08, y * 0.1, 2)) : 0;
        r = mix(r, flash[0], fl * 0.5);
        g = mix(g, flash[1], fl * 0.5);
        b = mix(b, flash[2], fl * 0.5);
        const grog = speckle(x + 50, y, 0.9, 0.2 * (1 - glazed), 0.03, 0.08, 641, q.aa * 10);
        r = mix(r, r * 1.6, grog * 0.5);
        g = mix(g, g * 1.6, grog * 0.5);
        b = mix(b, b * 1.6, grog * 0.5);
        const cloud = 0.5 + 0.5 * L.fbm(nA, x * 0.03 + 9, y * 0.045, 4);
        let cr = mix(cream[0], creamWarm[0], cloud * 0.6);
        let cg = mix(cream[1], creamWarm[1], cloud * 0.6);
        let cb = mix(cream[2], creamWarm[2], cloud * 0.6);
        const p1 = smooth(0, 0.6, P);
        const p2 = smooth(0.5, 1, P);
        cr = mix(mix(cr, caramel[0], p1), amber[0], p2);
        cg = mix(mix(cg, caramel[1], p1), amber[1], p2);
        cb = mix(mix(cb, caramel[2], p1), amber[2], p2);
        const dk = smooth(1.0, 1.7, t) * P;
        cr = mix(cr, deep[0], dk);
        cg = mix(cg, deep[1], dk);
        cb = mix(cb, deep[2], dk);
        const thin = 1 - smooth(0, 0.12, t);
        cr = mix(cr, r * 0.85, thin);
        cg = mix(cg, g * 0.8, thin);
        cb = mix(cb, b * 0.75, thin);
        r = mix(r, cr, glazed);
        g = mix(g, cg, glazed);
        b = mix(b, cb, glazed);
        speckle(x, y / (1 + P * 3), 1.0, 0.24, 0.03, 0.15, 611, q.aa * 10);
        const core = SPECK.core * (1 - P * 0.75);
        const halo = SPECK.halo * glazed * (1 - P);
        r = mix(mix(r, r * 0.84, halo * 0.5), spot[0], core * 0.8);
        g = mix(mix(g, g * 0.8, halo * 0.5), spot[1], core * 0.8);
        b = mix(mix(b, b * 0.74, halo * 0.5), spot[2], core * 0.8);
        const pin = speckle(x + 31.7, y + 7.3, 2.4, 0.12 * (1 - P) * glazed, 0.05, 0.1, 621, q.aa * 10);
        out.r = r * (1 - pin * 0.3);
        out.g = g * (1 - pin * 0.3);
        out.b = b * (1 - pin * 0.3);
        out.rough = mix(0.88, mix(0.32, 0.1, P), glazed);
        out.spec = mix(0.03, 0.7, glazed);
        out.wrap = 0.1;
        // A faint orange peel on the cream, the clay's grain (cm slopes along and around the pot).
        const e = 0.05;
        // Throwing rings under it all, then a faint orange peel on the cream or the clay's grain.
        const ring = (v) => Math.sin((v / 8.5) * TAU + 1.3 * nB(v * 0.02, 4.4)) * 0.02 * (1 - P * 0.7);
        const relief = glazed > 0.5 ? (u, v) => nC(u * 1.2, v * 1.2) * 0.006 * (1 - P) + ring(v) : (u, v) => nA(u * 3.5 + 40, v * 3.5) * 0.02 + ring(v) * 1.5;
        out.bu = ((relief(x + e, y) - relief(x - e, y)) / (2 * e)) * 1;
        out.bv = -((relief(x, y + e) - relief(x, y - e)) / (2 * e)) * 1;
      };
      const S = {
        cam: { pos: [0, 12.2, R + 55], frame: [-6, 9, 6, 15, R] },
        light: LIGHT,
        fill: { dir: [0.55, 0.15, 0.82], power: 0.13 },
        ambient: 0.5,
        ground: "#d2c3ae",
        exposure: 1.05,
        vignette: 0.12,
        grain: 0.006,
        saturation: 0.9,
        soft: 6,
        ao: 0.4,
        wall: { z: -60, paint: plaster(9) },
        boxes: [],
        objects: [{ shape: pot, x: 0, y: 0, z: 0, paint }],
        reflection: { w: 0.42, h: 0.62, bars: 0.03 },
      };
      render(ctx, w, h, S);
      // A macro lens: sharp along the edge, softening above it and a little below.
      const sharp = L.canvas(w, h);
      sharp.getContext("2d").drawImage(ctx.canvas, 0, 0);
      const soft = L.canvas(w, h);
      const sctx = soft.getContext("2d");
      sctx.filter = `blur(${Math.round(w / 300)}px)`;
      sctx.drawImage(sharp, -10, -10, w + 20, h + 20);
      sctx.filter = "none";
      sctx.globalCompositeOperation = "destination-in";
      const fade = sctx.createLinearGradient(0, 0, 0, h);
      fade.addColorStop(0, "rgba(0,0,0,1)");
      fade.addColorStop(0.28, "rgba(0,0,0,0.6)");
      fade.addColorStop(0.48, "rgba(0,0,0,0)");
      fade.addColorStop(0.8, "rgba(0,0,0,0)");
      fade.addColorStop(1, "rgba(0,0,0,0.55)");
      sctx.fillStyle = fade;
      sctx.fillRect(0, 0, w, h);
      ctx.drawImage(soft, 0, 0);
    },
  };

  /** Gradient noise that repeats every `period` units, for a tile without a seam. */
  function periodicNoise(seed, period) {
    const grads = [];
    const random = L.rng(seed);
    for (let i = 0; i < period * period; i++) {
      const a = random() * TAU;
      grads.push([Math.cos(a), Math.sin(a)]);
    }
    const g = (i, j) => grads[(((j % period) + period) % period) * period + (((i % period) + period) % period)];
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    return (x, y) => {
      const i = Math.floor(x);
      const j = Math.floor(y);
      const fx = x - i;
      const fy = y - j;
      const dot = (gi, gj, dx, dy) => {
        const v = g(gi, gj);
        return v[0] * dx + v[1] * dy;
      };
      const u = fade(fx);
      const v = fade(fy);
      const a = mix(dot(i, j, fx, fy), dot(i + 1, j, fx - 1, fy), u);
      const b = mix(dot(i, j + 1, fx, fy - 1), dot(i + 1, j + 1, fx - 1, fy - 1), u);
      return mix(a, b, v) * 1.4;
    };
  }

  /** The page's paper: plaster dust and paper fibre, dark and faint on nothing, repeating without a seam. */
  ART.paper = {
    w: 512,
    h: 512,
    alpha: true,
    quality: 82,
    draw(ctx, w, h) {
      // A soft mottle: periodic noise at three scales, as faint alpha.
      const octaves = [
        [periodicNoise(701, 4), 4, 0.6],
        [periodicNoise(702, 12), 12, 0.3],
        [periodicNoise(703, 48), 48, 0.18],
      ];
      const img = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let n = 0;
          for (const [f, p, a] of octaves) n += f((x / w) * p, (y / h) * p) * a;
          const k = (y * w + x) * 4;
          img.data[k] = 74;
          img.data[k + 1] = 60;
          img.data[k + 2] = 48;
          img.data[k + 3] = clamp(0.035 + n * 0.05, 0, 0.1) * 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      const random = L.rng(704);
      const wrapped = (drawAt) => {
        for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) drawAt(dx, dy);
      };
      // Fibres: short, thin, gently curved.
      ctx.lineCap = "round";
      for (let i = 0; i < 110; i++) {
        const x = random() * w;
        const y = random() * h;
        const len = 6 + Math.pow(random(), 2) * 34;
        const a = random() * TAU;
        const bend = random.gauss() * 0.5;
        const alpha = 0.05 + random() * 0.09;
        const width = 0.35 + random() * 0.55;
        const ex = x + Math.cos(a) * len;
        const ey = y + Math.sin(a) * len;
        const cx = (x + ex) / 2 + Math.cos(a + Math.PI / 2) * len * bend * 0.3;
        const cy = (y + ey) / 2 + Math.sin(a + Math.PI / 2) * len * bend * 0.3;
        wrapped((dx, dy) => {
          ctx.strokeStyle = `rgba(70,56,44,${alpha})`;
          ctx.lineWidth = width;
          ctx.beginPath();
          ctx.moveTo(x + dx, y + dy);
          ctx.quadraticCurveTo(cx + dx, cy + dy, ex + dx, ey + dy);
          ctx.stroke();
        });
      }
      // Specks: many tiny, a few larger and softer.
      for (let i = 0; i < 900; i++) {
        const x = random() * w;
        const y = random() * h;
        const big = Math.pow(random(), 9);
        const r = 0.35 + random() * 0.5 + big * 2.2;
        const alpha = (0.1 + random() * 0.3) * (1 - big * 0.6);
        wrapped((dx, dy) => {
          const px = x + dx;
          const py = y + dy;
          if (px < -6 || py < -6 || px > w + 6 || py > h + 6) return;
          const g = ctx.createRadialGradient(px, py, 0, px, py, r);
          g.addColorStop(0, `rgba(62,48,38,${alpha})`);
          g.addColorStop(1, "rgba(62,48,38,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(px, py, r, 0, TAU);
          ctx.fill();
        });
      }
    },
  };
})();
