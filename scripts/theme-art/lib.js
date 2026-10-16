/* global window */
/**
 * The drawing helpers every theme's art shares (`scripts/theme-art.mjs`), run inside Chromium's page: a seeded random source, simplex noise
 * and fractal noise, stars, nebulae, spheres and the framed print a product picture shows. Nothing here reads the clock or the network, so a
 * seed always draws the same picture.
 */
(() => {
  /** A seeded random source (mulberry32): numbers in [0, 1). */
  function rng(seed) {
    let a = seed >>> 0;
    const next = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.range = (lo, hi) => lo + next() * (hi - lo);
    next.pick = (list) => list[Math.floor(next() * list.length)];
    /** Roughly normal, mean 0 and spread 1. */
    next.gauss = () => {
      let u = 0;
      let v = 0;
      while (u === 0) u = next();
      while (v === 0) v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    return next;
  }

  /** 2D simplex noise from a seed: values about in [-1, 1]. */
  function simplex(seed) {
    const random = rng(seed);
    const perm = new Uint8Array(512);
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
    const grad = [
      [1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1],
    ];
    const F2 = 0.5 * (Math.sqrt(3) - 1);
    const G2 = (3 - Math.sqrt(3)) / 6;
    return (xin, yin) => {
      const s = (xin + yin) * F2;
      const i = Math.floor(xin + s);
      const j = Math.floor(yin + s);
      const t = (i + j) * G2;
      const x0 = xin - (i - t);
      const y0 = yin - (j - t);
      const i1 = x0 > y0 ? 1 : 0;
      const j1 = x0 > y0 ? 0 : 1;
      const x1 = x0 - i1 + G2;
      const y1 = y0 - j1 + G2;
      const x2 = x0 - 1 + 2 * G2;
      const y2 = y0 - 1 + 2 * G2;
      const ii = i & 255;
      const jj = j & 255;
      const corner = (x, y, g) => {
        let tt = 0.5 - x * x - y * y;
        if (tt < 0) return 0;
        tt *= tt;
        const gr = grad[g % 8];
        return tt * tt * (gr[0] * x + gr[1] * y);
      };
      const n0 = corner(x0, y0, perm[ii + perm[jj]]);
      const n1 = corner(x1, y1, perm[ii + i1 + perm[jj + j1]]);
      const n2 = corner(x2, y2, perm[ii + 1 + perm[jj + 1]]);
      return 70 * (n0 + n1 + n2);
    };
  }

  /** Fractal noise: octaves of `noise`, in about [-1, 1]. */
  function fbm(noise, x, y, octaves = 5, lacunarity = 2, gain = 0.5) {
    let sum = 0;
    let amp = 0.5;
    let freq = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
  const smooth = (e0, e1, x) => {
    const t = clamp((x - e0) / (e1 - e0));
    return t * t * (3 - 2 * t);
  };
  const mix = (a, b, t) => a + (b - a) * t;
  const hexRgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  const rgba = (hex, alpha) => {
    const [r, g, b] = hexRgb(hex);
    return `rgba(${r},${g},${b},${alpha})`;
  };

  function canvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }

  /** A vertical gradient across the whole picture. */
  function sky(ctx, w, h, stops) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    stops.forEach(([at, color]) => g.addColorStop(at, color));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  const STAR_TINTS = ["#ffffff", "#ffffff", "#ffffff", "#dfe7ff", "#cfdcff", "#fff4dc", "#ffe2bd", "#ffd0b0"];

  /**
   * Stars: many faint ones and a few bright, their brightness a power law, tinted as stars are; the brightest with a soft glow and, with
   * `spikes`, a telescope's four rays. `wrap` repeats a star over the edges, so the picture tiles without a seam. `where(x, y)` thins them.
   */
  function stars(ctx, w, h, random, { count, max = 2.2, spikes = 0, wrap = false, where = null, alpha = 1 } = {}) {
    const drawOne = (x, y, r, tint, a) => {
      if (r > 1.1) {
        const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 5);
        glow.addColorStop(0, rgba(tint, 0.55 * a));
        glow.addColorStop(1, rgba(tint, 0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, r * 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = rgba(tint, a);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    };
    const placed = [];
    for (let i = 0; i < count; i++) {
      const x = random() * w;
      const y = random() * h;
      if (where && random() > where(x, y)) continue;
      const k = Math.pow(random(), 7);
      const r = 0.35 + k * max;
      const a = alpha * clamp(0.25 + Math.pow(random(), 2) * 0.6 + k);
      const tint = random.pick(STAR_TINTS);
      placed.push([x, y, r, tint, a]);
      drawOne(x, y, r, tint, a);
      if (wrap) {
        for (const [dx, dy] of [[w, 0], [-w, 0], [0, h], [0, -h]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx > -12 && nx < w + 12 && ny > -12 && ny < h + 12) drawOne(nx, ny, r, tint, a);
        }
      }
    }
    if (spikes > 0) {
      const bright = placed.sort((a, b) => b[2] - a[2]).slice(0, spikes);
      for (const [x, y, r, tint] of bright) spike(ctx, x, y, r * 16, tint);
    }
    return placed;
  }

  /** A bright star's four rays and halo. */
  function spike(ctx, x, y, length, tint) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const halo = ctx.createRadialGradient(x, y, 0, x, y, length * 0.5);
    halo.addColorStop(0, rgba(tint, 0.5));
    halo.addColorStop(0.2, rgba(tint, 0.12));
    halo.addColorStop(1, rgba(tint, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, length * 0.5, 0, Math.PI * 2);
    ctx.fill();
    for (const angle of [0, Math.PI / 2]) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle + 0.12);
      const g = ctx.createLinearGradient(-length, 0, length, 0);
      g.addColorStop(0, rgba(tint, 0));
      g.addColorStop(0.5, rgba(tint, 0.7));
      g.addColorStop(1, rgba(tint, 0));
      ctx.fillStyle = g;
      ctx.fillRect(-length, -0.8, length * 2, 1.6);
      ctx.restore();
    }
    ctx.restore();
  }

  /**
   * A nebula: fractal noise, warped, shaped by `mask(u, v)` (0 to 1 over the picture), coloured between `colors` by a second noise, drawn
   * small and enlarged (clouds are soft) with a blurred copy for its glow, added onto the picture.
   */
  function nebula(ctx, w, h, seed, { colors, mask, scale = 2.2, density = 1, detail = 4, blur = 18, strength = 1 } = {}) {
    const sw = Math.ceil(w / detail);
    const sh = Math.ceil(h / detail);
    const small = canvas(sw, sh);
    const sctx = small.getContext("2d");
    const img = sctx.createImageData(sw, sh);
    const n1 = simplex(seed);
    const n2 = simplex(seed + 101);
    const n3 = simplex(seed + 202);
    const rgb = colors.map(hexRgb);
    const aspect = w / h;
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const u = x / sw;
        const v = y / sh;
        const px = u * scale * aspect;
        const py = v * scale;
        const wx = fbm(n2, px + 3.1, py + 1.7, 4) * 0.9;
        const wy = fbm(n2, px - 2.3, py + 5.2, 4) * 0.9;
        const n = fbm(n1, px + wx, py + wy, 6);
        const m = mask ? mask(u, v) : 1;
        const d = smooth(-0.05, 0.75, n) * m * density;
        const c = (fbm(n3, px * 0.7, py * 0.7, 3) + 1) / 2;
        const seg = clamp(c) * (rgb.length - 1);
        const i0 = Math.floor(seg);
        const i1 = Math.min(rgb.length - 1, i0 + 1);
        const f = seg - i0;
        const k = (y * sw + x) * 4;
        img.data[k] = mix(rgb[i0][0], rgb[i1][0], f);
        img.data[k + 1] = mix(rgb[i0][1], rgb[i1][1], f);
        img.data[k + 2] = mix(rgb[i0][2], rgb[i1][2], f);
        img.data[k + 3] = clamp(d) * 255;
      }
    }
    sctx.putImageData(img, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.globalAlpha = 0.55 * strength;
    ctx.filter = `blur(${blur}px)`;
    ctx.drawImage(small, 0, 0, w, h);
    ctx.filter = `blur(${Math.max(1, blur / 6)}px)`;
    ctx.globalAlpha = 0.75 * strength;
    ctx.drawImage(small, 0, 0, w, h);
    ctx.restore();
  }

  /**
   * A sphere lit from `light` (an angle): `paint(ctx, r)` draws its surface centred on 0, 0 (bands, craters), then a terminator's shade and
   * an atmosphere's rim on the lit side.
   */
  function sphere(ctx, cx, cy, r, { light = -Math.PI * 0.75, base = "#7a8aa6", paint = null, atmosphere = null, shade = 0.92, ambient = 0.06 } = {}) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = base;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    if (paint) paint(ctx, r);
    // The night side: a shadow from the side away from the light, soft at the terminator.
    const lx = Math.cos(light);
    const ly = Math.sin(light);
    const g = ctx.createLinearGradient(lx * r, ly * r, -lx * r, -ly * r);
    g.addColorStop(0, `rgba(0,0,0,${ambient})`);
    g.addColorStop(0.45, `rgba(0,0,0,${ambient + 0.1})`);
    g.addColorStop(0.62, `rgba(0,0,0,${shade * 0.85})`);
    g.addColorStop(1, `rgba(0,0,0,${shade})`);
    ctx.fillStyle = g;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    // Limb darkening: the edge a little darker all round.
    const limb = ctx.createRadialGradient(0, 0, r * 0.55, 0, 0, r);
    limb.addColorStop(0, "rgba(0,0,0,0)");
    limb.addColorStop(1, "rgba(0,0,0,0.45)");
    ctx.fillStyle = limb;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();
    if (atmosphere) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.globalCompositeOperation = "lighter";
      const width = r * (atmosphere.width ?? 0.06);
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(0, 0, r + width * 0.2, light - Math.PI * 0.62, light + Math.PI * 0.62);
        ctx.strokeStyle = rgba(atmosphere.color, (atmosphere.strength ?? 0.55) / (i + 1.5));
        ctx.lineWidth = width * (i + 1);
        ctx.filter = `blur(${width * (i + 1) * 0.6}px)`;
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /** Horizontal bands across a sphere (a gas giant): colours in turn, wobbled by noise. */
  function bands(seed, colors, { turbulence = 0.08, count = 14 } = {}) {
    const n = simplex(seed);
    const rgb = colors.map(hexRgb);
    return (ctx, r) => {
      const size = Math.ceil(r * 2);
      const tmp = canvas(size, size);
      const tctx = tmp.getContext("2d");
      const img = tctx.createImageData(size, size);
      for (let y = 0; y < size; y++) {
        const v = y / size;
        for (let x = 0; x < size; x++) {
          const u = x / size;
          const wobble = fbm(n, u * 3, v * 10, 5) * turbulence;
          const t = (v + wobble) * count;
          const seg = ((t % rgb.length) + rgb.length) % rgb.length;
          const i0 = Math.floor(seg);
          const i1 = (i0 + 1) % rgb.length;
          const f = smooth(0.2, 0.8, seg - i0);
          const k = (y * size + x) * 4;
          img.data[k] = mix(rgb[i0][0], rgb[i1][0], f);
          img.data[k + 1] = mix(rgb[i0][1], rgb[i1][1], f);
          img.data[k + 2] = mix(rgb[i0][2], rgb[i1][2], f);
          img.data[k + 3] = 255;
        }
      }
      tctx.putImageData(img, 0, 0);
      ctx.save();
      ctx.filter = `blur(${Math.max(1, r / 300)}px)`;
      ctx.drawImage(tmp, -r, -r);
      ctx.restore();
    };
  }

  /** A grey surface with craters and maria (the Moon). */
  function lunar(seed) {
    const n = simplex(seed);
    const random = rng(seed + 7);
    return (ctx, r) => {
      const size = Math.ceil(r * 2);
      const img = ctx.createImageData(size, size);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const u = x / size;
          const v = y / size;
          const maria = smooth(0.1, 0.5, fbm(n, u * 2.2, v * 2.2, 5));
          const grain = fbm(n, u * 18, v * 18, 3) * 0.08;
          const value = clamp(0.78 - maria * 0.3 + grain) * 255;
          const k = (y * size + x) * 4;
          img.data[k] = value;
          img.data[k + 1] = value * 0.99;
          img.data[k + 2] = value * 0.96;
          img.data[k + 3] = 255;
        }
      }
      const tmp = canvas(size, size);
      tmp.getContext("2d").putImageData(img, 0, 0);
      ctx.drawImage(tmp, -r, -r);
      for (let i = 0; i < 70; i++) {
        const a = random() * Math.PI * 2;
        const d = Math.sqrt(random()) * r * 0.95;
        const cr = Math.pow(random(), 3) * r * 0.14 + r * 0.008;
        const x = Math.cos(a) * d;
        const y = Math.sin(a) * d;
        const g = ctx.createRadialGradient(x - cr * 0.25, y - cr * 0.25, cr * 0.1, x, y, cr);
        g.addColorStop(0, "rgba(40,38,36,0.35)");
        g.addColorStop(0.75, "rgba(60,58,55,0.18)");
        g.addColorStop(0.9, "rgba(255,255,250,0.22)");
        g.addColorStop(1, "rgba(255,255,250,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, cr, 0, Math.PI * 2);
        ctx.fill();
      }
    };
  }

  /**
   * A print as a product picture shows it: the artwork in a thin black frame with an ivory mat, hung on a dark wall under a soft light, with
   * its shadow. `art(ctx, w, h)` draws the artwork into its own canvas of the size given.
   */
  function framedPrint(ctx, w, h, art, { wall = ["#1b1d29", "#0f1019"], artW = 0.62, ratio = 4 / 3, mat = "#f3efe6", frame = "#0b0b0d" } = {}) {
    const g = ctx.createRadialGradient(w / 2, h * 0.32, w * 0.05, w / 2, h * 0.45, w * 0.9);
    g.addColorStop(0, wall[0]);
    g.addColorStop(1, wall[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const aw = Math.round(w * artW);
    const ah = Math.round(aw * ratio);
    const matPad = Math.round(aw * 0.09);
    const framePad = Math.round(aw * 0.022);
    const fw = aw + 2 * (matPad + framePad);
    const fh = ah + 2 * (matPad + framePad);
    const fx = Math.round((w - fw) / 2);
    const fy = Math.round((h - fh) / 2 - h * 0.02);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = w * 0.05;
    ctx.shadowOffsetY = w * 0.025;
    ctx.fillStyle = frame;
    ctx.fillRect(fx, fy, fw, fh);
    ctx.restore();
    ctx.fillStyle = mat;
    ctx.fillRect(fx + framePad, fy + framePad, fw - 2 * framePad, fh - 2 * framePad);
    // The mat's bevel: a fine shade inside its opening.
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(fx + framePad + matPad - 3, fy + framePad + matPad - 3, aw + 6, ah + 6);
    const piece = canvas(aw, ah);
    art(piece.getContext("2d"), aw, ah);
    ctx.drawImage(piece, fx + framePad + matPad, fy + framePad + matPad);
    // Light falling from above across the glass.
    const glass = ctx.createLinearGradient(fx, fy, fx + fw, fy + fh);
    glass.addColorStop(0, "rgba(255,255,255,0.07)");
    glass.addColorStop(0.35, "rgba(255,255,255,0)");
    ctx.fillStyle = glass;
    ctx.fillRect(fx + framePad, fy + framePad, fw - 2 * framePad, fh - 2 * framePad);
  }

  /** Film grain over the picture, so gradients do not band. */
  function grain(ctx, w, h, seed, amount = 10) {
    const random = rng(seed);
    const img = ctx.getImageData(0, 0, w, h);
    for (let k = 0; k < img.data.length; k += 4) {
      const n = (random() - 0.5) * amount;
      img.data[k] = clamp(img.data[k] + n, 0, 255);
      img.data[k + 1] = clamp(img.data[k + 1] + n, 0, 255);
      img.data[k + 2] = clamp(img.data[k + 2] + n, 0, 255);
    }
    ctx.putImageData(img, 0, 0);
  }

  window.ARTLIB = { rng, simplex, fbm, clamp, smooth, mix, hexRgb, rgba, canvas, sky, stars, spike, nebula, sphere, bands, lunar, framedPrint, grain };
  window.ART = window.ART || {};
})();
