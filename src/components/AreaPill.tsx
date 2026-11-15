import { IonIcon, IonRippleEffect } from '@ionic/react';
import type { Area } from '../db';
import { iconFor } from '../icons';

interface Props {
  areas: Area[];
  selectedId?: string | null;
  onSelect: (area: Area) => void;
}

/** Icon-only pill-shaped area selector. */
export default function AreaPill({ areas, selectedId, onSelect }: Props) {
  return (
    <div className="area-pill" role="radiogroup">
      {areas.map((a) => {
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
  );
}
