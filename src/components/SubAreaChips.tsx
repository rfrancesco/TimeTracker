import { IonChip, IonLabel } from '@ionic/react';
import type { SubArea } from '../db';
import { onColor } from '../color';

interface Props {
  subAreas: SubArea[];
  selectedId: string | null;
  color: string;
  onSelect: (id: string | null) => void;
  allowNone?: boolean;
  /** Hold support (Timer: hold a sub-area = "switch earlier"). */
  onPressStart?: (id: string | null) => void;
  onPressEnd?: () => void;
  /** Shown after the chips (Timer: the Note chip); the row then shows even without sub-areas. */
  extra?: React.ReactNode;
}

export default function SubAreaChips({ subAreas, selectedId, color, onSelect, allowNone, onPressStart, onPressEnd, extra }: Props) {
  if (!subAreas.length && !extra) return null;
  const press = (id: string | null) =>
    onPressStart && {
      onPointerDown: () => onPressStart(id),
      onPointerUp: onPressEnd,
      onPointerLeave: onPressEnd,
      onPointerCancel: onPressEnd,
      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    };
  return (
    <div className="sub-chips" style={{ ['--area-color' as string]: color, ['--on-area' as string]: onColor(color) }}>
      {allowNone && subAreas.length > 0 && (
        <IonChip className={selectedId === null ? 'selected' : ''} onClick={() => onSelect(null)} {...press(null)}>
          <IonLabel>None</IonLabel>
        </IonChip>
      )}
      {subAreas.map((s) => (
        <IonChip key={s.id} className={`${s.id === selectedId ? 'selected' : ''}${s.archived ? ' archived' : ''}`} onClick={() => onSelect(s.id)} {...press(s.id)}>
          <IonLabel>{s.name}</IonLabel>
        </IonChip>
      ))}
      {extra}
    </div>
  );
}
