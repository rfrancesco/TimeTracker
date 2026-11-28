import { IonIcon, IonRippleEffect } from '@ionic/react';
import { iconFor } from '../icons';
import { useDarkMode, type AreaView } from '../hooks';
import { readableOn, surfaceOver, themeBackground } from '../color';

interface Props {
  areas: AreaView[];
  selectedId?: string | null;
  onSelect: (area: AreaView) => void;
  /** The colour behind the selector (e.g. the tinted Timer page); defaults to the theme background. */
  background?: string;
  /** Press-and-hold support (Timer page): called on press, and on release/cancel. */
  onPressStart?: (area: AreaView) => void;
  onPressEnd?: () => void;
}

/** Split areas into rows at each area marked `breakAfter`. */
function toRows(areas: AreaView[]) {
  const rows: AreaView[][] = [[]];
  areas.forEach((a, i) => {
    rows[rows.length - 1].push(a);
    if (a.breakAfter && i < areas.length - 1) rows.push([]);
  });
  return rows;
}

/**
 * Icon-only area selector; one pill per row. Each icon keeps its area colour
 * when that reads on the surface behind it, and is adjusted for contrast when
 * it doesn't (e.g. a dark icon on a page tinted by another dark area).
 */
export default function AreaPill({ areas, selectedId, onSelect, background, onPressStart, onPressEnd }: Props) {
  const dark = useDarkMode();
  const surface = surfaceOver(background ?? themeBackground(dark));
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
                className={`area-pill-btn ion-activatable${selected ? ' selected' : ''}${a.archived ? ' archived' : ''}`}
                style={{
                  ['--area-color' as string]: a.color,
                  ['--icon-color' as string]: selected ? a.onColor : readableOn(a.color, surface),
                }}
                onClick={() => onSelect(a)}
                onPointerDown={onPressStart && (() => onPressStart(a))}
                onPointerUp={onPressEnd}
                onPointerLeave={onPressEnd}
                onPointerCancel={onPressEnd}
                onContextMenu={onPressStart && ((e) => e.preventDefault())}
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
