import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonModal, IonNote, IonTitle, IonToolbar,
  useIonActionSheet,
} from '@ionic/react';
import { close, ellipsisVertical, trashOutline } from 'ionicons/icons';
import DeleteDialog from './DeleteDialog';
import { db } from '../db';
import { useAreas } from '../hooks';
import { iconFor } from '../icons';
import { restore, type Target } from '../archive';
import { formatDuration } from '../timer';

/** Archived areas and sub-areas: restore them, or delete them permanently. */
export default function ArchivedPage({ open, onClose, onExport }: { open: boolean; onClose: () => void; onExport: () => void }) {
  const areas = useAreas(true);
  const [deleting, setDeleting] = useState<(Target & { name: string }) | null>(null);
  const [presentSheet] = useIonActionSheet();
  // Each archived item with its tracked time; built-in "Deleted" ones are not listed.
  const items =
    useLiveQuery(async () => {
      const all = await db.areas.toArray();
      const subs = await db.subAreas.toArray();
      const intervals = await db.intervals.toArray();
      const stat = (match: (i: (typeof intervals)[number]) => boolean) => {
        const list = intervals.filter(match);
        return { ms: list.reduce((s, i) => s + Date.parse(i.end) - Date.parse(i.start), 0), last: list.reduce((m, i) => Math.max(m, Date.parse(i.end)), 0) };
      };
      const live = new Set(all.filter((a) => !a.archived).map((a) => a.id));
      return {
        areas: all.filter((a) => a.archived && !a.system).map((a) => ({ id: a.id, ...stat((i) => i.areaId === a.id) })),
        subs: subs.filter((s) => s.archived && !s.system && live.has(s.areaId)).map((s) => ({ id: s.id, areaId: s.areaId, name: s.name, ...stat((i) => i.subAreaId === s.id) })),
      };
    }) ?? { areas: [], subs: [] };

  const summary = (x: { ms: number; last: number }) =>
    x.ms ? `${formatDuration(x.ms, false)} tracked · last on ${new Date(x.last).toLocaleDateString([], { day: 'numeric', month: 'short' })}` : 'Never tracked';
  const row = (target: Target, name: string, areaId: string, stat: { ms: number; last: number }) => {
    const a = areas.find((x) => x.id === areaId);
    return (
      <IonItem key={target.id} className="archived-row">
        {a && (
          <span slot="start" className="area-avatar archived" style={{ background: a.color, color: a.onColor }}>
            <IonIcon icon={iconFor(a.icon)} />
          </span>
        )}
        <IonLabel>
          <h3>{name}</h3>
          <p>{summary(stat)}</p>
        </IonLabel>
        <IonButton slot="end" fill="clear" size="small" onClick={() => restore(target)}>
          Restore
        </IonButton>
        <IonButton
          slot="end"
          fill="clear"
          size="small"
          color="medium"
          aria-label={`More for ${name}`}
          className="more-button"
          onClick={() =>
            presentSheet({
              header: name,
              buttons: [
                { text: 'Delete permanently…', role: 'destructive', icon: trashOutline, handler: () => setDeleting({ ...target, name }) },
                { text: 'Cancel', role: 'cancel' },
              ],
            })
          }
        >
          <IonIcon slot="icon-only" icon={ellipsisVertical} />
        </IonButton>
      </IonItem>
    );
  };
  const nameOf = (id: string) => areas.find((a) => a.id === id)?.name ?? '';

  return (
    <IonModal isOpen={open} onDidDismiss={onClose}>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={onClose} aria-label="Close">
              <IonIcon slot="icon-only" icon={close} />
            </IonButton>
          </IonButtons>
          <IonTitle>Archived</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        {items.areas.length > 0 && (
          <IonList>
            <IonListHeader>
              <IonLabel>Areas</IonLabel>
            </IonListHeader>
            {items.areas.map((x) => row({ kind: 'area', id: x.id }, nameOf(x.id), x.id, x))}
          </IonList>
        )}
        {items.subs.length > 0 && (
          <IonList>
            <IonListHeader>
              <IonLabel>Sub-areas</IonLabel>
            </IonListHeader>
            {items.subs.map((x) => row({ kind: 'sub', id: x.id }, `${nameOf(x.areaId)} · ${x.name}`, x.areaId, x))}
          </IonList>
        )}
        <IonNote className="ion-padding archived-note">
          {items.areas.length + items.subs.length === 0
            ? 'Nothing is archived.'
            : 'Archived areas and sub-areas are hidden from the timer and the editor. Their time stays in your history and reports.'}
        </IonNote>
      </IonContent>
      <DeleteDialog target={deleting} onClose={() => setDeleting(null)} onExport={onExport} />
    </IonModal>
  );
}
