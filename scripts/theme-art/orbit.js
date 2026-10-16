/* global window */
/**
 * Orbit's art (`docs/signature-themes.md`): the night sky as a print studio would draw it. Deep blue-black skies, starlight with a little
 * colour, violet and rose nebulae, planets lit from the upper left, and the shop's prints framed on a dark gallery wall. No words, numbers or
 * logos anywhere.
 */
(() => {
  const L = window.ARTLIB;
  const ART = window.ART;
  const TAU = Math.PI * 2;

  const SPACE = [
    [0, "#04050c"],
    [0.55, "#070919"],
    [1, "#0b0d22"],
  ];

  /** A plain night sky behind a print's subject. */
  function nightSky(ctx, w, h, seed, { count = 0.0016, nebulaColors = null, mask = null, strength = 0.7 } = {}) {
    L.sky(ctx, w, h, SPACE);
    if (nebulaColors) L.nebula(ctx, w, h, seed, { colors: nebulaColors, mask, strength, detail: 3, blur: Math.max(6, w / 90) });
    L.stars(ctx, w, h, L.rng(seed + 1), { count: Math.round(w * h * count), max: 1.6 });
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Subjects (each draws into a canvas of any size)
  // ---------------------------------------------------------------------------------------------------------------------------------

  function saturn(ctx, w, h, seed = 11) {
    nightSky(ctx, w, h, seed, { count: 0.0012 });
    const cx = w * 0.5;
    const cy = h * 0.52;
    const r = Math.min(w, h) * 0.2;
    const tilt = -0.38;
    const rings = [
      [1.25, 1.42, "#cdb68a", 0.55],
      [1.45, 1.86, "#e8d7b0", 0.85],
      [1.88, 1.94, "#000000", 0],
      [1.95, 2.25, "#c7ae80", 0.7],
      [2.3, 2.34, "#b39a70", 0.35],
    ];
    const drawRings = (front) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(tilt);
      ctx.beginPath();
      // Only the half in front of the planet, or the half behind it.
      if (front) ctx.rect(-w, 0, w * 2, h);
      else ctx.rect(-w, -h, w * 2, h);
      ctx.clip();
      for (const [a, b, color, alpha] of rings) {
        if (alpha === 0) continue;
        const steps = 18;
        for (let i = 0; i < steps; i++) {
          const k = a + ((b - a) * (i + 0.5)) / steps;
          ctx.beginPath();
          ctx.ellipse(0, 0, r * k, r * k * 0.24, 0, 0, TAU);
          ctx.strokeStyle = L.rgba(color, alpha * (0.55 + 0.45 * Math.sin(i * 1.7 + a * 9) ** 2));
          ctx.lineWidth = (r * (b - a)) / steps + 0.6;
          ctx.stroke();
        }
      }
      ctx.restore();
    };
    drawRings(false);
    L.sphere(ctx, cx, cy, r, {
      light: -Math.PI * 0.8,
      base: "#d8c08e",
      paint: L.bands(seed, ["#e6d2a2", "#d5b983", "#c8a86f", "#ead9b2", "#b99560", "#dcc595"], { turbulence: 0.05, count: 9 }),
      atmosphere: { color: "#ffe9bf", width: 0.03, strength: 0.35 },
      shade: 0.9,
    });
    drawRings(true);
  }

  function jupiter(ctx, w, h, seed = 21) {
    nightSky(ctx, w, h, seed, { count: 0.0012 });
    const cx = w * 0.5;
    const cy = h * 0.5;
    const r = Math.min(w, h) * 0.34;
    L.sphere(ctx, cx, cy, r, {
      light: -Math.PI * 0.78,
      base: "#c9a27a",
      paint: (c, rr) => {
        L.bands(seed, ["#f0dcc0", "#c98e5f", "#e8cfae", "#a8704a", "#f3e4cd", "#b98a63", "#dcbf9d"], { turbulence: 0.11, count: 7 })(c, rr);
        // The great red spot.
        c.save();
        c.translate(rr * 0.28, rr * 0.32);
        c.rotate(-0.05);
        const g = c.createRadialGradient(0, 0, 0, 0, 0, rr * 0.16);
        g.addColorStop(0, "rgba(176,74,46,0.95)");
        g.addColorStop(0.6, "rgba(196,104,66,0.7)");
        g.addColorStop(1, "rgba(220,170,130,0)");
        c.fillStyle = g;
        c.scale(1.6, 1);
        c.beginPath();
        c.arc(0, 0, rr * 0.16, 0, TAU);
        c.fill();
        c.restore();
      },
      atmosphere: { color: "#ffe2c4", width: 0.025, strength: 0.4 },
      shade: 0.93,
    });
    // Four moons in a line.
    const random = L.rng(seed + 5);
    [-1.75, -1.4, 1.45, 1.9].forEach((k, i) => {
      const mr = r * (0.035 + random() * 0.02);
      L.sphere(ctx, cx + r * k, cy + r * k * 0.06 + (i % 2 ? 6 : -4), mr, { light: -Math.PI * 0.8, base: ["#d9cbb0", "#c8b79a", "#9e9384", "#e4d8c4"][i], shade: 0.85 });
    });
  }

  function moonPhases(ctx, w, h, seed = 31) {
    nightSky(ctx, w, h, seed, { count: 0.0008 });
    const cx = w / 2;
    const cy = h / 2;
    const ring = Math.min(w, h) * 0.34;
    const mr = Math.min(w, h) * 0.075;
    // A thin circle the moons sit on.
    ctx.beginPath();
    ctx.arc(cx, cy, ring, 0, TAU);
    ctx.strokeStyle = "rgba(230,214,170,0.22)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    for (let i = 0; i < 8; i++) {
      const p = i / 8;
      const a = -Math.PI / 2 + p * TAU + Math.PI;
      const x = cx + Math.cos(a) * ring;
      const y = cy + Math.sin(a) * ring;
      phase(ctx, x, y, mr, p, seed + i);
    }
    // The full moon, large, at the centre.
    phase(ctx, cx, cy, mr * 2.2, 0.5, seed + 40);
  }

  /** The Moon at phase `p` (0 new, 0.5 full): its surface, then the night side over it. */
  function phase(ctx, x, y, r, p, seed) {
    L.sphere(ctx, x, y, r, { light: 0, base: "#bdb7ad", paint: L.lunar(seed), shade: 0, ambient: 0 });
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.arc(0, 0, r + 0.5, 0, TAU);
    ctx.clip();
    ctx.fillStyle = "rgba(6,7,16,0.94)";
    const k = Math.cos(p * TAU); // 1 new, -1 full
    const waxing = p < 0.5;
    ctx.beginPath();
    // The dark half, then the terminator's ellipse adds to it or takes from it.
    ctx.arc(0, 0, r + 1, Math.PI / 2, (Math.PI * 3) / 2, !waxing);
    ctx.ellipse(0, 0, Math.abs(k) * (r + 1), r + 1, 0, (Math.PI * 3) / 2, Math.PI / 2, k > 0 ? !waxing : waxing);
    ctx.filter = `blur(${Math.max(1, r / 40)}px)`;
    ctx.fill();
    ctx.restore();
    // Earthshine on the dark side, faint.
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.strokeStyle = "rgba(160,170,210,0.12)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function orionNebula(ctx, w, h, seed = 41) {
    L.sky(ctx, w, h, SPACE);
    const mask = (u, v) => {
      const dx = (u - 0.52) * 1.25;
      const dy = v - 0.47;
      return Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) * 1.9);
    };
    L.nebula(ctx, w, h, seed, { colors: ["#1a0f45", "#5b2a9b", "#c23f8c", "#ff8a6e", "#ffd3a1"], mask, scale: 2.6, strength: 1.25, detail: 3, blur: w / 70 });
    L.nebula(ctx, w, h, seed + 9, { colors: ["#0d2a5c", "#2a7fb8", "#7fd6e8"], mask: (u, v) => mask(u, v) * 0.6, scale: 3.4, strength: 0.6, detail: 3, blur: w / 60 });
    L.stars(ctx, w, h, L.rng(seed + 1), { count: Math.round(w * h * 0.0016), max: 1.8, spikes: 5 });
  }

  function andromeda(ctx, w, h, seed = 51) {
    nightSky(ctx, w, h, seed, { count: 0.0014 });
    const random = L.rng(seed);
    const cx = w * 0.5;
    const cy = h * 0.5;
    const size = Math.min(w, h) * 0.42;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.6);
    ctx.scale(1, 0.38);
    ctx.globalCompositeOperation = "lighter";
    // The arms: points along two logarithmic spirals, scattered, bluer outward.
    for (let i = 0; i < 26000; i++) {
      const arm = i % 2;
      const t = Math.pow(random(), 0.7) * 3.6;
      const angle = t * 1.9 + arm * Math.PI + random.gauss() * 0.28;
      const rad = (size * t) / 3.6 + random.gauss() * size * 0.05;
      const x = Math.cos(angle) * rad;
      const y = Math.sin(angle) * rad;
      const out = t / 3.6;
      const color = out < 0.3 ? "#ffe2b0" : out < 0.6 ? "#e8e4ff" : "#a9c4ff";
      ctx.fillStyle = L.rgba(color, 0.11 + random() * 0.12);
      ctx.fillRect(x, y, 1.6, 1.6);
    }
    // The bright core.
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 0.42);
    core.addColorStop(0, "rgba(255,240,210,0.95)");
    core.addColorStop(0.25, "rgba(255,214,160,0.45)");
    core.addColorStop(1, "rgba(255,200,150,0)");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.42, 0, TAU);
    ctx.fill();
    ctx.restore();
    // A soft glow over all of it.
    ctx.save();
    ctx.filter = `blur(${w / 120}px)`;
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.45;
    ctx.drawImage(ctx.canvas, 0, 0);
    ctx.restore();
  }

  function eclipse(ctx, w, h, seed = 61) {
    ctx.fillStyle = "#020208";
    ctx.fillRect(0, 0, w, h);
    const random = L.rng(seed);
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.16;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.translate(cx, cy);
    // The corona: fine streamers, longer toward the equator.
    for (let i = 0; i < 1400; i++) {
      const a = random() * TAU;
      const equator = Math.abs(Math.cos(a));
      const len = r * (0.25 + Math.pow(random(), 2.2) * (0.8 + equator * 1.6));
      const g = ctx.createLinearGradient(Math.cos(a) * r, Math.sin(a) * r, Math.cos(a) * (r + len), Math.sin(a) * (r + len));
      g.addColorStop(0, "rgba(235,240,255,0.16)");
      g.addColorStop(1, "rgba(200,215,255,0)");
      ctx.strokeStyle = g;
      ctx.lineWidth = 0.6 + random() * 1.2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      const bend = random.gauss() * 0.08;
      ctx.quadraticCurveTo(Math.cos(a + bend) * (r + len * 0.5), Math.sin(a + bend) * (r + len * 0.5), Math.cos(a + bend * 2) * (r + len), Math.sin(a + bend * 2) * (r + len));
      ctx.stroke();
    }
    const halo = ctx.createRadialGradient(0, 0, r * 0.95, 0, 0, r * 2.4);
    halo.addColorStop(0, "rgba(240,244,255,0.85)");
    halo.addColorStop(0.08, "rgba(220,230,255,0.4)");
    halo.addColorStop(0.4, "rgba(180,200,255,0.08)");
    halo.addColorStop(1, "rgba(160,180,255,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, r * 2.4, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#010104";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fill();
    // The diamond ring: the last bead of sunlight.
    L.spike(ctx, cx + Math.cos(-0.7) * r, cy + Math.sin(-0.7) * r, r * 0.9, "#ffffff");
    L.stars(ctx, w, h, L.rng(seed + 3), { count: Math.round(w * h * 0.0003), max: 1.2, where: (x, y) => (Math.hypot(x - cx, y - cy) > r * 3 ? 1 : 0) });
  }

  function skyChart(ctx, w, h, seed = 71) {
    ctx.fillStyle = "#0b1230";
    ctx.fillRect(0, 0, w, h);
    const random = L.rng(seed);
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.42;
    const gold = "#d9b46a";
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.clip();
    const inner = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    inner.addColorStop(0, "#132055");
    inner.addColorStop(1, "#0b1436");
    ctx.fillStyle = inner;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = L.rgba(gold, 0.16);
    ctx.lineWidth = 1;
    for (let k = 1; k < 6; k++) {
      ctx.beginPath();
      ctx.arc(cx, cy, (R * k) / 6, 0, TAU);
      ctx.stroke();
    }
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * TAU;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      ctx.stroke();
    }
    // Stars by magnitude; the brightest join into figures.
    const placed = [];
    for (let i = 0; i < 900; i++) {
      const a = random() * TAU;
      const d = Math.sqrt(random()) * R;
      const m = Math.pow(random(), 6);
      placed.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, m });
      ctx.fillStyle = m > 0.25 ? "#fff6df" : L.rgba("#e6ecff", 0.55 + m);
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 0.6 + m * 4.2, 0, TAU);
      ctx.fill();
    }
    const bright = placed.filter((s) => s.m > 0.12);
    ctx.strokeStyle = L.rgba(gold, 0.75);
    ctx.lineWidth = 1.3;
    const used = new Set();
    for (let figure = 0; figure < 9 && bright.length > 0; figure++) {
      let current = bright.find((s) => !used.has(s));
      if (!current) break;
      ctx.beginPath();
      ctx.moveTo(current.x, current.y);
      used.add(current);
      for (let step = 0; step < 4 + Math.floor(random() * 3); step++) {
        const next = bright
          .filter((s) => !used.has(s))
          .map((s) => ({ s, d: Math.hypot(s.x - current.x, s.y - current.y) }))
          .filter((c) => c.d < R * 0.35)
          .sort((a, b) => a.d - b.d)[0];
        if (!next) break;
        ctx.lineTo(next.s.x, next.s.y);
        used.add(next.s);
        current = next.s;
      }
      ctx.stroke();
    }
    ctx.restore();
    // The rim: two rings and ticks.
    ctx.strokeStyle = gold;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.06, 0, TAU);
    ctx.stroke();
    for (let k = 0; k < 360; k += 2) {
      const a = (k / 360) * TAU;
      const long = k % 30 === 0 ? 0.05 : k % 10 === 0 ? 0.03 : 0.015;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      ctx.lineTo(cx + Math.cos(a) * R * (1 + long), cy + Math.sin(a) * R * (1 + long));
      ctx.stroke();
    }
  }

  function paleBlueDot(ctx, w, h, seed = 81) {
    ctx.fillStyle = "#050409";
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const beams = [
      [0.18, "#ffb27a", 0.3],
      [0.42, "#ff7aa8", 0.22],
      [0.63, "#ffd59a", 0.34],
      [0.82, "#8fa7ff", 0.18],
    ];
    for (const [at, color, alpha] of beams) {
      ctx.save();
      ctx.translate(w * at, h * 0.5);
      ctx.rotate(0.32);
      const g = ctx.createLinearGradient(-w * 0.09, 0, w * 0.09, 0);
      g.addColorStop(0, L.rgba(color, 0));
      g.addColorStop(0.5, L.rgba(color, alpha));
      g.addColorStop(1, L.rgba(color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(-w * 0.09, -h, w * 0.18, h * 2);
      ctx.restore();
    }
    ctx.restore();
    L.grain(ctx, w, h, seed, 16);
    // The dot, in the third beam.
    const x = w * 0.66;
    const y = h * 0.6;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 6);
    g.addColorStop(0, "rgba(190,220,255,1)");
    g.addColorStop(1, "rgba(150,190,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, TAU);
    ctx.fill();
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // The pictures
  // ---------------------------------------------------------------------------------------------------------------------------------

  /** The home page's hero: a deep field with violet and rose nebulae, and a planet rising at the lower right; the left kept calm for words. */
  /**
   * A planet seen from its night side with the sun about to rise over its rim: the body dark with faint bands, a thin sunlit crescent along
   * the upper edge, the atmosphere glowing, and the sun's first light where the crescent is brightest.
   */
  function planetRise(ctx, cx, cy, r, { sunAt = -Math.PI * 0.42, crescent = "#cfe9ff", air = "#6fc8ff", body = ["#0b1328", "#0e1932", "#0a1124", "#13203d"] } = {}) {
    L.sphere(ctx, cx, cy, r, { light: sunAt, base: body[0], paint: L.bands(13, body, { turbulence: 0.09, count: 13 }), shade: 0.75, ambient: 0.35 });
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.clip();
    // The sunlit crescent: light falling on the rim, fading inward.
    ctx.globalCompositeOperation = "lighter";
    for (const [width, alpha] of [[0.012, 0.9], [0.04, 0.35], [0.12, 0.12]]) {
      ctx.beginPath();
      ctx.arc(0, 0, r * (1 - width / 2), sunAt - 0.9, sunAt + 0.9);
      ctx.strokeStyle = L.rgba(crescent, alpha);
      ctx.lineWidth = r * width;
      ctx.filter = `blur(${r * width * 0.6}px)`;
      ctx.stroke();
    }
    ctx.restore();
    // The atmosphere above the rim, brightest toward the sun.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalCompositeOperation = "lighter";
    for (const [width, alpha, spread] of [[0.006, 0.95, 1.2], [0.02, 0.5, 1.5], [0.06, 0.22, 1.9], [0.14, 0.08, 2.4]]) {
      ctx.beginPath();
      ctx.arc(0, 0, r * (1 + width / 2), sunAt - spread, sunAt + spread);
      ctx.strokeStyle = L.rgba(air, alpha);
      ctx.lineWidth = r * width;
      ctx.filter = `blur(${r * width * 0.7}px)`;
      ctx.stroke();
    }
    ctx.restore();
    // The sun's first light on the rim.
    const sx = cx + Math.cos(sunAt) * r * 1.002;
    const sy = cy + Math.sin(sunAt) * r * 1.002;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const flare = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 0.5);
    flare.addColorStop(0, "rgba(255,250,235,1)");
    flare.addColorStop(0.04, "rgba(255,236,205,0.75)");
    flare.addColorStop(0.2, "rgba(255,190,150,0.18)");
    flare.addColorStop(1, "rgba(255,160,140,0)");
    ctx.fillStyle = flare;
    ctx.beginPath();
    ctx.arc(sx, sy, r * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    L.spike(ctx, sx, sy, r * 0.12, "#fff6e8");
  }

  /** The home page's hero: a deep field with violet and rose nebulae, and a planet's sunrise at the lower right; the left kept calm for words. */
  ART.hero = {
    w: 2560,
    h: 1440,
    quality: 82,
    draw(ctx, w, h) {
      L.sky(ctx, w, h, SPACE);
      const cloud = (u, v) => {
        const dx = (u - 0.78) * 1.1;
        const dy = (v - 0.3) * 1.5;
        return L.smooth(0.3, 0.75, u) * Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) * 1.6);
      };
      L.nebula(ctx, w, h, 7, { colors: ["#1a0d4a", "#4a22a0", "#8f3fc9", "#d65a9c", "#ffa184"], mask: cloud, scale: 2.2, strength: 1.5, detail: 4, blur: 20 });
      L.nebula(ctx, w, h, 19, { colors: ["#062a4a", "#13709a", "#5fd2df"], mask: (u, v) => cloud(u, v) * 0.7, scale: 3, strength: 0.7, detail: 4, blur: 24 });
      L.stars(ctx, w, h, L.rng(3), { count: 5200, max: 1.5, alpha: 0.8 });
      L.stars(ctx, w, h, L.rng(4), { count: 70, max: 2.4, spikes: 5 });
      L.sphere(ctx, w * 0.58, h * 0.2, 18, { light: -Math.PI * 0.3, base: "#bdb7ad", paint: L.lunar(5), shade: 0.9 });
      planetRise(ctx, w * 0.8, h * 1.42, h * 0.92, { sunAt: -Math.PI / 2 - 0.12 });
      const calm = ctx.createLinearGradient(0, 0, w * 0.58, 0);
      calm.addColorStop(0, "rgba(4,5,12,0.7)");
      calm.addColorStop(1, "rgba(4,5,12,0)");
      ctx.fillStyle = calm;
      ctx.fillRect(0, 0, w, h);
      L.grain(ctx, w, h, 99, 5);
    },
  };

  /** Stars that tile without a seam, on nothing: the theme's sky behind every page. */
  ART.stars = {
    w: 1024,
    h: 1024,
    alpha: true,
    quality: 70,
    draw(ctx, w, h) {
      L.stars(ctx, w, h, L.rng(101), { count: 420, max: 1.1, wrap: true, alpha: 0.85 });
    },
  };

  /** A few brighter stars that tile, for the layer that twinkles. */
  ART.twinkle = {
    w: 1024,
    h: 1024,
    alpha: true,
    quality: 70,
    draw(ctx, w, h) {
      L.stars(ctx, w, h, L.rng(202), { count: 46, max: 2.4, wrap: true });
    },
  };

  /** The shop's prints, framed on the gallery wall (3:4, as the product cards). */
  const PRINTS = { saturn, jupiter, "moon-phases": moonPhases, "orion-nebula": orionNebula, andromeda, eclipse, "sky-chart": skyChart, "pale-blue-dot": paleBlueDot };
  for (const [name, subject] of Object.entries(PRINTS)) {
    ART[`print-${name}`] = {
      w: 1200,
      h: 1600,
      quality: 82,
      draw(ctx, w, h) {
        L.framedPrint(ctx, w, h, (c, aw, ah) => subject(c, aw, ah), { artW: 0.6, ratio: 4 / 3 });
        L.grain(ctx, w, h, 7, 4);
      },
    };
  }

  /** The three collections' tiles: the subjects themselves, landscape. */
  ART["tile-planets"] = { w: 1200, h: 900, quality: 80, draw: (ctx, w, h) => saturn(ctx, w, h, 12) };
  ART["tile-deep-sky"] = { w: 1200, h: 900, quality: 80, draw: (ctx, w, h) => orionNebula(ctx, w, h, 42) };
  ART["tile-charts"] = { w: 1200, h: 900, quality: 80, draw: (ctx, w, h) => skyChart(ctx, w, h, 72) };

  /** Star trails turning over an observatory on a hill: the story's picture. */
  ART.trails = {
    w: 1600,
    h: 1200,
    quality: 80,
    draw(ctx, w, h) {
      L.sky(ctx, w, h, [
        [0, "#03040b"],
        [0.6, "#0a1030"],
        [1, "#1b2a55"],
      ]);
      const random = L.rng(301);
      const px = w * 0.72;
      const py = h * 0.08;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 1600; i++) {
        const rad = Math.sqrt(random()) * w * 1.25;
        const start = random() * TAU;
        const sweep = 0.42;
        const tint = random.pick(["#ffffff", "#cfdcff", "#ffe6c2", "#bcd0ff"]);
        ctx.strokeStyle = L.rgba(tint, 0.08 + Math.pow(random(), 4) * 0.6);
        ctx.lineWidth = 0.6 + Math.pow(random(), 5) * 2;
        ctx.beginPath();
        ctx.arc(px, py, rad, start, start + sweep);
        ctx.stroke();
      }
      ctx.restore();
      const glow = ctx.createLinearGradient(0, h * 0.7, 0, h);
      glow.addColorStop(0, "rgba(60,90,160,0)");
      glow.addColorStop(1, "rgba(90,120,190,0.35)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
      // The hill and the dome.
      ctx.fillStyle = "#020309";
      ctx.beginPath();
      ctx.moveTo(0, h);
      ctx.lineTo(0, h * 0.84);
      ctx.bezierCurveTo(w * 0.25, h * 0.8, w * 0.38, h * 0.74, w * 0.5, h * 0.76);
      ctx.bezierCurveTo(w * 0.66, h * 0.78, w * 0.8, h * 0.86, w, h * 0.85);
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
      const dx = w * 0.5;
      const dy = h * 0.755;
      const dr = w * 0.045;
      ctx.beginPath();
      ctx.rect(dx - dr, dy - dr * 0.2, dr * 2, dr * 0.6);
      ctx.arc(dx, dy - dr * 0.2, dr, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = "rgba(255,210,150,0.85)";
      ctx.fillRect(dx - dr * 0.08, dy - dr * 1.05, dr * 0.16, dr * 0.5);
    },
  };

  /** The Milky Way over mountains: the about page's picture. */
  ART.milkyway = {
    w: 2400,
    h: 1200,
    quality: 80,
    draw(ctx, w, h) {
      L.sky(ctx, w, h, [
        [0, "#03040b"],
        [0.7, "#0a0f28"],
        [1, "#16234a"],
      ]);
      const band = (u, v) => {
        const d = Math.abs(v - (0.95 - u * 0.9));
        return Math.max(0, 1 - d * 3.2);
      };
      // The band's glow first, then its clouds and its crowd of stars.
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.translate(w / 2, h * 0.5);
      ctx.rotate(-Math.atan2(h * 0.9, w));
      const glow = ctx.createLinearGradient(0, -h * 0.3, 0, h * 0.3);
      glow.addColorStop(0, "rgba(120,110,170,0)");
      glow.addColorStop(0.5, "rgba(210,190,200,0.22)");
      glow.addColorStop(1, "rgba(120,110,170,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(-w, -h * 0.3, w * 2, h * 0.6);
      ctx.restore();
      L.nebula(ctx, w, h, 401, { colors: ["#3a2a5e", "#8a6a9a", "#f0cdb0", "#fff4e4"], mask: band, scale: 3, strength: 1.5, detail: 4, blur: 12 });
      L.stars(ctx, w, h, L.rng(402), { count: 16000, max: 1.2, where: (x, y) => 0.15 + band(x / w, y / h) * 0.85 });
      L.stars(ctx, w, h, L.rng(403), { count: 260, max: 2.2, spikes: 4 });
      ctx.fillStyle = "#03040a";
      ctx.beginPath();
      ctx.moveTo(0, h);
      const random = L.rng(405);
      let y = h * 0.86;
      for (let x = 0; x <= w; x += w / 40) {
        y = Math.min(h * 0.95, Math.max(h * 0.74, y + random.gauss() * h * 0.025));
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    },
  };
})();
