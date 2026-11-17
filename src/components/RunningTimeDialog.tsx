import { Fragment } from 'react';
import {
  IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonModal, IonNote,
  IonTitle, IonToggle, IonToolbar,
} from '@ionic/react';
import { close } from 'ionicons/icons';
import { db, nowIso } from '../db';
import { useAreas } from '../hooks';
import { iconFor } from '../icons';
import { areaShowsTime, setShowTimeEnabled, useShowTimeEnabled } from '../runningTime';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Android's own Live updates permission for the app (undefined: not on this Android). */
  systemAllowed?: boolean;
  onOpenSystemSettings: () => void;
}

/**
 * Settings → Android app → Running time: every timer is a live update; this chooses,
 * globally and per area, whether its running time ticks (status bar, lock screen,
 * notification). Without it: icon-only chip and "Since …" — e.g. for Sleep.
 */
export default function RunningTimeDialog({ open, onClose, systemAllowed, onOpenSystemSettings }: Props) {
  const areas = useAreas();
  const enabled = useShowTimeEnabled();
  const setArea = (id: string, on: boolean) => db.areas.update(id, { liveUpdates: on, updatedAt: nowIso() });

  return (
    <IonModal isOpen={open} onDidDismiss={onClose} className="running-time-dialog">
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={onClose} aria-label="Close">
              <IonIcon slot="icon-only" icon={close} />
            </IonButton>
          </IonButtons>
          <IonTitle>Running time</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        {systemAllowed === false && (
          <IonList>
            <IonItem button detail onClick={onOpenSystemSettings} lines="none">
              <IonLabel className="ion-text-wrap">
                <h3>Live updates are off in Android settings</h3>
                <p>Allow them for Tracker to see the timer in the status bar.</p>
              </IonLabel>
            </IonItem>
          </IonList>
        )}
        <IonList>
          <IonItem lines="none">
            <IonToggle checked={enabled} onIonChange={(e) => setShowTimeEnabled(e.detail.checked)} aria-label="Show the running time">
              <IonLabel className="ion-text-wrap">
                <h2>Show the running time</h2>
                <p>Ticking in the status bar and on the lock screen</p>
              </IonLabel>
            </IonToggle>
          </IonItem>
        </IonList>
        <IonList>
          <IonListHeader>
            <IonLabel>Areas showing the time</IonLabel>
          </IonListHeader>
          {areas.map((a) => (
            <Fragment key={a.id}>
              <IonItem disabled={!enabled} lines={a.breakAfter ? 'none' : 'inset'} className="live-area">
                <span slot="start" className="dot" style={{ background: a.color, color: a.onColor }}>
                  <IonIcon icon={iconFor(a.icon)} />
                </span>
                <IonToggle
                  checked={areaShowsTime(a)}
                  onIonChange={(e) => setArea(a.id, e.detail.checked)}
                  aria-label={a.name}
                >
                  {a.name}
                </IonToggle>
              </IonItem>
              {a.breakAfter && <div className="live-row-gap" />}
            </Fragment>
          ))}
        </IonList>
        <IonNote className="live-note">
          Other areas still show their live update (icon in the status bar), without the ticking time.
        </IonNote>
      </IonContent>
    </IonModal>
  );
}
