import { useEffect, useRef, useState } from 'react';

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
}

const H = 170; // plot height
const AXIS_W = 30;
const X_BAND = 20;
const GAP = 2;
const HOUR = 3_600_000;

function niceTop(maxMs: number) {
  const h = Math.max(1, maxMs / HOUR);
  const step = [1, 2, 4, 6, 8, 12].find((s) => h / s <= 4) ?? 12;
  return { top: Math.ceil(h / step) * step, step };
}

/** Stacked column per day (hours), stacked in a fixed series order. */
export default function DayBars({ days, perDay, series, now, selected, onSelect, compactLabels }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const totals = perDay.map((m) => [...m.values()].reduce((a, b) => a + b, 0));
  const { top, step } = niceTop(Math.max(0, ...totals));
  const plotW = width - AXIS_W;
  const slot = plotW / days.length;
  const barW = Math.min(slot * 0.64, 28);
  const y = (ms: number) => H - (ms / HOUR / top) * H;
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);

  return (
    <div ref={ref} className="day-bars">
      <svg width={width} height={H + X_BAND + 8} role="img" aria-label="Tracked hours per day">
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
            let acc = 0;
            const segs = series
              .map((s) => ({ s, ms: perDay[i].get(s.id) ?? 0 }))
              .filter((x) => x.ms > 0)
              .map(({ s, ms }) => {
                const y1 = y(acc);
                acc += ms;
                const y0 = y(acc);
                const h = y1 - y0;
                return { id: s.id, color: s.color, y: y0, h: h > GAP + 1 ? h - GAP : h };
              });
            const showLabel = !compactLabels || i === 0 || (i + 1) % 5 === 0;
            const date = new Date(d);
            const label = compactLabels
              ? String(date.getDate())
              : date.toLocaleDateString([], { weekday: 'narrow' });
            const dim = selected !== null && selected !== i;
            return (
              <g key={d} className={dim ? 'dimmed' : undefined}>
                <clipPath id={`colclip-${i}`}>
                  {/* rounded top only: the rect extends below the baseline */}
                  <rect x={x} y={y(acc)} width={barW} height={H - y(acc) + 6} rx={4} />
                </clipPath>
                <g clipPath={`url(#colclip-${i})`}>
                  {segs.map((g) => (
                    <rect key={g.id} x={x} y={g.y} width={barW} height={g.h} fill={g.color} />
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
