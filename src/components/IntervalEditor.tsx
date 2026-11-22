import { useEffect, useState } from 'react';
import {
  IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonItem, IonList, IonListHeader,
  IonModal, IonText, IonTextarea, IonTitle, IonToolbar, useIonAlert,
} from '@ionic/react';
import { close, trashOutline } from 'ionicons/icons';
import AreaPill from './AreaPill';
import SubAreaChips from './SubAreaChips';
import { db } from '../db';
import { ConstraintError, OverlapError, describeConflicts, saveInterval, updateActive } from '../constraints';
import { useEditUndo } from '../editUndo';
import { useAreas, useSubAreas } from '../hooks';
import { formatDuration } from '../timer';
import DateTimeField from './DateTimeField';

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

export default function IntervalEditor({ value, onClose }: Props) {
  const areas = useAreas();
  const subAreas = useSubAreas();
  const [v, setV] = useState<EditorValue | null>(value);
  const editUndo = useEditUndo();
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
    const name = area?.name ?? 'interval';
    // The earliest moment the save can touch: the old and the new start.
    const from = Math.min(v.start, value?.start ?? v.start);
    try {
      if (v.kind === 'active') {
        await editUndo.run(`Changed ${name}`, from, () =>
          updateActive({ start: v.start, areaId: v.areaId, subAreaId: v.subAreaId }, { overwrite }),
        );
      } else {
        await editUndo.run(v.kind === 'existing' ? `Saved ${name}` : `Added ${name}`, from, () =>
          saveInterval(
            { id: v.kind === 'existing' ? v.id : undefined, areaId: v.areaId, subAreaId: v.subAreaId, start: v.start, end: v.end, note: v.note },
            { overwrite },
          ),
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
      message: isActive ? 'The current timer will be dropped without saving.' : 'You can undo it right after.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: isActive ? 'Discard' : 'Delete',
          role: 'destructive',
          handler: async () => {
            const name = area?.name ?? 'interval';
            const from = value?.start ?? v.start;
            if (isActive) await editUndo.run(`Discarded ${name}`, from, () => db.active.delete('current'));
            else if (v.id) await editUndo.run(`Deleted ${name}`, from, () => db.intervals.delete(v.id!));
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
            <div className="ion-padding-horizontal editor-areas">
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
              <DateTimeField
                label="Start"
                value={v.start}
                onChange={(ms, part) =>
                  // Moving the start to another day takes the end along (same duration);
                  // changing only the time leaves the end where it is.
                  setV({ ...v, start: ms, end: part === 'date' && !isActive ? v.end + (ms - v.start) : v.end })
                }
              />
              {!isActive && <DateTimeField label="End" value={v.end} onChange={(ms) => setV({ ...v, end: ms })} />}
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
