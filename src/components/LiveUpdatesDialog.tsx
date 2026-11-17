import { Fragment } from 'react';
import {
  IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonModal, IonNote,
  IonTitle, IonToggle, IonToolbar,
} from '@ionic/react';
import { close } from 'ionicons/icons';
import { db, nowIso } from '../db';
import { useAreas } from '../hooks';
import { iconFor } from '../icons';
import { areaWantsLiveUpdates, setLiveUpdatesEnabled, useLiveUpdatesEnabled } from '../liveUpdates';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Android's own Live updates permission for the app (undefined: not on this Android). */
  systemAllowed?: boolean;
  onOpenSystemSettings: () => void;
}

/**
 * Settings → Android app → Live updates: a global switch and, per area, whether its
 * timer shows as a live update. Without one, the notification is quiet (area icon,
 * "Since …", no ticking time) — e.g. for Sleep.
 */
export default function LiveUpdatesDialog({ open, onClose, systemAllowed, onOpenSystemSettings }: Props) {
  const areas = useAreas();
  const enabled = useLiveUpdatesEnabled();
  const setArea = (id: string, on: boolean) => db.areas.update(id, { liveUpdates: on, updatedAt: nowIso() });

  return (
    <IonModal isOpen={open} onDidDismiss={onClose} className="live-updates-dialog">
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={onClose} aria-label="Close">
              <IonIcon slot="icon-only" icon={close} />
            </IonButton>
          </IonButtons>
          <IonTitle>Live updates</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        {systemAllowed === false && (
          <IonList>
            <IonItem button detail onClick={onOpenSystemSettings} lines="none">
              <IonLabel className="ion-text-wrap">
                <h3>Off in Android settings</h3>
                <p>Allow live updates for Tracker there first.</p>
              </IonLabel>
            </IonItem>
          </IonList>
        )}
        <IonList>
          <IonItem lines="none">
            <IonToggle checked={enabled} onIonChange={(e) => setLiveUpdatesEnabled(e.detail.checked)} aria-label="Live updates">
              <IonLabel className="ion-text-wrap">
                <h2>Live updates</h2>
                <p>The running time in the status bar and on the lock screen</p>
              </IonLabel>
            </IonToggle>
          </IonItem>
        </IonList>
        <IonList>
          <IonListHeader>
            <IonLabel>Areas with live updates</IonLabel>
          </IonListHeader>
          {areas.map((a) => (
            <Fragment key={a.id}>
              <IonItem disabled={!enabled} lines={a.breakAfter ? 'none' : 'inset'} className="live-area">
                <span slot="start" className="dot" style={{ background: a.color, color: a.onColor }}>
                  <IonIcon icon={iconFor(a.icon)} />
                </span>
                <IonToggle
                  checked={areaWantsLiveUpdates(a)}
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
          Areas without live updates still show the notification and their icon in the status bar, without the ticking
          time.
        </IonNote>
      </IonContent>
    </IonModal>
  );
}
