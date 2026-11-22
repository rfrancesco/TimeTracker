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
}

export default function SubAreaChips({ subAreas, selectedId, color, onSelect, allowNone, onPressStart, onPressEnd }: Props) {
  if (!subAreas.length) return null;
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
      {allowNone && (
        <IonChip className={selectedId === null ? 'selected' : ''} onClick={() => onSelect(null)} {...press(null)}>
          <IonLabel>None</IonLabel>
        </IonChip>
      )}
      {subAreas.map((s) => (
        <IonChip key={s.id} className={s.id === selectedId ? 'selected' : ''} onClick={() => onSelect(s.id)} {...press(s.id)}>
          <IonLabel>{s.name}</IonLabel>
        </IonChip>
      ))}
    </div>
  );
}
