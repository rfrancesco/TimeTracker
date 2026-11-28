import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { IonButton, IonContent, IonInput, IonItem, IonList, IonModal, IonRadio, IonRadioGroup } from '@ionic/react';
import { db } from '../db';
import { deleteDeletedTime, deletedTime, deleteTimeBetween } from '../archive';
import { formatDuration } from '../timer';
import { addLocalDays, localDateKey, startOfLocalDay } from '../time';

type Mode = 'before' | 'between' | 'deleted';

/** "Delete tracked time…": a range of whole local days, or the time kept as "Deleted". */
export default function CleanupDialog({ open, onClose, onExport, onDone }: { open: boolean; onClose: () => void; onExport: () => void; onDone: (msg: string) => void }) {
  const today = localDateKey(Date.now());
  const [mode, setMode] = useState<Mode>('before');
  const [before, setBefore] = useState(today);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  useEffect(() => {
    if (open) setMode('before');
  }, [open]);

  // [start, end) in ms: "before" = everything before that day; "between" = both days included.
  const dayStart = (key: string) => startOfLocalDay(new Date(`${key}T12:00`)).getTime();
  const range: [number, number] | null =
    mode === 'before' ? [-Infinity, dayStart(before)] : mode === 'between' && from <= to ? [dayStart(from), addLocalDays(dayStart(to), 1).getTime()] : null;

  // What would go: intervals touching the range, counted as the part inside it.
  const preview = useLiveQuery(async () => {
    if (mode === 'deleted') {
      const list = await deletedTime();
      return { count: list.length, ms: list.reduce((s, i) => s + Date.parse(i.end) - Date.parse(i.start), 0) };
    }
    if (!range) return { count: 0, ms: 0 };
    const [s, e] = range;
    const list = (await db.intervals.where('start').below(new Date(Math.min(e, 8.64e15)).toISOString()).toArray()).filter((i) => Date.parse(i.end) > s);
    return { count: list.length, ms: list.reduce((sum, i) => sum + Math.min(Date.parse(i.end), e) - Math.max(Date.parse(i.start), s), 0) };
  }, [mode, before, from, to]);
  const deletedTotal = useLiveQuery(async () => (await deletedTime()).length) ?? 0;

  const summary = preview?.count ? `${preview.count} interval${preview.count === 1 ? '' : 's'} · ${formatDuration(preview.ms, false)}` : 'Nothing to delete';

  return (
    <IonModal isOpen={open} onDidDismiss={onClose} initialBreakpoint={0.75} breakpoints={[0, 0.75, 1]} className="stop-sheet cleanup-sheet">
      <IonContent className="ion-padding">
        <h2 className="sheet-title">Delete tracked time</h2>
        <IonList>
          {/* The date fields' own change events bubble up here: only take the radios' own. */}
          <IonRadioGroup value={mode} onIonChange={(e) => e.target === e.currentTarget && setMode(e.detail.value)}>
            <IonItem lines="none">
              <IonRadio value="before" justify="start" labelPlacement="end">Everything before a day</IonRadio>
            </IonItem>
            {mode === 'before' && (
              <IonItem lines="none" className="cleanup-dates">
                <IonInput type="date" aria-label="Before" value={before} max={today} onIonInput={(e) => e.detail.value && setBefore(String(e.detail.value))} />
              </IonItem>
            )}
            <IonItem lines="none">
              <IonRadio value="between" justify="start" labelPlacement="end">From one day to another</IonRadio>
            </IonItem>
            {mode === 'between' && (
              <IonItem lines="none" className="cleanup-dates">
                <IonInput type="date" aria-label="From" value={from} max={today} onIonInput={(e) => e.detail.value && setFrom(String(e.detail.value))} />
                <span className="cleanup-to">to</span>
                <IonInput type="date" aria-label="To" value={to} max={today} onIonInput={(e) => e.detail.value && setTo(String(e.detail.value))} />
              </IonItem>
            )}
            {deletedTotal > 0 && (
              <IonItem lines="none">
                <IonRadio value="deleted" justify="start" labelPlacement="end">Time kept as “Deleted”</IonRadio>
              </IonItem>
            )}
          </IonRadioGroup>
        </IonList>
        <p className="sheet-hint">
          {mode !== 'deleted' && 'Intervals crossing the edge are cut there; the running timer is never touched. '}
          This can’t be undone.{' '}
          <a href="#" onClick={(e) => (e.preventDefault(), onExport())}>
            Export a backup first
          </a>
        </p>
        <p className={`sheet-hint cleanup-summary${preview?.count ? ' error' : ''}`}>{mode === 'between' && from > to ? 'The first day is after the last' : summary}</p>
        <IonButton
          expand="block"
          shape="round"
          size="large"
          color="danger"
          className="sheet-apply"
          disabled={!preview?.count}
          onClick={async () => {
            const what = summary;
            if (mode === 'deleted') await deleteDeletedTime();
            else if (range) await deleteTimeBetween(range[0], range[1]);
            onClose();
            onDone(`Deleted ${what}`);
          }}
        >
          Delete
        </IonButton>
      </IonContent>
    </IonModal>
  );
}
