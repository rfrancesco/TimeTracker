import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonNote,
  IonPage, IonReorder, IonReorderGroup, IonSelect, IonSelectOption, IonTitle, IonToolbar, useIonActionSheet, useIonAlert,
  type ReorderEndEventDetail,
} from '@ionic/react';
import { add, cloudDownloadOutline, cloudUploadOutline, contrastOutline, refreshOutline, trashOutline } from 'ionicons/icons';
import AreaEditor from '../components/AreaEditor';
import { db, deleteTrackedTime, exportAll, importAll, nowIso, resetEverything } from '../db';
import { useAreas, useSubAreas, useToast, type AreaView } from '../hooks';
import { iconFor } from '../icons';
import { localDateKey } from '../time';
import { BackupError, parseBackup } from '../backup';
import { getThemePref, setThemePref, type ThemePref } from '../theme';
import { inWrapper, native } from '../native';
import NativeStatusList from '../components/NativeStatusList';

export default function SettingsPage() {
  const areas = useAreas();
  const subAreas = useSubAreas();
  const [editing, setEditing] = useState<AreaView | 'new' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [presentAlert] = useIonAlert();
  const toast = useToast();
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
    // Android wrapper: its WebView can't download or use the Web Share API.
    if (native) {
      try {
        await native.shareFile({ name, text: await blob.text() });
        return;
      } catch {
        /* older wrapper: fall through */
      }
    }
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
    // Revoking right away can cancel the download on some mobile browsers.
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
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
            toast(done);
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
    let data;
    try {
      data = parseBackup(await file.text()); // validates everything before asking
    } catch (err) {
      const message = err instanceof BackupError ? err.message : `Couldn’t read the file: ${(err as Error).message}`;
      presentAlert({ header: 'Import failed', message: `${message} Nothing was changed.`, buttons: ['OK'] });
      return;
    }
    const n = data.intervals.length;
    const when = data.exportedAt ? ` from ${new Date(data.exportedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : '';
    presentAlert({
      header: 'Replace all data?',
      message: `This replaces everything on this device with the backup${when}: ${data.areas.length} areas and ${n} intervals${data.active.length ? ', plus a running timer' : ''}.`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Replace',
          role: 'destructive',
          handler: () => {
            // Run after the dialog closes; the database write is one transaction,
            // so a failure leaves the current data exactly as it was.
            importAll(data)
              .then((fixed) => toast(fixed ? `Backup restored · ${fixed} overlapping records fixed` : 'Backup restored'))
              .catch((err) =>
                presentAlert({
                  header: 'Import failed',
                  message: `${(err as Error).message || 'The backup couldn’t be written.'} Nothing was changed.`,
                  buttons: ['OK'],
                }),
              );
          },
        },
      ],
    });
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

        <NativeStatusList />

        <IonList>
          <IonListHeader>
            <IonLabel>Data</IonLabel>
          </IonListHeader>
          <IonItem>
            <IonLabel>
              <h3>Stored on this device</h3>
              <p>
                {intervalCount} intervals
                {/* Browser storage can be evicted unless persistent; the Android app keeps its own data. */}
                {!inWrapper && ` · ${persisted ? 'protected from cleanup' : 'may be cleared by the browser'}`}
              </p>
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
