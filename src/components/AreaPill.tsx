import { IonIcon, IonRippleEffect } from '@ionic/react';
import type { Area } from '../db';
import { iconFor } from '../icons';

interface Props {
  areas: Area[];
  selectedId?: string | null;
  onSelect: (area: Area) => void;
}

/** Split areas into rows at each area marked `breakAfter`. */
function toRows(areas: Area[]) {
  const rows: Area[][] = [[]];
  areas.forEach((a, i) => {
    rows[rows.length - 1].push(a);
    if (a.breakAfter && i < areas.length - 1) rows.push([]);
  });
  return rows;
}

/** Icon-only pill-shaped area selector; one pill per row. */
export default function AreaPill({ areas, selectedId, onSelect }: Props) {
  return (
    <div className="area-pills" role="radiogroup">
      {toRows(areas).map((row, r) => (
        <div key={r} className="area-pill">
          {row.map((a) => {
            const selected = a.id === selectedId;
            return (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={a.name}
                title={a.name}
                className={`area-pill-btn ion-activatable${selected ? ' selected' : ''}`}
                style={{ ['--area-color' as string]: a.color }}
                onClick={() => onSelect(a)}
              >
                <IonIcon icon={iconFor(a.icon)} />
                <IonRippleEffect type="unbounded" />
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
