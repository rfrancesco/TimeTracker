import { useEffect, useState } from 'react';
import {
  IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonInput, IonItem, IonList, IonListHeader,
  IonModal, IonText, IonTextarea, IonTitle, IonToolbar, useIonAlert,
} from '@ionic/react';
import { close, trashOutline } from 'ionicons/icons';
import AreaPill from './AreaPill';
import SubAreaChips from './SubAreaChips';
import { db } from '../db';
import { ConstraintError, OverlapError, describeConflicts, saveInterval, updateActive } from '../constraints';
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
  const now = Date.now();
  const problem = !v
    ? 'missing'
    : Number.isNaN(v.start) || (!isActive && Number.isNaN(v.end))
      ? 'Enter a valid time'
      : isActive
        ? v.start > now
          ? 'Start must be in the past'
          : null
        : v.end <= v.start
          ? 'End must be after start'
          : v.end > now
            ? 'Can’t record time in the future'
            : null;
  const valid = problem === null;
  const area = areas.find((a) => a.id === v?.areaId);
  const subs = subAreas.filter((s) => s.areaId === v?.areaId && !s.archived);

  async function save(overwrite = false) {
    if (!v || !valid) return;
    try {
      if (v.kind === 'active') {
        await updateActive({ start: v.start, areaId: v.areaId, subAreaId: v.subAreaId }, { overwrite });
      } else {
        await saveInterval(
          { id: v.kind === 'existing' ? v.id : undefined, areaId: v.areaId, subAreaId: v.subAreaId, start: v.start, end: v.end, note: v.note },
          { overwrite },
        );
      }
      onClose();
    } catch (err) {
      if (err instanceof OverlapError) {
        const nameOf = (id: string) => areas.find((a) => a.id === id)?.name ?? 'Deleted area';
        presentAlert({
          header: 'Overlaps existing time',
          message: describeConflicts(err, nameOf).join('\n'),
          cssClass: 'pre-line-alert',
          buttons: [
            { text: 'Cancel', role: 'cancel' },
            { text: 'Replace that time', role: 'destructive', handler: () => void save(true) },
          ],
        });
      } else if (err instanceof ConstraintError) {
        presentAlert({ header: 'Can’t save', message: err.message, buttons: ['OK'] });
      } else throw err;
    }
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
            <IonButton strong disabled={!valid} onClick={() => save()}>Save</IonButton>
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
                    {valid ? `Duration: ${formatDuration((isActive ? now : v.end) - v.start, false)}` : problem}
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
