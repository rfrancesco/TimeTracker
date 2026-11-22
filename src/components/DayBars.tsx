import { useEffect, useId, useRef, useState } from 'react';
import { HATCH, HatchDefs } from './Donut';
import type { Rest } from '../report';
import { HOUR } from '../time';

export interface BarSeries {
  id: string;
  color: string;
}

interface Props {
  days: number[]; // local midnights
  perDay: Map<string, number>[]; // ms per series id
  series: BarSeries[]; // stacking order, bottom first
  now: number;
  selected: number | null; // index
  onSelect: (index: number | null) => void;
  compactLabels: boolean; // month view: label every few days
  /**
   * Full-period mode: each day is drawn at its whole length (24 h, or 23/25 h on
   * DST days): before-tracking at the bottom, then the areas, untracked, and the
   * part still to come at the top. Without it, only tracked time is drawn.
   */
  rest?: Rest[];
}

const H = 170; // plot height
const AXIS_W = 30;
const X_BAND = 20;
const GAP = 2;

function niceTop(maxMs: number) {
  const h = Math.max(1, maxMs / HOUR);
  const step = [1, 2, 4, 6, 8, 12].find((s) => h / s <= 4) ?? 12;
  return { top: Math.ceil(h / step) * step, step };
}

/** Stacked column per day (hours), stacked in a fixed order. */
export default function DayBars({ days, perDay, series, now, selected, onSelect, compactLabels, rest }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const hatchId = `bars-hatch-${useId().replace(/:/g, '')}`;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tracked = perDay.map((m) => [...m.values()].reduce((a, b) => a + b, 0));
  const { top, step } = niceTop(rest ? Math.max(...rest.map((r) => r.length)) : Math.max(0, ...tracked));
  const plotW = width - AXIS_W;
  const slot = plotW / days.length;
  const barW = Math.min(slot * 0.64, 28);
  const y = (ms: number) => H - (ms / HOUR / top) * H;
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);

  return (
    <div ref={ref} className="day-bars">
      <svg width={width} height={H + X_BAND + 8} role="img" aria-label="Hours per day">
        <HatchDefs id={hatchId} />
        <g transform="translate(0,4)">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={AXIS_W} x2={width} y1={y(t * HOUR)} y2={y(t * HOUR)} className="grid" />
              <text x={AXIS_W - 6} y={y(t * HOUR)} className="tick" textAnchor="end" dominantBaseline="middle">
                {t}h
              </text>
            </g>
          ))}
          {days.map((d, i) => {
            const cx = AXIS_W + slot * i + slot / 2;
            const x = cx - barW / 2;
            const future = d > now;
            const isToday = d <= now && now < (days[i + 1] ?? d + 25 * HOUR);
            const r = rest?.[i];
            // Bottom-up stack: before tracking, areas, untracked, still to come.
            const parts: Array<{ id: string; color: string; ms: number }> = [
              ...(r ? [{ id: '__nodata', color: `url(#${hatchId})`, ms: r.noData }] : []),
              ...series.map((s) => ({ id: s.id, color: s.color, ms: perDay[i].get(s.id) ?? 0 })),
              ...(r
                ? [
                    { id: '__untracked', color: 'var(--viz-untracked)', ms: r.untracked },
                    { id: '__upcoming', color: 'var(--viz-upcoming)', ms: r.upcoming },
                  ]
                : []),
            ].filter((p) => p.ms > 0);
            let acc = 0;
            const segs = parts.map((p) => {
              const y1 = y(acc);
              acc += p.ms;
              const y0 = y(acc);
              const h = y1 - y0;
              return { ...p, y: y0, h: h > GAP + 1 ? h - GAP : h };
            });
            const showLabel = !compactLabels || i === 0 || (i + 1) % 5 === 0;
            const date = new Date(d);
            const label = compactLabels ? String(date.getDate()) : date.toLocaleDateString([], { weekday: 'narrow' });
            const dim = selected !== null && selected !== i;
            return (
              <g key={d} className={dim ? 'dimmed' : undefined}>
                <clipPath id={`colclip-${hatchId}-${i}`}>
                  {/* rounded top only: the rect extends below the baseline */}
                  <rect x={x} y={y(acc)} width={barW} height={H - y(acc) + 6} rx={4} />
                </clipPath>
                <g clipPath={`url(#colclip-${hatchId}-${i})`}>
                  {segs.map((g) => (
                    <rect key={g.id} x={x} y={g.y} width={barW} height={g.h} fill={g.color === HATCH ? `url(#${hatchId})` : g.color} />
                  ))}
                </g>
                {showLabel && (
                  <text x={cx} y={H + 15} className={`tick${isToday ? ' today' : ''}`} textAnchor="middle">
                    {label}
                  </text>
                )}
                {!future && (
                  <rect
                    x={AXIS_W + slot * i}
                    y={0}
                    width={slot}
                    height={H + X_BAND}
                    fill="transparent"
                    className="hit"
                    onClick={() => onSelect(selected === i ? null : i)}
                  />
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
