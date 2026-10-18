/* global window, document */
/**
 * Kinetic's art (`docs/signature-themes.md`): a sportswear brand drawn as a poster studio would, standing in until the photographs are made
 * (D270). Red running tracks in perspective under sunrise, dusk and floodlit night skies, runners as bold pictograms in full stride (a woman
 * with a ponytail, a man; no faces, no numbers), motion streaks, and the shop's kit laid out on a light grey seamless background. No words,
 * numbers or logos anywhere.
 */
(() => {
  const L = window.ARTLIB;
  const ART = window.ART;
  const TAU = Math.PI * 2;

  const TRACK = "#b8392c";
  const TRACK_DARK = "#7e2219";

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------------------------------------------------------------

  /** A smooth closed shape through the points (quadratic curves through their midpoints). */
  function blob(ctx, pts) {
    ctx.beginPath();
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const start = mid(pts[pts.length - 1], pts[0]);
    ctx.moveTo(start[0], start[1]);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const m = mid(p, pts[(i + 1) % pts.length]);
      ctx.quadraticCurveTo(p[0], p[1], m[0], m[1]);
    }
    ctx.closePath();
  }

  /** A shape with straight edges (for garments' hems and seams). */
  function poly(ctx, pts) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
  }

  /** A sky from top to horizon, and a sun's glow. */
  function skyWith(ctx, w, h, stops, sun) {
    L.sky(ctx, w, h, stops);
    if (sun) {
      const g = ctx.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, sun.r);
      g.addColorStop(0, sun.core);
      g.addColorStop(0.18, sun.glow);
      g.addColorStop(1, "rgba(255,200,140,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  }

  /** A low skyline of trees and a stand on the horizon. */
  function skyline(ctx, w, y, seed, color, { stand = null } = {}) {
    const random = L.rng(seed);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, y + 4);
    let x = 0;
    while (x < w) {
      const step = random.range(w * 0.01, w * 0.03);
      const top = y - random.range(4, 26) * (w / 2400);
      ctx.quadraticCurveTo(x + step / 2, top - random.range(4, 18) * (w / 2400), x + step, y - random.range(0, 8));
      x += step;
    }
    ctx.lineTo(w, y + 6);
    ctx.lineTo(w, y + 40);
    ctx.lineTo(0, y + 40);
    ctx.closePath();
    ctx.fill();
    if (stand) {
      const [sx, sw, sh] = stand;
      ctx.beginPath();
      ctx.moveTo(sx, y + 4);
      ctx.lineTo(sx + sw * 0.08, y - sh);
      ctx.lineTo(sx + sw, y - sh * 0.82);
      ctx.lineTo(sx + sw, y + 4);
      ctx.closePath();
      ctx.fill();
    }
  }

  /**
   * A running track seen from its side, receding to a vanishing point: red ground below `top`, white lane lines fanning from the bottom edge
   * to the point, a little texture and a darker far edge.
   */
  function trackGround(ctx, w, h, top, vp, seed, { lanes = 8, light = 1 } = {}) {
    const g = ctx.createLinearGradient(0, top, 0, h);
    g.addColorStop(0, L.rgba(TRACK_DARK, 1));
    g.addColorStop(0.35, L.rgba(TRACK, 1));
    g.addColorStop(1, L.rgba("#c9473a", 1));
    ctx.fillStyle = g;
    ctx.fillRect(0, top, w, h - top);
    // The rubber's grain.
    const random = L.rng(seed);
    for (let i = 0; i < (w * (h - top)) / 120; i++) {
      const y = random.range(top, h);
      const x = random.range(0, w);
      ctx.fillStyle = `rgba(${random() < 0.5 ? "0,0,0" : "255,220,200"},${random.range(0.03, 0.08)})`;
      ctx.fillRect(x, y, 2 + (y - top) / 160, 1 + (y - top) / 300);
    }
    // Lane lines from the bottom edge to the vanishing point, thicker near.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, w, h - top);
    ctx.clip();
    for (let i = 0; i <= lanes; i++) {
      const bx = -w * 0.6 + (i / lanes) * w * 2.2;
      ctx.beginPath();
      ctx.moveTo(vp[0], vp[1]);
      ctx.lineTo(bx - 6, h);
      ctx.lineTo(bx + 6, h);
      ctx.closePath();
      ctx.fillStyle = L.rgba("#f6f4ee", 0.85 * light);
      ctx.fill();
    }
    ctx.restore();
    // A haze where the track meets the horizon.
    const haze = ctx.createLinearGradient(0, top - 10, 0, top + (h - top) * 0.25);
    haze.addColorStop(0, "rgba(255,210,170,0.35)");
    haze.addColorStop(1, "rgba(255,210,170,0)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, top - 10, w, (h - top) * 0.25 + 10);
  }

  /** Long horizontal light streaks behind a moving figure. */
  function streaks(ctx, x, y, len, spread, seed, color, count = 26) {
    const random = L.rng(seed);
    for (let i = 0; i < count; i++) {
      const yy = y + random.range(-spread, spread);
      const l = len * random.range(0.35, 1);
      const x0 = x - l;
      const g = ctx.createLinearGradient(x0, 0, x, 0);
      g.addColorStop(0, L.rgba(color, 0));
      g.addColorStop(1, L.rgba(color, random.range(0.15, 0.5)));
      ctx.strokeStyle = g;
      ctx.lineWidth = random.range(1, 4) * (spread / 120);
      ctx.beginPath();
      ctx.moveTo(x0, yy);
      ctx.lineTo(x - random.range(0, len * 0.15), yy);
      ctx.stroke();
    }
  }

  /** The grain every picture is finished with. */
  function finish(ctx, w, h, seed, amount = 7) {
    L.grain(ctx, w, h, seed, amount);
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // The runner: a pictogram in full stride, built from its joints (side view, running to the right, no face)
  // ---------------------------------------------------------------------------------------------------------------------------------

  const POSES = {
    // Angles in degrees from straight down, forward positive; elbows and knees are the second angle of each limb.
    sprint: { lean: 14, nearLeg: [62, -6], farLeg: [-30, -42], nearArm: [-50, 38], farArm: [44, 132] },
    stride: { lean: 9, nearLeg: [-24, -78], farLeg: [40, -6], nearArm: [40, 128], farArm: [-46, 40] },
    jog: { lean: 5, nearLeg: [28, -10], farLeg: [-18, -60], nearArm: [-28, 50], farArm: [30, 112] },
  };

  const rad = (deg) => (deg * Math.PI) / 180;
  const at = (p, deg, len) => [p[0] + Math.sin(rad(deg)) * len, p[1] + Math.cos(rad(deg)) * len];

  /**
   * Draws a runner `H` tall with feet near (x, y): `woman` adds a ponytail and a narrower build; `kit` colours the top, the legs' wear and the
   * skin; `light` is the side the light comes from (-1 left, 1 right) for a rim of light; `alpha` for runners far away.
   */
  function runner(ctx, x, y, H, { pose = "stride", woman = false, kit = {}, light = -1, rim = "#ffd2a0", alpha = 1, scale = 1 } = {}) {
    const P = POSES[pose];
    const skin = kit.skin ?? "#3a2a24";
    const top = kit.top ?? skin;
    const bottom = kit.bottom ?? "#15171a";
    const legs = kit.legs ?? (kit.tights ? bottom : skin);
    const shoe = kit.shoe ?? "#f2f0ea";
    const W = H * scale;
    const thigh = H * 0.245;
    const shin = H * 0.255;
    const upper = H * 0.17;
    const fore = H * 0.16;
    const lean = rad(P.lean);
    const hip = [x, y - H * 0.53];
    const neck = [hip[0] + Math.sin(lean) * H * 0.33, hip[1] - Math.cos(lean) * H * 0.33];
    const head = [neck[0] + Math.sin(lean) * H * 0.085, neck[1] - Math.cos(lean) * H * 0.085];
    const shoulder = [neck[0] - Math.sin(lean) * H * 0.03, neck[1] + Math.cos(lean) * H * 0.03];
    const c = document.createElement("canvas");
    c.width = ctx.canvas.width;
    c.height = ctx.canvas.height;
    const f = c.getContext("2d");
    f.lineCap = "round";
    f.lineJoin = "round";
    const limb = (from, [a, b], l1, l2, w1, w2, color, end) => {
      const mid = at(from, a + P.lean, l1);
      const tip = at(mid, b + P.lean, l2);
      f.strokeStyle = color;
      f.lineWidth = w1;
      f.beginPath();
      f.moveTo(from[0], from[1]);
      f.lineTo(mid[0], mid[1]);
      f.stroke();
      f.strokeStyle = end?.lower ?? color;
      f.lineWidth = w2;
      f.beginPath();
      f.moveTo(mid[0], mid[1]);
      f.lineTo(tip[0], tip[1]);
      f.stroke();
      if (end?.shoe) {
        // A shoe: a short rounded wedge pointing forward from the ankle.
        const dir = rad(b + P.lean + 90);
        f.strokeStyle = end.shoe;
        f.lineWidth = w2 * 1.05;
        f.beginPath();
        f.moveTo(tip[0] - Math.sin(dir) * w2 * 0.3, tip[1] - Math.cos(dir) * w2 * 0.3);
        f.lineTo(tip[0] + Math.sin(dir) * W * 0.07, tip[1] + Math.cos(dir) * W * 0.07);
        f.stroke();
      }
      return tip;
    };
    const legW = H * (woman ? 0.078 : 0.085);
    const armW = H * (woman ? 0.042 : 0.05);
    // The far side first, a shade darker.
    f.globalAlpha = 1;
    limb(shoulder, P.farArm, upper, fore, armW, armW * 0.85, kit.sleeves ? top : skin, { lower: skin });
    limb(hip, P.farLeg, thigh, shin, legW, legW * 0.72, kit.shorts ? bottom : legs, { lower: legs, shoe });
    f.globalCompositeOperation = "source-atop";
    f.fillStyle = "rgba(0,0,0,0.28)";
    f.fillRect(0, 0, c.width, c.height);
    f.globalCompositeOperation = "source-over";
    // The torso: a tapered shape from the shoulders to the hips.
    const across = (p, d) => [p[0] + Math.cos(lean) * d, p[1] + Math.sin(lean) * d];
    const sw = H * (woman ? 0.06 : 0.075);
    const hw = H * (woman ? 0.062 : 0.055);
    f.fillStyle = top;
    blob(f, [across(shoulder, -sw), across(shoulder, sw), across([(shoulder[0] + hip[0]) / 2, (shoulder[1] + hip[1]) / 2], sw * 0.9), across(hip, hw), across(hip, -hw), across([(shoulder[0] + hip[0]) / 2, (shoulder[1] + hip[1]) / 2], -sw * 0.85)]);
    f.fill();
    // Shorts or tights at the hips.
    f.fillStyle = bottom;
    blob(f, [across(hip, -hw * 1.05), across(hip, hw * 1.1), across([hip[0], hip[1] + H * 0.09], hw * 1.15), across([hip[0], hip[1] + H * 0.09], -hw * 1.1)]);
    f.fill();
    // The neck and head (round, no face), and a ponytail streaming back.
    f.strokeStyle = skin;
    f.lineWidth = H * 0.04;
    f.beginPath();
    f.moveTo(shoulder[0], shoulder[1]);
    f.lineTo(head[0], head[1]);
    f.stroke();
    const r = H * 0.062;
    f.fillStyle = skin;
    f.beginPath();
    f.arc(head[0], head[1] - r * 0.4, r, 0, TAU);
    f.fill();
    f.fillStyle = kit.hair ?? "#16110f";
    f.beginPath();
    f.arc(head[0] - r * 0.12, head[1] - r * 0.62, r * 0.92, Math.PI * 0.95, Math.PI * 2.15);
    f.fill();
    if (woman) {
      f.strokeStyle = kit.hair ?? "#16110f";
      f.lineWidth = r * 0.55;
      f.beginPath();
      f.moveTo(head[0] - r * 0.7, head[1] - r * 0.9);
      f.quadraticCurveTo(head[0] - r * 1.9, head[1] - r * 1.3, head[0] - r * 2.6, head[1] - r * 0.4);
      f.stroke();
      f.lineWidth = r * 0.3;
      f.beginPath();
      f.moveTo(head[0] - r * 2.2, head[1] - r * 0.75);
      f.quadraticCurveTo(head[0] - r * 2.9, head[1] - r * 0.6, head[0] - r * 3.1, head[1] + r * 0.1);
      f.stroke();
    }
    // The near side.
    limb(hip, P.nearLeg, thigh, shin, legW, legW * 0.72, kit.shorts ? bottom : legs, { lower: legs, shoe });
    limb(shoulder, P.nearArm, upper, fore, armW, armW * 0.85, kit.sleeves ? top : skin, { lower: skin });
    // A rim of light on the side the light comes from.
    f.globalCompositeOperation = "source-atop";
    const rimG = f.createLinearGradient(x - W * 0.35 * -light, 0, x + W * 0.35 * -light, 0);
    rimG.addColorStop(0, L.rgba(rim, 0.55));
    rimG.addColorStop(0.35, L.rgba(rim, 0.0));
    rimG.addColorStop(1, "rgba(0,0,0,0.25)");
    f.fillStyle = rimG;
    f.fillRect(0, 0, c.width, c.height);
    f.globalCompositeOperation = "source-over";
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(c, 0, 0);
    ctx.restore();
  }

  /** A soft shadow on the track under a runner. */
  function groundShadow(ctx, x, y, w, alpha = 0.35) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, w);
    g.addColorStop(0, `rgba(30,6,4,${alpha})`);
    g.addColorStop(1, "rgba(30,6,4,0)");
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, 0.18);
    ctx.translate(-x, -y);
    ctx.fillStyle = g;
    ctx.fillRect(x - w, y - w, w * 2, w * 2);
    ctx.restore();
  }

  /** A floodlight on its pole, glowing. */
  function floodlight(ctx, x, y, s, base) {
    ctx.strokeStyle = "rgba(18,20,26,0.9)";
    ctx.lineWidth = s * 0.06;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, base);
    ctx.stroke();
    ctx.fillStyle = "rgba(18,20,26,0.95)";
    ctx.fillRect(x - s * 0.5, y - s * 0.22, s, s * 0.34);
    for (let i = 0; i < 4; i++) {
      const lx = x - s * 0.36 + i * s * 0.24;
      const g = ctx.createRadialGradient(lx, y - s * 0.05, 0, lx, y - s * 0.05, s * 1.4);
      g.addColorStop(0, "rgba(255,252,236,0.95)");
      g.addColorStop(0.08, "rgba(255,246,214,0.55)");
      g.addColorStop(1, "rgba(255,240,200,0)");
      ctx.fillStyle = g;
      ctx.fillRect(lx - s * 1.4, y - s * 1.45, s * 2.8, s * 2.8);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Scenes
  // ---------------------------------------------------------------------------------------------------------------------------------

  const WOMAN_KIT = { skin: "#4a3026", top: "#e8604c", bottom: "#15171a", tights: true, hair: "#1a120e", shoe: "#f4f2ec" };
  const MAN_KIT = { skin: "#2e211c", top: "#f2f1ec", bottom: "#15171a", shorts: true, hair: "#120d0b", shoe: "#d6342a" };

  /** The hero: a woman and a man sprinting side by side on a red track at sunrise, in the right two thirds; calm sky and track on the left. */
  ART.hero = {
    w: 2560,
    h: 1440,
    quality: 82,
    draw(ctx, w, h) {
      const horizon = h * 0.6;
      skyWith(
        ctx,
        w,
        horizon + 20,
        [
          [0, "#18213a"],
          [0.45, "#5a4a6a"],
          [0.78, "#e48a5c"],
          [1, "#f6c27e"],
        ],
        { x: w * 0.3, y: horizon - h * 0.02, r: h * 0.7, core: "rgba(255,244,214,1)", glow: "rgba(255,196,130,0.6)" },
      );
      skyline(ctx, w, horizon, 11, "#2a1c22");
      trackGround(ctx, w, h, horizon, [w * 0.08, horizon - h * 0.02], 12, { lanes: 9 });
      // The sun's light along the lanes.
      const shine = ctx.createRadialGradient(w * 0.3, horizon, 0, w * 0.3, horizon, w * 0.5);
      shine.addColorStop(0, "rgba(255,214,160,0.45)");
      shine.addColorStop(1, "rgba(255,214,160,0)");
      ctx.fillStyle = shine;
      ctx.fillRect(0, horizon, w, h - horizon);
      const H = h * 0.72;
      streaks(ctx, w * 0.56, h * 0.56, w * 0.34, h * 0.24, 13, "#ffe2bc", 34);
      groundShadow(ctx, w * 0.6, h * 0.95, w * 0.12);
      groundShadow(ctx, w * 0.8, h * 0.92, w * 0.12);
      runner(ctx, w * 0.8, h * 0.92, H * 0.95, { pose: "sprint", woman: false, kit: MAN_KIT, light: -1 });
      runner(ctx, w * 0.6, h * 0.95, H, { pose: "stride", woman: true, kit: WOMAN_KIT, light: -1 });
      finish(ctx, w, h, 14, 8);
    },
  };

  /** The story: a club of women and men jogging together along a track at dusk under floodlights. */
  ART.story = {
    w: 1600,
    h: 1200,
    quality: 82,
    draw(ctx, w, h) {
      const horizon = h * 0.56;
      skyWith(ctx, w, horizon + 20, [
        [0, "#141a2c"],
        [0.55, "#3c3a58"],
        [0.85, "#b0645a"],
        [1, "#d98a62"],
      ]);
      skyline(ctx, w, horizon, 21, "#1b151d", { stand: [w * 0.08, w * 0.5, h * 0.09] });
      floodlight(ctx, w * 0.2, h * 0.16, w * 0.06, horizon);
      floodlight(ctx, w * 0.78, h * 0.12, w * 0.06, horizon);
      trackGround(ctx, w, h, horizon, [w * 1.1, horizon - h * 0.04], 22, { lanes: 8, light: 0.8 });
      // Evening light falling on the track from the floodlights.
      for (const fx of [0.2, 0.78]) {
        const g = ctx.createRadialGradient(w * fx, horizon + h * 0.1, 0, w * fx, horizon + h * 0.1, w * 0.4);
        g.addColorStop(0, "rgba(255,240,210,0.22)");
        g.addColorStop(1, "rgba(255,240,210,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, horizon, w, h - horizon);
      }
      const group = [
        [0.24, 0.9, 0.36, true, { skin: "#5a3a2c", top: "#2f6db0", bottom: "#15171a", tights: true }],
        [0.39, 0.86, 0.33, false, { skin: "#2e211c", top: "#e8604c", bottom: "#15171a", shorts: true }],
        [0.52, 0.93, 0.37, false, { skin: "#8a6050", top: "#15171a", bottom: "#15171a", shorts: true, sleeves: true }],
        [0.66, 0.88, 0.34, true, { skin: "#3a2a24", top: "#f2f1ec", bottom: "#2a2d33", tights: true }],
        [0.8, 0.91, 0.35, true, { skin: "#6b4636", top: "#d6342a", bottom: "#15171a", shorts: true }],
      ];
      for (const [gx, gy, gs, woman, kit] of group) {
        groundShadow(ctx, w * gx, h * gy, w * 0.07, 0.3);
        runner(ctx, w * gx, h * gy, h * gs, { pose: "jog", woman, kit: { shoe: "#f2f0ea", ...kit }, light: 1, rim: "#ffe9c8" });
      }
      finish(ctx, w, h, 23, 8);
    },
  };

  /** The night band: a floodlit track curving into the dark, two runners far down its outside lane, calm in the middle for words. */
  ART.track = {
    w: 2400,
    h: 1200,
    quality: 80,
    draw(ctx, w, h) {
      L.sky(ctx, w, h, [
        [0, "#05070c"],
        [0.5, "#0b0f18"],
        [1, "#120d0f"],
      ]);
      floodlight(ctx, w * 0.08, h * 0.12, w * 0.05, h * 0.5);
      floodlight(ctx, w * 0.93, h * 0.08, w * 0.05, h * 0.48);
      // The track's curve: lanes as wide arcs, lit from the left.
      const cx = w * 0.5;
      const cy = h * 1.75;
      ctx.save();
      for (let i = 0; i < 9; i++) {
        const r = h * (1.0 + i * 0.075);
        ctx.beginPath();
        ctx.ellipse(cx, cy, r * 1.9, r, 0, Math.PI, TAU);
        ctx.strokeStyle = i === 0 ? "#3a120d" : L.rgba(TRACK, 0.0);
        ctx.lineWidth = h * 0.075;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.ellipse(cx, cy, h * 2.85, h * 1.5, 0, Math.PI, TAU);
      ctx.ellipse(cx, cy, h * 1.75, h * 0.92, 0, TAU, Math.PI, true);
      const tg = ctx.createLinearGradient(0, 0, w, 0);
      tg.addColorStop(0, "#9a3226");
      tg.addColorStop(0.5, "#5a1a13");
      tg.addColorStop(1, "#8a2c21");
      ctx.fillStyle = tg;
      ctx.fill();
      for (let i = 0; i <= 8; i++) {
        const k = 0.92 + i * 0.0725;
        ctx.beginPath();
        ctx.ellipse(cx, cy, h * 1.9 * k, h * k, 0, Math.PI, TAU);
        ctx.strokeStyle = "rgba(240,236,228,0.55)";
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      ctx.restore();
      // The field inside, dark green, and the light pooled from the floodlights.
      ctx.beginPath();
      ctx.ellipse(cx, cy, h * 1.75, h * 0.92, 0, Math.PI, TAU);
      ctx.fillStyle = "#0b1610";
      ctx.fill();
      for (const fx of [0.08, 0.93]) {
        const g = ctx.createRadialGradient(w * fx, h * 0.55, 0, w * fx, h * 0.55, w * 0.42);
        g.addColorStop(0, "rgba(255,244,220,0.28)");
        g.addColorStop(1, "rgba(255,244,220,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
      runner(ctx, w * 0.82, h * 0.86, h * 0.17, { pose: "stride", woman: true, kit: { skin: "#3a2a24", top: "#c8ff2e", bottom: "#15171a", tights: true }, light: 1, rim: "#fff4dc" });
      runner(ctx, w * 0.9, h * 0.9, h * 0.18, { pose: "sprint", woman: false, kit: { skin: "#2e211c", top: "#f2f1ec", bottom: "#15171a", shorts: true }, light: 1, rim: "#fff4dc" });
      // Darker in the middle, where the words go.
      const calm = ctx.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h * 0.45, w * 0.45);
      calm.addColorStop(0, "rgba(5,7,12,0.55)");
      calm.addColorStop(1, "rgba(5,7,12,0)");
      ctx.fillStyle = calm;
      ctx.fillRect(0, 0, w, h);
      finish(ctx, w, h, 33, 6);
    },
  };

  /** A tall tile: one runner large against the sky, the track below. */
  function runnerTile(ctx, w, h, { seed, sky, woman, kit, pose, light, rim, streak }) {
    const horizon = h * 0.7;
    skyWith(ctx, w, horizon + 10, sky.stops, sky.sun);
    skyline(ctx, w, horizon, seed, sky.line);
    trackGround(ctx, w, h, horizon, [w * 0.5, horizon - h * 0.05], seed + 1, { lanes: 6 });
    streaks(ctx, w * 0.42, h * 0.5, w * 0.5, h * 0.18, seed + 2, streak, 24);
    groundShadow(ctx, w * 0.52, h * 0.9, w * 0.3, 0.4);
    runner(ctx, w * 0.52, h * 0.9, h * 0.72, { pose, woman, kit, light, rim });
    finish(ctx, w, h, seed + 3, 8);
  }

  ART["tile-women"] = {
    w: 1200,
    h: 1500,
    quality: 82,
    draw(ctx, w, h) {
      runnerTile(ctx, w, h, {
        seed: 41,
        sky: { stops: [[0, "#2a2140"], [0.6, "#c8735a"], [1, "#f4b878"]], sun: { x: w * 0.15, y: h * 0.66, r: h * 0.6, core: "rgba(255,240,206,1)", glow: "rgba(255,190,120,0.55)" }, line: "#2b1b20" },
        woman: true,
        kit: WOMAN_KIT,
        pose: "stride",
        light: -1,
        rim: "#ffd2a0",
        streak: "#ffe2bc",
      });
    },
  };

  ART["tile-men"] = {
    w: 1200,
    h: 1500,
    quality: 82,
    draw(ctx, w, h) {
      runnerTile(ctx, w, h, {
        seed: 51,
        sky: { stops: [[0, "#0f2236"], [0.6, "#4f7a94"], [1, "#bcd4dc"]], sun: { x: w * 0.85, y: h * 0.64, r: h * 0.55, core: "rgba(244,250,255,1)", glow: "rgba(200,226,240,0.5)" }, line: "#132430" },
        woman: false,
        kit: MAN_KIT,
        pose: "sprint",
        light: 1,
        rim: "#e6f4ff",
        streak: "#dff0ff",
      });
    },
  };

  // ---------------------------------------------------------------------------------------------------------------------------------
  // The kit
  // ---------------------------------------------------------------------------------------------------------------------------------

  /** A light grey seamless background, lighter in the middle, with a soft floor shadow. */
  function seamless(ctx, w, h, seed) {
    const g = ctx.createRadialGradient(w / 2, h * 0.42, w * 0.1, w / 2, h * 0.5, h * 0.8);
    g.addColorStop(0, "#f1f1ee");
    g.addColorStop(1, "#d8d8d3");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    finish(ctx, w, h, seed, 3);
  }

  function floorShadow(ctx, x, y, w) {
    groundShadow(ctx, x, y, w, 0.22);
  }

  /** Fills a garment's shape, shades it from the left, and draws its seams. */
  function garment(ctx, w, h, outline, color, { seams = [], shade = 0.22, dots = null } = {}) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.18)";
    ctx.shadowBlur = w * 0.04;
    ctx.shadowOffsetY = h * 0.012;
    ctx.fillStyle = color;
    outline();
    ctx.fill();
    ctx.restore();
    ctx.save();
    outline();
    ctx.clip();
    const g = ctx.createLinearGradient(w * 0.2, 0, w * 0.85, 0);
    g.addColorStop(0, `rgba(255,255,255,${shade * 0.6})`);
    g.addColorStop(0.5, "rgba(255,255,255,0)");
    g.addColorStop(1, `rgba(0,0,0,${shade})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    if (dots) {
      ctx.fillStyle = dots.color;
      for (let y = dots.y0; y < dots.y1; y += dots.step) for (let x = dots.x0 + ((y / dots.step) % 2) * dots.step * 0.5; x < dots.x1; x += dots.step) ctx.fillRect(x, y, dots.size, dots.size);
    }
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = w * 0.004;
    ctx.setLineDash([w * 0.008, w * 0.006]);
    for (const seam of seams) {
      ctx.beginPath();
      seam.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.stroke();
    }
    ctx.restore();
  }

  const KIT = {
    "kit-tempo-tights": (ctx, w, h) => {
      const c = w / 2;
      const top = h * 0.17;
      const out = () => {
        ctx.beginPath();
        ctx.moveTo(c - w * 0.2, top);
        ctx.lineTo(c + w * 0.2, top);
        ctx.quadraticCurveTo(c + w * 0.22, top + h * 0.2, c + w * 0.16, h * 0.84);
        ctx.lineTo(c + w * 0.07, h * 0.84);
        ctx.quadraticCurveTo(c + w * 0.05, h * 0.5, c, top + h * 0.22);
        ctx.quadraticCurveTo(c - w * 0.05, h * 0.5, c - w * 0.07, h * 0.84);
        ctx.lineTo(c - w * 0.16, h * 0.84);
        ctx.quadraticCurveTo(c - w * 0.22, top + h * 0.2, c - w * 0.2, top);
        ctx.closePath();
      };
      floorShadow(ctx, c, h * 0.86, w * 0.3);
      garment(ctx, w, h, out, "#1a1c20", {
        seams: [
          [[c - w * 0.2, top + h * 0.07], [c + w * 0.2, top + h * 0.07]],
          [[c - w * 0.115, h * 0.8], [c - w * 0.085, h * 0.5]],
        ],
        shade: 0.3,
      });
      // The reflective strip at the ankle and the zip of the pocket.
      ctx.fillStyle = "rgba(220,224,228,0.8)";
      ctx.fillRect(c + w * 0.085, h * 0.8, w * 0.06, h * 0.006);
      ctx.fillRect(c - w * 0.145, h * 0.8, w * 0.06, h * 0.006);
      ctx.fillStyle = "#3a3d44";
      ctx.fillRect(c - w * 0.06, top + h * 0.035, w * 0.12, h * 0.005);
    },
    "kit-training-tank": (ctx, w, h) => {
      const c = w / 2;
      const out = () =>
        poly(ctx, [
          [c - w * 0.08, h * 0.2],
          [c - w * 0.05, h * 0.2],
          [c, h * 0.28],
          [c + w * 0.05, h * 0.2],
          [c + w * 0.08, h * 0.2],
          [c + w * 0.17, h * 0.42],
          [c + w * 0.2, h * 0.78],
          [c - w * 0.2, h * 0.78],
          [c - w * 0.17, h * 0.42],
        ]);
      floorShadow(ctx, c, h * 0.82, w * 0.3);
      garment(ctx, w, h, out, "#e8604c", { seams: [[[c - w * 0.2, h * 0.755], [c + w * 0.2, h * 0.755]]] });
    },
    "kit-wind-jacket": (ctx, w, h) => {
      const c = w / 2;
      const out = () =>
        poly(ctx, [
          [c - w * 0.07, h * 0.13],
          [c - w * 0.03, h * 0.1],
          [c + w * 0.03, h * 0.1],
          [c + w * 0.07, h * 0.13],
          [c + w * 0.09, h * 0.21],
          [c + w * 0.24, h * 0.25],
          [c + w * 0.33, h * 0.5],
          [c + w * 0.36, h * 0.7],
          [c + w * 0.28, h * 0.71],
          [c + w * 0.24, h * 0.42],
          [c + w * 0.23, h * 0.78],
          [c - w * 0.23, h * 0.78],
          [c - w * 0.24, h * 0.42],
          [c - w * 0.28, h * 0.71],
          [c - w * 0.36, h * 0.7],
          [c - w * 0.33, h * 0.5],
          [c - w * 0.24, h * 0.25],
          [c - w * 0.09, h * 0.21],
        ]);
      floorShadow(ctx, c, h * 0.82, w * 0.38);
      garment(ctx, w, h, out, "#9cc6e4", {
        seams: [
          [[c, h * 0.22], [c, h * 0.77]],
          [[c + w * 0.07, h * 0.36], [c + w * 0.16, h * 0.36]],
        ],
      });
      // The hood's opening.
      ctx.fillStyle = "rgba(40,70,96,0.3)";
      poly(ctx, [[c - w * 0.045, h * 0.135], [c + w * 0.045, h * 0.135], [c + w * 0.055, h * 0.205], [c, h * 0.225], [c - w * 0.055, h * 0.205]]);
      ctx.fill();
      ctx.strokeStyle = "rgba(30,50,70,0.55)";
      ctx.lineWidth = w * 0.006;
      ctx.beginPath();
      ctx.moveTo(c, h * 0.23);
      ctx.lineTo(c, h * 0.77);
      ctx.stroke();
    },
    "kit-split-shorts": (ctx, w, h) => {
      const c = w / 2;
      const top = h * 0.3;
      const out = () =>
        poly(ctx, [
          [c - w * 0.24, top],
          [c + w * 0.24, top],
          [c + w * 0.29, h * 0.62],
          [c + w * 0.2, h * 0.6],
          [c + w * 0.17, h * 0.66],
          [c + w * 0.02, h * 0.64],
          [c, h * 0.48],
          [c - w * 0.02, h * 0.64],
          [c - w * 0.17, h * 0.66],
          [c - w * 0.2, h * 0.6],
          [c - w * 0.29, h * 0.62],
        ]);
      floorShadow(ctx, c, h * 0.72, w * 0.34);
      garment(ctx, w, h, out, "#1a1c20", { seams: [[[c - w * 0.24, top + h * 0.04], [c + w * 0.24, top + h * 0.04]]], shade: 0.3 });
      ctx.fillStyle = "rgba(220,224,228,0.7)";
      ctx.fillRect(c + w * 0.08, h * 0.38, w * 0.08, h * 0.004);
    },
    "kit-base-layer": (ctx, w, h) => {
      const c = w / 2;
      const out = () =>
        poly(ctx, [
          [c - w * 0.07, h * 0.16],
          [c - w * 0.035, h * 0.175],
          [c + w * 0.035, h * 0.175],
          [c + w * 0.07, h * 0.16],
          [c + w * 0.22, h * 0.21],
          [c + w * 0.31, h * 0.45],
          [c + w * 0.35, h * 0.68],
          [c + w * 0.28, h * 0.69],
          [c + w * 0.23, h * 0.4],
          [c + w * 0.21, h * 0.78],
          [c - w * 0.21, h * 0.78],
          [c - w * 0.23, h * 0.4],
          [c - w * 0.28, h * 0.69],
          [c - w * 0.35, h * 0.68],
          [c - w * 0.31, h * 0.45],
          [c - w * 0.22, h * 0.21],
        ]);
      floorShadow(ctx, c, h * 0.82, w * 0.36);
      garment(ctx, w, h, out, "#3b3f46", { seams: [[[c, h * 0.17], [c, h * 0.34]]], shade: 0.28 });
      ctx.strokeStyle = "rgba(220,224,228,0.65)";
      ctx.lineWidth = w * 0.005;
      ctx.beginPath();
      ctx.moveTo(c, h * 0.17);
      ctx.lineTo(c, h * 0.34);
      ctx.stroke();
    },
    "kit-training-tee": (ctx, w, h) => {
      const c = w / 2;
      const out = () =>
        poly(ctx, [
          [c - w * 0.08, h * 0.2],
          [c, h * 0.24],
          [c + w * 0.08, h * 0.2],
          [c + w * 0.24, h * 0.25],
          [c + w * 0.36, h * 0.38],
          [c + w * 0.3, h * 0.45],
          [c + w * 0.22, h * 0.39],
          [c + w * 0.22, h * 0.78],
          [c - w * 0.22, h * 0.78],
          [c - w * 0.22, h * 0.39],
          [c - w * 0.3, h * 0.45],
          [c - w * 0.36, h * 0.38],
          [c - w * 0.24, h * 0.25],
        ]);
      floorShadow(ctx, c, h * 0.82, w * 0.34);
      garment(ctx, w, h, out, "#f6f6f2", {
        shade: 0.16,
        dots: { color: "rgba(0,0,0,0.06)", x0: c - w * 0.2, x1: c + w * 0.2, y0: h * 0.48, y1: h * 0.74, step: w * 0.014, size: w * 0.004 },
        seams: [[[c - w * 0.22, h * 0.39], [c - w * 0.25, h * 0.27]], [[c + w * 0.22, h * 0.39], [c + w * 0.25, h * 0.27]]],
      });
    },
    "kit-trail-shoes": (ctx, w, h) => {
      const x0 = w * 0.16;
      const x1 = w * 0.86;
      const sole = h * 0.62;
      floorShadow(ctx, w / 2, sole + h * 0.05, w * 0.42);
      // The sole and its lugs.
      ctx.fillStyle = "#1a1c20";
      blob(ctx, [[x0, sole - h * 0.02], [x1, sole - h * 0.03], [x1 + w * 0.02, sole + h * 0.02], [x0 + w * 0.02, sole + h * 0.035]]);
      ctx.fill();
      for (let i = 0; i < 11; i++) {
        const x = x0 + w * 0.03 + i * ((x1 - x0) / 11);
        ctx.fillRect(x, sole + h * 0.02, w * 0.035, h * 0.02);
      }
      // The upper.
      garment(
        ctx,
        w,
        h,
        () =>
          blob(ctx, [
            [x0 + w * 0.01, sole - h * 0.015],
            [x0 - w * 0.015, sole - h * 0.11],
            [x0 + w * 0.01, sole - h * 0.175],
            [x0 + w * 0.08, sole - h * 0.17],
            [x0 + w * 0.13, sole - h * 0.135],
            [x0 + w * 0.2, sole - h * 0.205],
            [x0 + w * 0.27, sole - h * 0.16],
            [x1 - w * 0.16, sole - h * 0.095],
            [x1 - w * 0.03, sole - h * 0.07],
            [x1 + w * 0.015, sole - h * 0.03],
            [x1, sole - h * 0.012],
          ]),
        "#d6342a",
        { seams: [[[x0 + w * 0.2, sole - h * 0.12], [x1 - w * 0.12, sole - h * 0.06]]], shade: 0.26 },
      );
      // Its laces and a black heel.
      ctx.strokeStyle = "rgba(20,20,22,0.85)";
      ctx.lineWidth = w * 0.006;
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.moveTo(x0 + w * (0.2 + i * 0.05), sole - h * (0.13 - i * 0.01));
        ctx.lineTo(x0 + w * (0.23 + i * 0.05), sole - h * (0.115 - i * 0.01));
        ctx.stroke();
      }
      ctx.fillStyle = "#1a1c20";
      blob(ctx, [[x0 - w * 0.01, sole - h * 0.1], [x0 + w * 0.04, sole - h * 0.13], [x0 + w * 0.08, sole - h * 0.03], [x0 + w * 0.015, sole - h * 0.015]]);
      ctx.fill();
      // The collar's opening and a toe bumper.
      ctx.fillStyle = "#2a1210";
      blob(ctx, [[x0 + w * 0.03, sole - h * 0.168], [x0 + w * 0.12, sole - h * 0.14], [x0 + w * 0.1, sole - h * 0.125], [x0 + w * 0.035, sole - h * 0.15]]);
      ctx.fill();
      ctx.fillStyle = "#1a1c20";
      blob(ctx, [[x1 - w * 0.07, sole - h * 0.05], [x1 + w * 0.01, sole - h * 0.035], [x1 + w * 0.005, sole - h * 0.012], [x1 - w * 0.08, sole - h * 0.018]]);
      ctx.fill();
    },
    "kit-running-vest": (ctx, w, h) => {
      const c = w / 2;
      floorShadow(ctx, c, h * 0.82, w * 0.32);
      garment(ctx, w, h, () => poly(ctx, [[c - w * 0.15, h * 0.15], [c + w * 0.15, h * 0.15], [c + w * 0.2, h * 0.72], [c - w * 0.2, h * 0.72]]), "#2d3036", { shade: 0.2 });
      const side = (s) => () =>
        poly(ctx, [
          [c + s * w * 0.06, h * 0.14],
          [c + s * w * 0.13, h * 0.14],
          [c + s * w * 0.15, h * 0.3],
          [c + s * w * 0.26, h * 0.4],
          [c + s * w * 0.27, h * 0.74],
          [c + s * w * 0.05, h * 0.74],
          [c + s * w * 0.04, h * 0.36],
        ]);
      garment(ctx, w, h, side(-1), "#1a1c20", { shade: 0.3, seams: [[[c - w * 0.06, h * 0.62], [c - w * 0.25, h * 0.62]]] });
      garment(ctx, w, h, side(1), "#1a1c20", { shade: 0.3, seams: [[[c + w * 0.06, h * 0.62], [c + w * 0.25, h * 0.62]]] });
      // The two flasks at the chest.
      for (const s of [-1, 1]) {
        const fx = c + s * w * 0.15;
        ctx.fillStyle = "rgba(220,236,244,0.85)";
        blob(ctx, [[fx - w * 0.04, h * 0.37], [fx + w * 0.04, h * 0.37], [fx + w * 0.048, h * 0.58], [fx - w * 0.048, h * 0.58]]);
        ctx.fill();
        ctx.fillStyle = "rgba(120,170,200,0.45)";
        ctx.fillRect(fx - w * 0.04, h * 0.45, w * 0.08, h * 0.12);
        ctx.fillStyle = "#d6342a";
        ctx.fillRect(fx - w * 0.015, h * 0.32, w * 0.03, h * 0.04);
      }
      ctx.strokeStyle = "rgba(200,204,210,0.55)";
      ctx.lineWidth = w * 0.006;
      ctx.strokeStyle = "#d6342a";
      ctx.lineWidth = w * 0.008;
      for (const y of [0.3, 0.38]) {
        ctx.beginPath();
        ctx.moveTo(c - w * 0.05, h * y);
        ctx.lineTo(c + w * 0.05, h * y);
        ctx.stroke();
      }
    },
  };

  let seed = 60;
  for (const [name, draw] of Object.entries(KIT)) {
    const s = seed++;
    ART[name] = {
      w: 1200,
      h: 1600,
      quality: 80,
      draw(ctx, w, h) {
        seamless(ctx, w, h, s);
        draw(ctx, w, h);
        finish(ctx, w, h, s + 100, 3);
      },
    };
  }

  /** The gear tile: a trail shoe and a running vest on a slab of dark wet rock, mist behind. */
  ART["tile-gear"] = {
    w: 1200,
    h: 1500,
    quality: 82,
    draw(ctx, w, h) {
      L.sky(ctx, w, h, [
        [0, "#9aa4a8"],
        [0.45, "#5d676c"],
        [1, "#1b1e21"],
      ]);
      const noise = L.simplex(71);
      // The rock, with its grain and a wet sheen.
      ctx.fillStyle = "#24272b";
      blob(ctx, [[-w * 0.1, h * 0.5], [w * 0.5, h * 0.44], [w * 1.1, h * 0.48], [w * 1.1, h * 1.1], [-w * 0.1, h * 1.1]]);
      ctx.fill();
      const img = ctx.getImageData(0, 0, w, h);
      for (let y = Math.floor(h * 0.45); y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const k = (y * w + x) * 4;
          const n = L.fbm(noise, x / 160, y / 160, 4) * 26;
          img.data[k] = L.clamp(img.data[k] + n, 0, 255);
          img.data[k + 1] = L.clamp(img.data[k + 1] + n, 0, 255);
          img.data[k + 2] = L.clamp(img.data[k + 2] + n * 1.05, 0, 255);
        }
      }
      ctx.putImageData(img, 0, 0);
      const sheen = ctx.createLinearGradient(0, h * 0.5, w, h);
      sheen.addColorStop(0, "rgba(220,230,236,0.18)");
      sheen.addColorStop(0.5, "rgba(220,230,236,0)");
      ctx.fillStyle = sheen;
      ctx.fillRect(0, h * 0.45, w, h * 0.55);
      // The vest behind, the shoe in front.
      ctx.save();
      ctx.translate(w * 0.06, h * 0.06);
      ctx.scale(0.92, 0.92);
      KIT["kit-running-vest"](ctx, w, h * 0.92);
      ctx.restore();
      ctx.save();
      ctx.translate(w * 0.04, h * 0.42);
      ctx.scale(0.95, 0.75);
      KIT["kit-trail-shoes"](ctx, w, h * 0.75);
      ctx.restore();
      finish(ctx, w, h, 72, 8);
    },
  };
})();
