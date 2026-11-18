import { Fragment, type ReactNode } from 'react';
import {
  IonButton, IonButtons, IonChip, IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonList, IonModal, IonNote,
  IonTitle, IonToggle, IonToolbar,
} from '@ionic/react';
import { close } from 'ionicons/icons';
import { db, nowIso, type RunningTime } from '../db';
import { useAreas, type AreaView } from '../hooks';
import { iconFor } from '../icons';
import { inWrapper } from '../native';
import { areaLiveUpdate, areaRunningTime } from '../runningTime';

/** A full-screen list of areas (in their rows) with one control each. */
function AreaSettingsDialog(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  className: string;
  intro: ReactNode;
  top?: ReactNode;
  control: (a: AreaView) => ReactNode;
}) {
  const areas = useAreas();
  return (
    <IonModal isOpen={props.open} onDidDismiss={props.onClose} className={`area-settings-dialog ${props.className}`}>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={props.onClose} aria-label="Close">
              <IonIcon slot="icon-only" icon={close} />
            </IonButton>
          </IonButtons>
          <IonTitle>{props.title}</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        {props.top}
        <IonNote className="area-settings-intro">{props.intro}</IonNote>
        <IonList>
          {areas.map((a) => (
            <Fragment key={a.id}>
              <IonItem lines={a.breakAfter ? 'none' : 'inset'} className="area-setting">
                <span slot="start" className="dot" style={{ background: a.color, color: a.onColor }}>
                  <IonIcon icon={iconFor(a.icon)} />
                </span>
                {props.control(a)}
              </IonItem>
              {a.breakAfter && <div className="area-row-gap" />}
            </Fragment>
          ))}
        </IonList>
      </IonContent>
    </IonModal>
  );
}

const save = (id: string, patch: { runningTime?: RunningTime; liveUpdate?: boolean }) =>
  db.areas.update(id, { ...patch, updatedAt: nowIso() });

/**
 * Settings → Appearance → Running time: per area, where the time ticks. Off: "since
 * 22:45" instead (e.g. Sleep). App only (Android app): ticking in the app, not in the
 * notification. In the browser there is no notification, so App only isn't offered.
 */
export function RunningTimeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const choices: Array<[RunningTime, string]> = inWrapper ? [['off', 'Off'], ['app', 'App only'], ['on', 'On']] : [['off', 'Off'], ['on', 'On']];
  return (
    <AreaSettingsDialog
      open={open}
      onClose={onClose}
      title="Running time"
      className="running-time-dialog"
      intro={
        inWrapper
          ? 'Off: “since 22:45” instead of a ticking time. App only: ticking in the app, not in the notification.'
          : 'Off: “since 22:45” instead of a ticking time.'
      }
      control={(a) => {
        // In the browser "app only" is the same as "on".
        const value = inWrapper ? areaRunningTime(a) : areaRunningTime(a) === 'off' ? 'off' : 'on';
        return (
          <>
            <IonLabel>{a.name}</IonLabel>
            <div slot="end" className="running-time-chips" role="radiogroup" aria-label={`${a.name} running time`}>
              {choices.map(([v, label]) => (
                <IonChip
                  key={v}
                  role="radio"
                  aria-checked={value === v}
                  outline={value !== v}
                  style={value === v ? { ['--background' as string]: a.color, ['--color' as string]: a.onColor } : undefined}
                  onClick={() => save(a.id, { runningTime: v })}
                >
                  <IonLabel>{label}</IonLabel>
                </IonChip>
              ))}
            </div>
          </>
        );
      }}
    />
  );
}

/** Settings → Android app → Live updates: per area, a live update or a plain notification. */
export function LiveUpdatesDialog(props: {
  open: boolean;
  onClose: () => void;
  systemAllowed?: boolean;
  onOpenSystemSettings: () => void;
}) {
  return (
    <AreaSettingsDialog
      open={props.open}
      onClose={props.onClose}
      title="Live updates"
      className="live-updates-dialog"
      top={
        props.systemAllowed === false && (
          <IonList>
            <IonItem button detail onClick={props.onOpenSystemSettings} lines="none">
              <IonLabel className="ion-text-wrap">
                <h3>Live updates are off in Android settings</h3>
                <p>Every timer shows as a plain notification.</p>
              </IonLabel>
            </IonItem>
          </IonList>
        )
      }
      intro="The timer at the far left of the status bar and on top of the lock screen (other icons may be hidden). It ticks if the area’s running time is On, else it shows just the icon. Off: a plain notification."
      control={(a) => (
        <IonToggle checked={areaLiveUpdate(a)} onIonChange={(e) => save(a.id, { liveUpdate: e.detail.checked })} aria-label={a.name}>
          {a.name}
        </IonToggle>
      )}
    />
  );
}
