import { useEffect, useState } from 'react';
import {
  IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonInput, IonItem, IonList, IonListHeader,
  IonModal, IonText, IonTextarea, IonTitle, IonToolbar, useIonAlert,
} from '@ionic/react';
import { close, trashOutline } from 'ionicons/icons';
import AreaPill from './AreaPill';
import SubAreaChips from './SubAreaChips';
import { db, nowIso, uuid } from '../db';
import { useAreas, useSubAreas } from '../hooks';
import { formatDuration } from '../timer';

export interface EditorValue {
  kind: 'new' | 'existing' | 'active';
  id?: string;
  areaId: string;
  subAreaId: string | null;
  start: number; // epoch ms
  end: number; // epoch ms (ignored for 'active')
  note?: string;
}

interface Props {
  value: EditorValue | null;
  onClose: () => void;
}

/** epoch ms → "YYYY-MM-DDTHH:mm" in local time, for <input type="datetime-local">. */
const toLocalInput = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocalInput = (s: string) => new Date(s).getTime(); // parsed as local time

export default function IntervalEditor({ value, onClose }: Props) {
  const areas = useAreas();
  const subAreas = useSubAreas();
  const [v, setV] = useState<EditorValue | null>(value);
  const [presentAlert] = useIonAlert();

  useEffect(() => {
    if (value) setV(value);
  }, [value]);

  const isActive = v?.kind === 'active';
  const valid = !!v && !Number.isNaN(v.start) && (isActive ? v.start <= Date.now() : !Number.isNaN(v.end) && v.end > v.start);
  const area = areas.find((a) => a.id === v?.areaId);
  const subs = subAreas.filter((s) => s.areaId === v?.areaId && !s.archived);

  async function save() {
    if (!v || !valid) return;
    const t = nowIso();
    const start = new Date(v.start).toISOString();
    const end = new Date(v.end).toISOString();
    if (v.kind === 'new') {
      await db.intervals.add({ id: uuid(), areaId: v.areaId, subAreaId: v.subAreaId, start, end, note: v.note, updatedAt: t });
    } else if (v.kind === 'existing' && v.id) {
      await db.intervals.update(v.id, { areaId: v.areaId, subAreaId: v.subAreaId, start, end, note: v.note, updatedAt: t });
    } else if (v.kind === 'active') {
      await db.active.put({ key: 'current', areaId: v.areaId, subAreaId: v.subAreaId, start });
    }
    onClose();
  }

  function remove() {
    if (!v) return;
    presentAlert({
      header: isActive ? 'Discard running timer?' : 'Delete interval?',
      message: isActive ? 'The current timer will be dropped without saving.' : 'This cannot be undone.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: isActive ? 'Discard' : 'Delete',
          role: 'destructive',
          handler: async () => {
            if (isActive) await db.active.delete('current');
            else if (v.id) await db.intervals.delete(v.id);
            onClose();
          },
        },
      ],
    });
  }

  const title = v?.kind === 'new' ? 'New interval' : isActive ? 'Running timer' : 'Edit interval';

  return (
    <IonModal isOpen={!!value} onDidDismiss={onClose}>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={onClose} aria-label="Close">
              <IonIcon slot="icon-only" icon={close} />
            </IonButton>
          </IonButtons>
          <IonTitle>{title}</IonTitle>
          <IonButtons slot="end">
            <IonButton strong disabled={!valid} onClick={save}>Save</IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        {v && (
          <>
            <IonListHeader>Area{area ? ` · ${area.name}` : ''}</IonListHeader>
            <div className="ion-padding-horizontal">
              <AreaPill areas={areas} selectedId={v.areaId} onSelect={(a) => setV({ ...v, areaId: a.id, subAreaId: null })} />
              {area && (
                <SubAreaChips
                  subAreas={subs}
                  selectedId={v.subAreaId}
                  color={area.color}
                  allowNone
                  onSelect={(id) => setV({ ...v, subAreaId: id })}
                />
              )}
            </div>

            <IonList inset={false}>
              <IonListHeader>Time</IonListHeader>
              <IonItem>
                <IonInput
                  label="Start"
                  labelPlacement="stacked"
                  type="datetime-local"
                  value={toLocalInput(v.start)}
                  onIonInput={(e) => setV({ ...v, start: fromLocalInput(String(e.detail.value)) })}
                />
              </IonItem>
              {!isActive && (
                <IonItem>
                  <IonInput
                    label="End"
                    labelPlacement="stacked"
                    type="datetime-local"
                    value={toLocalInput(v.end)}
                    onIonInput={(e) => setV({ ...v, end: fromLocalInput(String(e.detail.value)) })}
                  />
                </IonItem>
              )}
              <IonItem lines="none">
                <IonText color={valid ? 'medium' : 'danger'}>
                  <p className="duration-hint">
                    {valid
                      ? `Duration: ${formatDuration((isActive ? Date.now() : v.end) - v.start, false)}`
                      : isActive
                        ? 'Start must be in the past'
                        : 'End must be after start'}
                  </p>
                </IonText>
              </IonItem>
              {!isActive && (
                <IonItem>
                  <IonTextarea
                    label="Note"
                    labelPlacement="stacked"
                    autoGrow
                    value={v.note ?? ''}
                    onIonInput={(e) => setV({ ...v, note: e.detail.value ?? '' })}
                  />
                </IonItem>
              )}
            </IonList>

            {v.kind !== 'new' && (
              <div className="ion-padding">
                <IonButton expand="block" fill="outline" color="danger" onClick={remove}>
                  <IonIcon slot="start" icon={trashOutline} />
                  {isActive ? 'Discard timer' : 'Delete interval'}
                </IonButton>
              </div>
            )}
          </>
        )}
      </IonContent>
    </IonModal>
  );
}
