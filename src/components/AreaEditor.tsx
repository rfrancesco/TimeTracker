import { useEffect, useState } from 'react';
import {
  IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonInput, IonItem, IonList, IonListHeader,
  IonModal, IonReorder, IonReorderGroup, IonTitle, IonToggle, IonToolbar, useIonActionSheet, useIonAlert,
  type ReorderEndEventDetail,
} from '@ionic/react';
import { add, archiveOutline, close } from 'ionicons/icons';
import { db, nowIso, uuid, type SubArea } from '../db';
import { archive, archiveSubAndDetach, restore } from '../archive';
import { stopAt } from '../timer';
import { recordTimerAction } from '../undo';
import { useDarkMode, type AreaView } from '../hooks';
import { displayColor, onColor } from '../color';
import { ICONS, PALETTE } from '../icons';

interface Props {
  area: AreaView | 'new' | null;
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
  // Removed sub-areas are archived on save; `detach`: it was running and the timer continues as the area.
  const [removedSubs, setRemovedSubs] = useState<Array<{ id: string; detach: boolean }>>([]);
  const [presentAlert] = useIonAlert();
  const [presentSheet] = useIonActionSheet();
  const dark = useDarkMode();
  const shown = displayColor(color, dark);

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
      setColor(area.baseColor);
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
    // A new area named like an archived one: offer to bring that one back (its history with it).
    if (area === 'new') {
      const same = (await db.areas.toArray()).find((a) => a.archived && !a.system && a.name.trim().toLowerCase() === name.trim().toLowerCase());
      if (same) {
        presentAlert({
          header: `“${same.name}” is archived`,
          message: 'Restore it with its history, or create a separate new area?',
          buttons: [
            { text: 'Create new', handler: () => void write() },
            {
              text: 'Restore',
              handler: async () => {
                await restore({ kind: 'area', id: same.id });
                onClose();
              },
            },
          ],
        });
        return;
      }
    }
    await write();
  }

  async function write() {
    if (!area) return;
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
      const archivedSubs = (await db.subAreas.where('areaId').equals(areaId).toArray()).filter((s) => s.archived && !s.system);
      for (const [i, s] of kept.entries()) {
        // A new sub-area named like an archived one of this area: bring that one back instead.
        const same = s.isNew && archivedSubs.find((x) => x.name.trim().toLowerCase() === s.name.trim().toLowerCase());
        if (same) await db.subAreas.update(same.id, { archived: false, order: i, updatedAt: t });
        else if (s.isNew) await db.subAreas.add({ id: s.id, areaId, name: s.name.trim(), order: i, updatedAt: t });
        else await db.subAreas.update(s.id, { name: s.name.trim(), order: i, updatedAt: t });
      }
      for (const r of removedSubs) {
        if (r.detach) await archiveSubAndDetach(r.id);
        else await archive({ kind: 'sub', id: r.id });
      }
    });
    onClose();
  }

  /** Remove a sub-area from the list (archived on save). If it is running, ask what the timer does. */
  async function removeSub(i: number) {
    const s = subs[i];
    const drop = (detach: boolean) => {
      if (!s.isNew) setRemovedSubs([...removedSubs, { id: s.id, detach }]);
      setSubs(subs.filter((_, j) => j !== i));
    };
    const act = await db.active.get('current');
    if (s.isNew || act?.subAreaId !== s.id || area === 'new' || !area) return drop(false);
    presentSheet({
      header: `${s.name} is running`,
      buttons: [
        { text: `Archive, keep ${s.name} until I switch`, handler: () => drop(false) },
        { text: `Archive, the timer continues as ${area.name}`, handler: () => drop(true) },
        { text: 'Cancel', role: 'cancel' },
      ],
    });
  }

  /** Archive the area (Settings → Archived restores it). If it is running, ask what the timer does. */
  async function archiveArea() {
    if (!area || area === 'new') return;
    const done = async () => {
      await archive({ kind: 'area', id: area.id });
      onClose();
    };
    const act = await db.active.get('current');
    if (act?.areaId === area.id) {
      presentSheet({
        header: `${area.name} is running`,
        buttons: [
          { text: 'Archive, keep tracking until I stop', handler: () => void done() },
          {
            text: 'Stop the timer, then archive',
            handler: async () => {
              await recordTimerAction(`stop ${area.name}`, () => stopAt());
              await done();
            },
          },
          { text: 'Cancel', role: 'cancel' },
        ],
      });
      return;
    }
    presentAlert({
      header: `Archive “${area.name}”?`,
      message: 'Hidden from the timer. Its time stays in your history and reports; Settings → Archived brings it back.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Archive', handler: () => void done() },
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
        <div className="area-preview" style={{ ['--area-color' as string]: shown, ['--on-area' as string]: onColor(shown) }}>
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
              style={{ background: displayColor(c, dark) }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>

        <IonListHeader>Icon</IonListHeader>
        <div className="icon-grid" style={{ ['--area-color' as string]: shown, ['--on-area' as string]: onColor(shown) }}>
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
          {/* Drag the handles to reorder; the saved order is the list order. */}
          <IonReorderGroup
            disabled={subs.length < 2}
            onIonReorderEnd={(e: CustomEvent<ReorderEndEventDetail>) => setSubs(e.detail.complete(subs) as SubDraft[])}
          >
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
                aria-label="Archive sub-area"
                className="sub-archive"
                onClick={() => removeSub(i)}
              >
                <IonIcon slot="icon-only" icon={archiveOutline} />
              </IonButton>
              <IonReorder slot="end" />
            </IonItem>
          ))}
          </IonReorderGroup>
          <IonItem button detail={false} onClick={() => setSubs([...subs, { id: uuid(), name: '', isNew: true }])}>
            <IonIcon slot="start" icon={add} />
            Add sub-area
          </IonItem>
        </IonList>

        {area !== 'new' && (
          <div className="ion-padding">
            <IonButton expand="block" fill="outline" color="medium" onClick={archiveArea}>
              <IonIcon slot="start" icon={archiveOutline} />
              Archive area
            </IonButton>
          </div>
        )}
      </IonContent>
    </IonModal>
  );
}
