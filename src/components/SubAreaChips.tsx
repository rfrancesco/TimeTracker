import { IonChip, IonLabel } from '@ionic/react';
import type { SubArea } from '../db';

interface Props {
  subAreas: SubArea[];
  selectedId: string | null;
  color: string;
  onSelect: (id: string | null) => void;
  allowNone?: boolean;
}

export default function SubAreaChips({ subAreas, selectedId, color, onSelect, allowNone }: Props) {
  if (!subAreas.length) return null;
  return (
    <div className="sub-chips" style={{ ['--area-color' as string]: color }}>
      {allowNone && (
        <IonChip className={selectedId === null ? 'selected' : ''} onClick={() => onSelect(null)}>
          <IonLabel>None</IonLabel>
        </IonChip>
      )}
      {subAreas.map((s) => (
        <IonChip key={s.id} className={s.id === selectedId ? 'selected' : ''} onClick={() => onSelect(s.id)}>
          <IonLabel>{s.name}</IonLabel>
        </IonChip>
      ))}
    </div>
  );
}
