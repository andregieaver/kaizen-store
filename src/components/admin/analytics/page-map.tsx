"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A page's heatmap over its picture (D656, `docs/heatmaps-and-recordings.md` 9.3): the picture at its own width scaled to the column, and
 * over it canvas strips at most 4,096 px tall (iOS's limit). Clicks are a heat of points (the kernel 24 px at the picture's scale, the
 * intensity against the 99th percentile), scroll depth and attention are 20 coloured bands. Colours come from the admin's `--chart-seq-*`
 * roles. Everything it draws is in the tables beside it, which the server draws (the analytics rule: every chart has a table).
 */

export type MapPoint = { x: number; y: number; weight: number };

export type PageMapProps = {
  picture: string;
  alt: string;
  width: number;
  height: number;
  /** The page's full height when photographed; the picture may stop before it (10,000 px). */
  pageHeight: number;
  view: "click" | "scroll" | "look";
  clicks?: { all: MapPoint[]; dead: MapPoint[]; rage: MapPoint[] };
  clickLabels?: { all: string; dead: string; rage: string };
  /** Scroll: the share reaching each 5 % step (21), the lines' steps, the average fold in % of the page. */
  reach?: { shares: number[]; lines: { p75: number; p50: number; p25: number }; foldPercent: number | null; lineLabel: string; foldLabel: string };
  /** Look: seconds per view in each of 20 bands over `height` px of the page. */
  look?: { seconds: number[]; labels: string[]; height: number };
};

const STRIP = 4096;
const RADIUS = 28;
const FALLBACK = ["#e0f2fe", "#93c5fd", "#60a5fa", "#a78bfa", "#f472b6", "#f97316", "#dc2626"];

function palette(): string[] {
  const style = getComputedStyle(document.documentElement);
  const colours = FALLBACK.map((fallback, i) => style.getPropertyValue(`--chart-seq-${i}`).trim() || fallback);
  return colours;
}

/** A colour as [r, g, b] through a 1 × 1 canvas, so any CSS colour the roles hold works. */
function rgbOf(colour: string): [number, number, number] {
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  const g = c.getContext("2d");
  if (!g) return [220, 38, 38];
  g.fillStyle = colour;
  g.fillRect(0, 0, 1, 1);
  const [r, gr, b] = g.getImageData(0, 0, 1, 1).data;
  return [r, gr, b];
}

const step = (colours: string[], share: number) => colours[Math.max(0, Math.min(colours.length - 1, Math.round(share * (colours.length - 1))))];

function percentile99(values: number[]): number {
  if (values.length === 0) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] || 1;
}

function drawClicks(g: CanvasRenderingContext2D, top: number, width: number, height: number, points: MapPoint[], colours: string[]) {
  const top99 = percentile99(points.map((p) => p.weight));
  for (const p of points) {
    if (p.y < top - RADIUS || p.y > top + height + RADIUS) continue;
    const gradient = g.createRadialGradient(p.x, p.y - top, 0, p.x, p.y - top, RADIUS);
    gradient.addColorStop(0, `rgba(0,0,0,${Math.min(1, p.weight / top99) * 0.85})`);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gradient;
    g.fillRect(p.x - RADIUS, p.y - top - RADIUS, RADIUS * 2, RADIUS * 2);
  }
  // The accumulated darkness becomes the heat's colours.
  const image = g.getImageData(0, 0, width, height);
  const rgbs = colours.map(rgbOf);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha === 0) continue;
    const [r, gr, b] = rgbs[Math.min(rgbs.length - 1, Math.floor((alpha / 256) * rgbs.length))];
    data[i] = r;
    data[i + 1] = gr;
    data[i + 2] = b;
    data[i + 3] = Math.min(235, 90 + alpha);
  }
  g.putImageData(image, 0, 0);
}

function label(g: CanvasRenderingContext2D, text: string, x: number, y: number, width: number) {
  g.font = "600 13px system-ui, sans-serif";
  const w = g.measureText(text).width + 12;
  g.fillStyle = "rgba(17,17,17,0.85)";
  g.fillRect(width - w - 8, y - 11, w, 22);
  g.fillStyle = "#fff";
  g.fillText(text, width - w - 2, y + 5);
  void x;
}

function dashed(g: CanvasRenderingContext2D, y: number, width: number) {
  g.save();
  g.setLineDash([8, 6]);
  g.lineWidth = 2;
  g.strokeStyle = "rgba(17,17,17,0.85)";
  g.beginPath();
  g.moveTo(0, y);
  g.lineTo(width, y);
  g.stroke();
  g.restore();
}

export function PageMap(props: PageMapProps) {
  const { picture, alt, width, height, pageHeight, view } = props;
  const [kind, setKind] = useState<"all" | "dead" | "rage">("all");
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);
  const strips = Array.from({ length: Math.ceil(height / STRIP) }, (_, i) => ({ top: i * STRIP, height: Math.min(STRIP, height - i * STRIP) }));

  useEffect(() => {
    const colours = palette();
    strips.forEach((strip, i) => {
      const canvas = canvases.current[i];
      const g = canvas?.getContext("2d", { willReadFrequently: true });
      if (!canvas || !g) return;
      g.clearRect(0, 0, width, strip.height);
      if (view === "click" && props.clicks) drawClicks(g, strip.top, width, strip.height, props.clicks[kind], colours);
      if (view === "scroll" && props.reach) {
        const { shares, lines, foldPercent, lineLabel, foldLabel } = props.reach;
        const band = pageHeight / 20;
        for (let b = 0; b < 20; b++) {
          const y = b * band - strip.top;
          if (y + band < 0 || y > strip.height) continue;
          g.globalAlpha = 0.45;
          g.fillStyle = step(colours, shares[b] ?? 0);
          g.fillRect(0, y, width, band);
        }
        g.globalAlpha = 1;
        for (const [stepAt, p] of [[lines.p75, 75], [lines.p50, 50], [lines.p25, 25]] as const) {
          const y = (stepAt / 20) * pageHeight - strip.top;
          if (y < 0 || y > strip.height) continue;
          dashed(g, y, width);
          label(g, lineLabel.replace("{p}", String(p)), 0, y, width);
        }
        if (foldPercent !== null) {
          const y = (foldPercent / 100) * pageHeight - strip.top;
          if (y >= 0 && y <= strip.height) {
            dashed(g, y, width);
            label(g, foldLabel, 0, y, width);
          }
        }
      }
      if (view === "look" && props.look) {
        const { seconds, labels, height: covered } = props.look;
        const busiest = Math.max(...seconds, 0.001);
        const band = covered / 20;
        for (let b = 0; b < 20; b++) {
          const y = b * band - strip.top;
          if (y + band < 0 || y > strip.height || (seconds[b] ?? 0) <= 0) continue;
          g.globalAlpha = 0.5;
          g.fillStyle = step(colours, (seconds[b] ?? 0) / busiest);
          g.fillRect(0, y, width, band);
          g.globalAlpha = 1;
          if (band >= 26) label(g, labels[b] ?? "", 0, y + band / 2, width);
        }
      }
    });
    // The strips depend only on width and height, which the props hold.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, kind, width, height, pageHeight, props.clicks, props.reach, props.look]);

  return (
    <div className="flex flex-col gap-3">
      {view === "click" && props.clicks && props.clickLabels ? (
        <div role="group" className="flex flex-wrap gap-2">
          {(["all", "dead", "rage"] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              className={`inline-flex h-9 items-center rounded-panel border px-3 text-sm ${kind === k ? "border-brand bg-sunken font-medium" : "border-line"}`}
            >
              {props.clickLabels![k]}
            </button>
          ))}
        </div>
      ) : null}
      <div className="relative w-full overflow-hidden rounded-lg border border-line bg-card" style={{ maxWidth: width }}>
        {/* A signed address that changes every visit: next/image would cache and resize what must stay as photographed. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={picture} alt={alt} width={width} height={height} className="block h-auto w-full" />
        {strips.map((strip, i) => (
          <canvas
            key={strip.top}
            ref={(element) => {
              canvases.current[i] = element;
            }}
            width={width}
            height={strip.height}
            aria-hidden="true"
            className="pointer-events-none absolute left-0 w-full"
            style={{ top: `${(strip.top / height) * 100}%`, height: `${(strip.height / height) * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
}
