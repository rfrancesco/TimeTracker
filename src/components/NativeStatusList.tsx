import { useEffect, useState } from 'react';
import { IonItem, IonLabel, IonList, IonListHeader, IonNote, useIonViewWillEnter } from '@ionic/react';
import { inWrapper, lastBridgeError, native, type NativeStatus } from '../native';
import { useActive, useAreas } from '../hooks';
import { areaLiveUpdate, areaRunningTime } from '../runningTime';
import { LiveUpdatesDialog } from './RunningTimeDialog';

/**
 * Settings → Android app (only inside the wrapper): what the system allows and
 * whether the running-timer notification is up and promoted to a Live Update.
 */
export default function NativeStatusList() {
  const [s, setS] = useState<NativeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState(false);
  const areas = useAreas();
  const active = useActive();
  const withLive = areas.filter(areaLiveUpdate).length;
  const activeArea = areas.find((a) => a.id === active?.areaId);
  const quietNow = activeArea && areaRunningTime(activeArea) !== 'on';

  const load = () =>
    native?.status().then(
      (r) => {
        setS(r);
        setError(null);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  useIonViewWillEnter(() => void load()); // tab pages stay mounted: refresh on every visit
  useEffect(() => {
    if (!native) return;
    load();
    // Coming back from the system settings page.
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  if (!inWrapper) return null;
  const openSettings = () => void native?.openNotificationSettings().catch(() => {});
  const timer = !s
    ? ''
    : !s.posted
      ? 'Not showing'
      : s.promoted
        ? `Showing · live update${quietNow ? ', icon only' : ''}`
        : s.promotable === false
          ? 'Showing · doesn’t qualify as a Live Update'
          : 'Showing · not promoted';
  const problem = error ?? s?.lastError ?? lastBridgeError;
  const loadError = s?.lastLoadError;

  return (
    <IonList>
      <IonListHeader>
        <IonLabel>Android app</IonLabel>
      </IonListHeader>
      {!native ? (
        <IonItem>
          <IonLabel color="danger">Not connected to the app (plugin missing)</IonLabel>
        </IonItem>
      ) : (
        s && (
          <>
            <IonItem button detail onClick={openSettings}>
              <IonLabel>Notifications</IonLabel>
              <IonNote slot="end">{s.notificationsEnabled ? 'Allowed' : 'Off'}</IonNote>
            </IonItem>
            <IonItem button detail onClick={() => setDialog(true)}>
              <IonLabel>Live updates</IonLabel>
              <IonNote slot="end">
                {s.liveUpdatesAllowed === false
                  ? 'Off in Android'
                  : withLive === 0
                    ? 'Off'
                    : withLive === areas.length
                      ? 'All areas'
                      : `${withLive} of ${areas.length} areas`}
              </IonNote>
            </IonItem>
            <IonItem>
              <IonLabel>Timer notification</IonLabel>
              <IonNote slot="end">{timer}</IonNote>
            </IonItem>
          </>
        )
      )}
      {loadError && (
        <IonItem>
          <IonLabel className="ion-text-wrap">
            <p>
              Last time the app couldn’t open ({new Date(loadError.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}):{' '}
              {loadError.description} ({loadError.code})
            </p>
          </IonLabel>
        </IonItem>
      )}
      {problem && (
        <IonItem>
          <IonLabel className="ion-text-wrap">
            <IonNote color="danger">{problem}</IonNote>
          </IonLabel>
        </IonItem>
      )}
      <LiveUpdatesDialog
        open={dialog}
        onClose={() => setDialog(false)}
        systemAllowed={s?.liveUpdatesAllowed}
        onOpenSystemSettings={openSettings}
      />
    </IonList>
  );
}
