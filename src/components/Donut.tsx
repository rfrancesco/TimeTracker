export interface Slice {
  id: string;
  label: string;
  color: string; // any CSS colour, including var(...)
  value: number;
}

interface Props {
  slices: Slice[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  center: { value: string; caption: string };
  ariaLabel: string;
}

const C = 100;
const R = 90;
const r = 62;
const GAP = 2; // px of surface between slices, constant width at both radii

const pt = (radius: number, a: number) => `${C + radius * Math.cos(a)} ${C + radius * Math.sin(a)}`;

function arcPath(a0: number, a1: number, outer: number) {
  const go = GAP / outer / 2;
  const gi = GAP / r / 2;
  const o0 = a0 + go;
  const o1 = a1 - go;
  const i0 = a0 + gi;
  const i1 = a1 - gi;
  if (o1 <= o0 || i1 <= i0) return null;
  const large = o1 - o0 > Math.PI ? 1 : 0;
  const largeI = i1 - i0 > Math.PI ? 1 : 0;
  return `M${pt(outer, o0)} A${outer} ${outer} 0 ${large} 1 ${pt(outer, o1)} L${pt(r, i1)} A${r} ${r} 0 ${largeI} 0 ${pt(r, i0)} Z`;
}

/** Donut chart; tap a slice to select it (tap again or the hole to clear). */
export default function Donut({ slices, selectedId, onSelect, center, ariaLabel }: Props) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  let a = -Math.PI / 2;
  const visible = slices.filter((s) => s.value > 0);

  return (
    <div className="donut">
      <svg viewBox="0 0 200 200" role="img" aria-label={ariaLabel}>
        <circle cx={C} cy={C} r={r - 1} fill="transparent" onClick={() => onSelect(null)} />
        {visible.length === 1 ? (
          <circle
            cx={C}
            cy={C}
            r={(R + r) / 2}
            fill="none"
            stroke={visible[0].color}
            strokeWidth={R - r}
            className="donut-slice"
            onClick={() => onSelect(selectedId === visible[0].id ? null : visible[0].id)}
          >
            <title>{visible[0].label}</title>
          </circle>
        ) : (
          visible.map((s) => {
            const a0 = a;
            const a1 = a + (s.value / total) * Math.PI * 2;
            a = a1;
            const selected = s.id === selectedId;
            const d = arcPath(a0, a1, selected ? R + 6 : R);
            if (!d) return null;
            return (
              <path
                key={s.id}
                d={d}
                fill={s.color}
                className={`donut-slice${selectedId && !selected ? ' dimmed' : ''}`}
                onClick={() => onSelect(selected ? null : s.id)}
              >
                <title>{s.label}</title>
              </path>
            );
          })
        )}
      </svg>
      <div className="donut-center" aria-hidden>
        <div className="donut-value">{center.value}</div>
        <div className="donut-caption">{center.caption}</div>
      </div>
    </div>
  );
}
