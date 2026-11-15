import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonNote,
  IonPage, IonReorder, IonReorderGroup, IonSelect, IonSelectOption, IonTitle, IonToolbar, useIonActionSheet, useIonAlert,
  useIonToast,
  type ReorderEndEventDetail,
} from '@ionic/react';
import { add, cloudDownloadOutline, cloudUploadOutline, contrastOutline, refreshOutline, trashOutline } from 'ionicons/icons';
import AreaEditor from '../components/AreaEditor';
import { db, deleteTrackedTime, exportAll, importAll, nowIso, resetEverything } from '../db';
import { useAreas, useSubAreas, type AreaView } from '../hooks';
import { iconFor } from '../icons';
import { localDateKey } from '../time';
import { getThemePref, setThemePref, type ThemePref } from '../theme';

export default function SettingsPage() {
  const areas = useAreas();
  const subAreas = useSubAreas();
  const [editing, setEditing] = useState<AreaView | 'new' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [presentAlert] = useIonAlert();
  const [presentToast] = useIonToast();
  const [presentActionSheet] = useIonActionSheet();
  const [themePref, setThemePrefState] = useState<ThemePref>(getThemePref);
  const intervalCount = useLiveQuery(() => db.intervals.count()) ?? 0;
  const persisted = useLiveQuery(async () => (navigator.storage?.persisted ? navigator.storage.persisted() : false));

  async function onReorder(e: CustomEvent<ReorderEndEventDetail>) {
    const next = e.detail.complete(areas) as AreaView[];
    const t = nowIso();
    await db.transaction('rw', db.areas, async () => {
      for (const [i, a] of next.entries()) await db.areas.update(a.id, { order: i, updatedAt: t });
    });
  }

  async function doExport() {
    const data = await exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const name = `timetracker-${localDateKey(Date.now())}.json`;
    const file = new File([blob], name, { type: 'application/json' });
    // Android share sheet if available (save to Drive, etc.), otherwise download.
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return;
      } catch {
        /* cancelled — fall through to download */
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function confirmThen(header: string, message: string, action: () => Promise<void>, done: string) {
    presentAlert({
      header,
      message,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: async () => {
            await action();
            presentToast({ message: done, duration: 2000 });
          },
        },
      ],
    });
  }

  function startFresh() {
    presentActionSheet({
      header: 'Start fresh',
      subHeader: 'Consider exporting a backup first. This cannot be undone.',
      buttons: [
        {
          text: 'Delete tracked time, keep areas',
          role: 'destructive',
          icon: trashOutline,
          handler: () =>
            confirmThen(
              'Delete all tracked time?',
              `All ${intervalCount} intervals and the running timer will be deleted. Your areas stay as they are.`,
              deleteTrackedTime,
              'Tracked time deleted',
            ),
        },
        {
          text: 'Reset everything to defaults',
          role: 'destructive',
          icon: refreshOutline,
          handler: () =>
            confirmThen(
              'Reset everything?',
              'All tracked time and your custom areas will be deleted, and the default areas restored.',
              resetEverything,
              'App reset to defaults',
            ),
        },
        { text: 'Cancel', role: 'cancel' },
      ],
    });
  }

  async function onImportFile(file: File) {
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.areas) || !Array.isArray(data.intervals)) throw new Error('Not a backup file');
      presentAlert({
        header: 'Replace all data?',
        message: `This will replace your current data with ${data.intervals.length} intervals from the backup.`,
        buttons: [
          { text: 'Cancel', role: 'cancel' },
          {
            text: 'Replace',
            role: 'destructive',
            handler: async () => {
              const fixed = await importAll(data);
              presentToast({
                message: fixed ? `Backup restored · ${fixed} overlapping records fixed` : 'Backup restored',
                duration: 2500,
              });
            },
          },
        ],
      });
    } catch (err) {
      presentToast({ message: `Import failed: ${(err as Error).message}`, duration: 3000, color: 'danger' });
    }
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Settings</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={() => setEditing('new')} aria-label="Add area">
              <IonIcon slot="icon-only" icon={add} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <IonList>
          <IonListHeader>
            <IonLabel>Areas</IonLabel>
          </IonListHeader>
          <IonReorderGroup disabled={false} onIonReorderEnd={onReorder}>
            {areas.map((a) => {
              const subs = subAreas.filter((s) => s.areaId === a.id && !s.archived);
              return (
                <IonItem
                  key={a.id}
                  button
                  detail={false}
                  className={a.breakAfter ? 'row-break' : undefined}
                  onClick={() => setEditing(a)}
                >
                  <span slot="start" className="area-avatar" style={{ background: a.color, color: a.onColor }}>
                    <IonIcon icon={iconFor(a.icon)} />
                  </span>
                  <IonLabel>
                    <h3>{a.name}</h3>
                    {subs.length > 0 && <p>{subs.map((s) => s.name).join(', ')}</p>}
                  </IonLabel>
                  {a.breakAfter && (
                    <IonNote slot="end" className="row-break-note">new row ↵</IonNote>
                  )}
                  <IonReorder slot="end" />
                </IonItem>
              );
            })}
          </IonReorderGroup>
          <IonItem button detail={false} onClick={() => setEditing('new')}>
            <IonIcon slot="start" icon={add} />
            <IonLabel>Add area</IonLabel>
          </IonItem>
        </IonList>

        <IonList>
          <IonListHeader>
            <IonLabel>Appearance</IonLabel>
          </IonListHeader>
          <IonItem>
            <IonIcon slot="start" icon={contrastOutline} />
            <IonSelect
              label="Theme"
              interface="alert"
              interfaceOptions={{ header: 'Theme' }}
              value={themePref}
              onIonChange={(e) => {
                const next = e.detail.value as ThemePref;
                setThemePref(next);
                setThemePrefState(next);
              }}
            >
              <IonSelectOption value="system">System default</IonSelectOption>
              <IonSelectOption value="light">Light</IonSelectOption>
              <IonSelectOption value="dark">Dark</IonSelectOption>
            </IonSelect>
          </IonItem>
        </IonList>

        <IonList>
          <IonListHeader>
            <IonLabel>Data</IonLabel>
          </IonListHeader>
          <IonItem>
            <IonLabel>
              <h3>Stored on this device</h3>
              <p>{intervalCount} intervals · {persisted ? 'protected from cleanup' : 'may be cleared by the browser'}</p>
            </IonLabel>
          </IonItem>
          <IonItem button detail={false} onClick={doExport}>
            <IonIcon slot="start" icon={cloudUploadOutline} />
            <IonLabel>Export backup</IonLabel>
          </IonItem>
          <IonItem button detail={false} onClick={() => fileRef.current?.click()}>
            <IonIcon slot="start" icon={cloudDownloadOutline} />
            <IonLabel>Restore backup</IonLabel>
          </IonItem>
          <IonItem button detail={false} onClick={startFresh}>
            <IonIcon slot="start" icon={trashOutline} color="danger" />
            <IonLabel color="danger">Delete data &amp; start fresh</IonLabel>
          </IonItem>
        </IonList>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImportFile(f);
            e.target.value = '';
          }}
        />
        <IonNote className="ion-padding version-note">Time Tracker · build {__APP_BUILD__}</IonNote>
      </IonContent>
      <AreaEditor area={editing} onClose={() => setEditing(null)} />
    </IonPage>
  );
}
