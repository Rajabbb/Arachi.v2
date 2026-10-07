import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Small SVG charts for the panel, drawn by hand (no chart library): thin
 * marks, recessive grid, one y-axis, and a hover/tap tooltip. Colors come
 * from the --series-* tokens in styles.css, which have their own dark steps.
 */

/** The element's width in px, kept current as the layout changes (phone rotation, sidebar). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Round axis ticks covering [min, max]: 0 / 500 / 1 000 ... */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    if (max === 0) max = 1;
    else [min, max] = [min > 0 ? min * 0.9 : min * 1.1, max > 0 ? max * 1.1 : max * 0.9];
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const err = raw / mag;
  const step = mag * (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1);
  const ticks: number[] = [];
  for (let t = Math.floor(min / step) * step; t <= Math.ceil(max / step) * step + step / 2; t += step) {
    ticks.push(Math.round(t * 1e6) / 1e6);
  }
  return ticks;
}

export const compact = (n: number) =>
  Math.abs(n) >= 10_000 ? `${Math.round(n / 1000).toLocaleString("az-AZ")}K` : n.toLocaleString("az-AZ");

/** Text width estimate for an 11px label, enough to keep axis labels apart. */
const textWidth = (s: string) => s.length * 6.4;

function Tooltip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  // Keep the box inside the chart: centred on the point, pushed in at the edges.
  const half = 80;
  const left = Math.min(Math.max(x, half), Math.max(half, width - half));
  return (
    <div className="chart-tip" style={{ left }} role="status">
      {children}
    </div>
  );
}

export interface Series {
  name: string;
  /** A CSS color, normally var(--series-N). */
  color: string;
  values: number[];
}

/** One legend row: a colored key next to ink-colored text. */
export function Legend({ items }: { items: { name: string; color: string; line?: boolean }[] }) {
  return (
    <ul className="chart-legend">
      {items.map((i) => (
        <li key={i.name}>
          <span className={i.line ? "chart-key chart-key-line" : "chart-key"} style={{ background: i.color }} aria-hidden="true" />
          {i.name}
        </li>
      ))}
    </ul>
  );
}

const H = 200;
const M = { top: 12, right: 12, bottom: 24 };

/** Grouped columns: one group per label (e.g. month), one column per series. */
export function ColumnChart({ labels, tipLabels, series, label }: { labels: string[]; tipLabels?: string[]; series: Series[]; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(0, ...series.flatMap((s) => s.values));
  const ticks = niceTicks(0, max);
  const top = ticks[ticks.length - 1];
  const left = Math.max(24, ...ticks.map((t) => textWidth(compact(t)))) + 8;
  const plotW = Math.max(0, width - left - M.right);
  const plotH = H - M.top - M.bottom;
  const band = labels.length ? plotW / labels.length : 0;
  const gap = 2;
  const barW = Math.max(2, Math.min(24, (band * 0.7 - gap * (series.length - 1)) / series.length));
  const groupW = barW * series.length + gap * (series.length - 1);
  const y = (v: number) => M.top + plotH - (v / top) * plotH;
  // Skip every other month label when they would touch.
  const every = band < textWidth("Yan") + 10 ? 2 : 1;

  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label={label} onPointerLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="chart-grid" x1={left} x2={width - M.right} y1={y(t)} y2={y(t)} />
              <text className="chart-axis" x={left - 6} y={y(t)} dy="0.32em" textAnchor="end">
                {compact(t)}
              </text>
            </g>
          ))}
          {labels.map((l, i) => {
            const x0 = left + band * i + (band - groupW) / 2;
            return (
              <g key={l}>
                {hover === i && <rect className="chart-band" x={left + band * i} y={M.top} width={band} height={plotH} />}
                {series.map((s, k) => {
                  const v = s.values[i];
                  if (!v) return null;
                  const x = x0 + k * (barW + gap);
                  const h = Math.max(1, y(0) - y(v));
                  const r = Math.min(4, barW / 2, h);
                  // Rounded data end, square at the baseline.
                  return (
                    <path
                      key={s.name}
                      fill={s.color}
                      d={`M${x},${y(0)} v${-(h - r)} q0,${-r} ${r},${-r} h${barW - 2 * r} q${r},0 ${r},${r} v${h - r} z`}
                    />
                  );
                })}
                {i % every === (labels.length - 1) % every && (
                  <text className="chart-axis" x={left + band * i + band / 2} y={H - 6} textAnchor="middle">
                    {l}
                  </text>
                )}
                <rect
                  className="chart-hit"
                  x={left + band * i}
                  y={0}
                  width={band}
                  height={H}
                  onPointerEnter={() => setHover(i)}
                  onPointerDown={() => setHover(i)}
                />
              </g>
            );
          })}
          <line className="chart-baseline" x1={left} x2={width - M.right} y1={y(0)} y2={y(0)} />
        </svg>
      )}
      {hover !== null && (
        <Tooltip x={left + band * hover + band / 2} width={width}>
          <strong>{tipLabels?.[hover] ?? labels[hover]}</strong>
          {series.map((s) => (
            <div key={s.name} className="chart-tip-row">
              <span className="chart-key" style={{ background: s.color }} aria-hidden="true" />
              {s.name}: <b>{s.values[hover].toLocaleString("az-AZ")}</b>
            </div>
          ))}
        </Tooltip>
      )}
    </div>
  );
}

export interface LinePoint {
  /** Position on the x scale: an index for months, a timestamp for dates. */
  x: number;
  y: number;
  /** Shown in the tooltip. */
  tip: ReactNode;
  /** Drawn as a hollow marker, e.g. the winning offer. */
  highlight?: boolean;
}

/**
 * One line on a single y-axis. Points with y = null break the line (a month
 * without sends has no response rate). The x scale is linear between xMin
 * and xMax; ticks name the positions worth labelling.
 */
export function LineChart({
  points,
  xMin,
  xMax,
  xTicks,
  color,
  label,
  format = compact,
  zero = true,
}: {
  points: (LinePoint | { x: number; y: null })[];
  xMin: number;
  xMax: number;
  xTicks: { x: number; label: string }[];
  color: string;
  label: string;
  format?: (n: number) => string;
  /** Start the y-axis at 0 (counts, percentages); prices zoom to their range instead. */
  zero?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const real = points.filter((p): p is LinePoint => p.y !== null);
  const ys = real.map((p) => p.y);
  const ticks = niceTicks(zero ? 0 : Math.min(...ys, Infinity), Math.max(...ys, zero ? 0 : -Infinity));
  const [lo, hi] = [ticks[0], ticks[ticks.length - 1]];
  const left = Math.max(24, ...ticks.map((t) => textWidth(format(t)))) + 8;
  const pad = 8; // keeps end markers off the plot edges
  const plotW = Math.max(0, width - left - M.right - 2 * pad);
  const plotH = H - M.top - M.bottom;
  const x = (v: number) => left + pad + (xMax === xMin ? plotW / 2 : ((v - xMin) / (xMax - xMin)) * plotW);
  const y = (v: number) => M.top + plotH - ((v - lo) / (hi - lo || 1)) * plotH;

  // Line segments between consecutive known values.
  const segments: string[] = [];
  let run = "";
  for (const p of points) {
    if (p.y === null) {
      if (run) segments.push(run);
      run = "";
    } else run += `${run ? "L" : "M"}${x(p.x)},${y(p.y)}`;
  }
  if (run) segments.push(run);

  // Tick labels that fit, kept apart and always including the last one.
  const shown: typeof xTicks = [];
  for (const t of [...xTicks].reverse()) {
    const prev = shown[shown.length - 1];
    if (!prev || x(prev.x) - x(t.x) > (textWidth(prev.label) + textWidth(t.label)) / 2 + 8) shown.push(t);
  }

  function nearest(clientX: number, svg: SVGSVGElement) {
    const px = clientX - svg.getBoundingClientRect().left;
    let best: number | null = null;
    real.forEach((p, i) => {
      if (best === null || Math.abs(x(p.x) - px) < Math.abs(x(real[best].x) - px)) best = i;
    });
    setHover(best);
  }

  const last = real[real.length - 1];
  const h = hover === null ? null : real[hover];

  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg
          width={width}
          height={H}
          role="img"
          aria-label={label}
          onPointerMove={(e) => nearest(e.clientX, e.currentTarget)}
          onPointerDown={(e) => nearest(e.clientX, e.currentTarget)}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line className="chart-grid" x1={left} x2={width - M.right} y1={y(t)} y2={y(t)} />
              <text className="chart-axis" x={left - 6} y={y(t)} dy="0.32em" textAnchor="end">
                {format(t)}
              </text>
            </g>
          ))}
          {shown.map((t) => (
            <text key={t.x} className="chart-axis" x={x(t.x)} y={H - 6} textAnchor="middle">
              {t.label}
            </text>
          ))}
          {h && <line className="chart-crosshair" x1={x(h.x)} x2={x(h.x)} y1={M.top} y2={M.top + plotH} />}
          {segments.map((d) => (
            <path key={d} d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {real.map((p, i) => (
            <circle
              key={i}
              className="chart-dot"
              cx={x(p.x)}
              cy={y(p.y)}
              r={hover === i ? 5.5 : 4}
              fill={p.highlight ? "var(--surface)" : color}
              stroke={p.highlight ? color : "var(--surface)"}
              strokeWidth={p.highlight ? 2.5 : 2}
            />
          ))}
          {last && hover === null && (
            <text
              className="chart-value"
              x={Math.min(x(last.x), width - M.right)}
              y={y(last.y) - 10}
              textAnchor={x(last.x) > width - 60 ? "end" : "middle"}
            >
              {format(last.y)}
            </text>
          )}
        </svg>
      )}
      {h && (
        <Tooltip x={x(h.x)} width={width}>
          {h.tip}
        </Tooltip>
      )}
    </div>
  );
}
