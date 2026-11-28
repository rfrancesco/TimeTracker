import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { IonButton, IonContent, IonItem, IonLabel, IonList, IonModal, IonRadio, IonRadioGroup, IonText } from '@ionic/react';
import AreaPill from './AreaPill';
import SubAreaChips from './SubAreaChips';
import { deletePermanently, usage, type Destination, type Target } from '../archive';
import { useAreas, useSubAreas } from '../hooks';
import { formatDuration } from '../timer';

interface Props {
  /** What to delete (null = closed), with its display name ("Gym", "Guitar · Scales"). */
  target: (Target & { name: string }) | null;
  onClose: () => void;
  onExport: () => void;
}

type Choice = Destination['kind'];

/** Permanently delete an archived area or sub-area, choosing where its time goes. */
export default function DeleteDialog({ target, onClose, onExport }: Props) {
  const areas = useAreas();
  const subAreas = useSubAreas();
  const [choice, setChoice] = useState<Choice>('deleted');
  const [mergeArea, setMergeArea] = useState<string | null>(null);
  const [mergeSub, setMergeSub] = useState<string | null>(null);
  const info = useLiveQuery(() => (target ? usage(target) : undefined), [target?.kind, target?.id]);
  useEffect(() => {
    if (!target) return;
    setChoice('deleted');
    setMergeArea(null);
    setMergeSub(null);
  }, [target]);

  const sub = target?.kind === 'sub' ? subAreas.find((s) => s.id === target.id) : undefined;
  const parent = sub ? areas.find((a) => a.id === sub.areaId) : undefined;
  const parentName = parent?.name ?? target?.name.split(' · ')[0] ?? '';
  // Merge targets: any area in the pickers (not the one being deleted), and its sub-areas.
  const mergeAreas = areas.filter((a) => target?.kind !== 'area' || a.id !== target.id);
  const mergeAreaView = areas.find((a) => a.id === mergeArea);
  const mergeSubs = subAreas.filter((s) => s.areaId === mergeArea && !s.archived && s.id !== target?.id);
  const mergeName = mergeAreaView ? `${mergeAreaView.name}${mergeSub ? ` · ${subAreas.find((s) => s.id === mergeSub)?.name}` : ''}` : '';

  const options: Array<{ value: Choice; label: string; danger?: boolean }> = [
    { value: 'deleted', label: 'Keep the time, as “Deleted”' },
    ...(target?.kind === 'sub' ? [{ value: 'plain' as const, label: `Keep the time in ${parentName}, without a sub-area` }] : []),
    { value: 'merge', label: 'Move the time to another area' },
    { value: 'drop', label: 'Delete the time too', danger: true },
  ];

  const destination: Destination | null =
    choice === 'merge' ? (mergeArea ? { kind: 'merge', areaId: mergeArea, subAreaId: mergeSub } : null) : ({ kind: choice } as Destination);
  const runningNote = info?.running
    ? {
        deleted: `${target?.name} is running: the timer stops now and its time is kept as “Deleted”.`,
        plain: `${target?.name} is running: the timer continues as ${parentName}.`,
        merge: `${target?.name} is running: the timer continues as ${mergeName || 'the area you pick'}.`,
        drop: `${target?.name} is running: the timer is discarded.`,
      }[choice]
    : null;

  return (
    <IonModal isOpen={!!target} onDidDismiss={onClose} initialBreakpoint={0.75} breakpoints={[0, 0.75, 1]} className="stop-sheet delete-sheet">
      <IonContent className="ion-padding">
        {target && (
          <>
            <h2 className="sheet-title">Delete “{target.name}” permanently?</h2>
            <p className="sheet-hint">
              {info && (info.count ? `${info.count} interval${info.count === 1 ? '' : 's'} · ${formatDuration(info.ms, false)} of tracked time.` : 'No tracked time.')}{' '}
              This can’t be undone.{' '}
              <a href="#" onClick={(e) => (e.preventDefault(), onExport())}>
                Export a backup first
              </a>
            </p>
            <IonList>
              <IonRadioGroup value={choice} onIonChange={(e) => e.target === e.currentTarget && setChoice(e.detail.value)}>
                {options.map((o) => (
                  <IonItem key={o.value} lines="none">
                    <IonRadio value={o.value} justify="start" labelPlacement="end" color={o.danger ? 'danger' : undefined}>
                      {o.danger ? <IonText color="danger">{o.label}</IonText> : o.label}
                    </IonRadio>
                  </IonItem>
                ))}
              </IonRadioGroup>
            </IonList>
            {choice === 'merge' && (
              <div className="merge-picker">
                <AreaPill
                  areas={mergeAreas}
                  selectedId={mergeArea}
                  onSelect={(a) => {
                    setMergeArea(a.id);
                    setMergeSub(null);
                  }}
                />
                {mergeAreaView && <SubAreaChips subAreas={mergeSubs} selectedId={mergeSub} color={mergeAreaView.color} allowNone onSelect={setMergeSub} />}
                <IonLabel color="medium" className="merge-target">
                  {mergeName ? `Moves to ${mergeName}` : 'Pick where the time goes'}
                </IonLabel>
              </div>
            )}
            {runningNote && <p className="sheet-hint">{runningNote}</p>}
            <IonButton
              expand="block"
              shape="round"
              size="large"
              color="danger"
              className="sheet-apply"
              disabled={!destination}
              onClick={async () => {
                if (!destination) return;
                await deletePermanently(target, destination);
                onClose();
              }}
            >
              Delete permanently
            </IonButton>
          </>
        )}
      </IonContent>
    </IonModal>
  );
}
