import { useEffect, useState } from 'react';
import {
  IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonInput, IonItem, IonList, IonListHeader,
  IonModal, IonTitle, IonToggle, IonToolbar, useIonAlert,
} from '@ionic/react';
import { add, close, closeCircle, trashOutline } from 'ionicons/icons';
import { db, nowIso, uuid, type Area, type SubArea } from '../db';
import { ICONS, PALETTE } from '../icons';

interface Props {
  area: Area | 'new' | null;
  onClose: () => void;
}

interface SubDraft {
  id: string;
  name: string;
  isNew?: boolean;
}

export default function AreaEditor({ area, onClose }: Props) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('sparkles');
  const [color, setColor] = useState(PALETTE[5]);
  const [breakAfter, setBreakAfter] = useState(false);
  const [subs, setSubs] = useState<SubDraft[]>([]);
  const [removedSubs, setRemovedSubs] = useState<string[]>([]);
  const [presentAlert] = useIonAlert();

  useEffect(() => {
    if (!area) return;
    setRemovedSubs([]);
    if (area === 'new') {
      setName('');
      setIcon('sparkles');
      setColor(PALETTE[Math.floor(Math.random() * PALETTE.length)]);
      setBreakAfter(false);
      setSubs([]);
    } else {
      setName(area.name);
      setIcon(area.icon);
      setColor(area.color);
      setBreakAfter(!!area.breakAfter);
      db.subAreas
        .where('areaId')
        .equals(area.id)
        .sortBy('order')
        .then((list: SubArea[]) => setSubs(list.filter((s) => !s.archived).map((s) => ({ id: s.id, name: s.name }))));
    }
  }, [area]);

  const valid = name.trim().length > 0;

  async function save() {
    if (!area || !valid) return;
    const t = nowIso();
    await db.transaction('rw', [db.areas, db.subAreas, db.intervals, db.active], async () => {
      let areaId: string;
      if (area === 'new') {
        areaId = uuid();
        const order = (await db.areas.count()) ?? 0;
        await db.areas.add({ id: areaId, name: name.trim(), icon, color, order, breakAfter, updatedAt: t });
      } else {
        areaId = area.id;
        await db.areas.update(areaId, { name: name.trim(), icon, color, breakAfter, updatedAt: t });
      }
      const kept = subs.filter((s) => s.name.trim());
      for (const [i, s] of kept.entries()) {
        if (s.isNew) await db.subAreas.add({ id: s.id, areaId, name: s.name.trim(), order: i, updatedAt: t });
        else await db.subAreas.update(s.id, { name: s.name.trim(), order: i, updatedAt: t });
      }
      // Removed sub-areas: archive if referenced by history, otherwise delete.
      for (const id of removedSubs) {
        const used = (await db.intervals.filter((iv) => iv.subAreaId === id).count()) > 0;
        if (used) await db.subAreas.update(id, { archived: true, updatedAt: t });
        else await db.subAreas.delete(id);
        const act = await db.active.get('current');
        if (act?.subAreaId === id) await db.active.put({ ...act, subAreaId: null });
      }
    });
    onClose();
  }

  function removeArea() {
    if (!area || area === 'new') return;
    presentAlert({
      header: `Delete “${area.name}”?`,
      message: 'Past intervals are kept in your history; the area is just hidden from the selector.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: async () => {
            const used = (await db.intervals.where('areaId').equals(area.id).count()) > 0;
            const act = await db.active.get('current');
            if (act?.areaId === area.id) {
              presentAlert({ header: 'Area is being tracked', message: 'Stop the timer first.', buttons: ['OK'] });
              return;
            }
            if (used) await db.areas.update(area.id, { archived: true, updatedAt: nowIso() });
            else {
              await db.areas.delete(area.id);
              await db.subAreas.where('areaId').equals(area.id).delete();
            }
            onClose();
          },
        },
      ],
    });
  }

  return (
    <IonModal isOpen={!!area} onDidDismiss={onClose}>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={onClose} aria-label="Close">
              <IonIcon slot="icon-only" icon={close} />
            </IonButton>
          </IonButtons>
          <IonTitle>{area === 'new' ? 'New area' : 'Edit area'}</IonTitle>
          <IonButtons slot="end">
            <IonButton strong disabled={!valid} onClick={save}>Save</IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <div className="area-preview" style={{ ['--area-color' as string]: color }}>
          <span className="area-preview-icon"><IonIcon icon={ICONS[icon]} /></span>
        </div>
        <IonList>
          <IonItem>
            <IonInput
              label="Name"
              labelPlacement="stacked"
              placeholder="e.g. Guitar"
              value={name}
              onIonInput={(e) => setName(String(e.detail.value ?? ''))}
            />
          </IonItem>
          <IonItem>
            <IonToggle checked={breakAfter} onIonChange={(e) => setBreakAfter(e.detail.checked)}>
              Start a new row after this area
            </IonToggle>
          </IonItem>
        </IonList>

        <IonListHeader>Colour</IonListHeader>
        <div className="swatches">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              className={`swatch${c === color ? ' selected' : ''}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>

        <IonListHeader>Icon</IonListHeader>
        <div className="icon-grid" style={{ ['--area-color' as string]: color }}>
          {Object.entries(ICONS).map(([key, ic]) => (
            <button
              key={key}
              type="button"
              aria-label={key}
              className={`icon-choice${key === icon ? ' selected' : ''}`}
              onClick={() => setIcon(key)}
            >
              <IonIcon icon={ic} />
            </button>
          ))}
        </div>

        <IonListHeader>Sub-areas</IonListHeader>
        <IonList>
          {subs.map((s, i) => (
            <IonItem key={s.id}>
              <IonInput
                aria-label="Sub-area name"
                placeholder="Sub-area name"
                value={s.name}
                onIonInput={(e) =>
                  setSubs(subs.map((x, j) => (j === i ? { ...x, name: String(e.detail.value ?? '') } : x)))
                }
              />
              <IonButton
                slot="end"
                fill="clear"
                color="medium"
                aria-label="Remove sub-area"
                onClick={() => {
                  if (!s.isNew) setRemovedSubs([...removedSubs, s.id]);
                  setSubs(subs.filter((_, j) => j !== i));
                }}
              >
                <IonIcon slot="icon-only" icon={closeCircle} />
              </IonButton>
            </IonItem>
          ))}
          <IonItem button detail={false} onClick={() => setSubs([...subs, { id: uuid(), name: '', isNew: true }])}>
            <IonIcon slot="start" icon={add} />
            Add sub-area
          </IonItem>
        </IonList>

        {area !== 'new' && (
          <div className="ion-padding">
            <IonButton expand="block" fill="outline" color="danger" onClick={removeArea}>
              <IonIcon slot="start" icon={trashOutline} />
              Delete area
            </IonButton>
          </div>
        )}
      </IonContent>
    </IonModal>
  );
}
