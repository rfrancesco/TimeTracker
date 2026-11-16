import { useEffect, useState } from 'react';
import { IonButton, IonChip, IonContent, IonIcon, IonLabel, IonModal, IonText } from '@ionic/react';
import { stop as stopIcon } from 'ionicons/icons';
import type { ActiveTimer } from '../db';
import type { AreaView } from '../hooks';
import { iconFor } from '../icons';
import { DateTimeField } from './IntervalEditor';
import { formatDuration, RELABEL_THRESHOLD_MS } from '../timer';

interface Props {
  active: ActiveTimer | undefined;
  area: AreaView | undefined;
  subName?: string;
  open: boolean;
  onClose: () => void;
  onStop: (endMs: number) => void;
}

const MIN = 60_000;
const QUICK = [5, 15, 30, 60];
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** "I forgot to stop": pick when the timer actually ended. */
export default function StopEarlierSheet({ active, area, subName, open, onClose, onStop }: Props) {
  const start = active ? new Date(active.start).getTime() : 0;
  const [end, setEnd] = useState(Date.now());

  useEffect(() => {
    if (open) setEnd(Math.floor(Date.now() / MIN) * MIN);
  }, [open]);

  const now = Date.now();
  const problem = end <= start ? 'That’s before the timer started' : end > now ? 'That’s in the future' : null;
  const tooShort = !problem && end - start < RELABEL_THRESHOLD_MS;

  return (
    <IonModal isOpen={open} onDidDismiss={onClose} initialBreakpoint={0.6} breakpoints={[0, 0.6, 0.9]} className="stop-sheet">
      <IonContent className="ion-padding">
        {active && area && (
          <>
            <h2 className="sheet-title">Stopped earlier?</h2>
            <div className="sheet-running">
              <span className="dot" style={{ background: area.color, color: area.onColor }}>
                <IonIcon icon={iconFor(area.icon)} />
              </span>
              <span>
                {area.name}
                {subName ? ` · ${subName}` : ''} <IonText color="medium">· since {hhmm(start)}</IonText>
              </span>
            </div>

            <div className="sheet-quick">
              {QUICK.map((m) => {
                const t = Math.floor((now - m * MIN) / MIN) * MIN;
                return (
                  <IonChip key={m} disabled={t <= start} outline={end !== t} onClick={() => setEnd(t)}>
                    <IonLabel>{m < 60 ? `${m} min ago` : '1 h ago'}</IonLabel>
                  </IonChip>
                );
              })}
            </div>

            <DateTimeField label="Ended" value={end} onChange={(ms) => setEnd(ms)} />

            <p className={`sheet-hint${problem ? ' error' : ''}`}>
              {problem ??
                (tooShort
                  ? 'Under a minute: the timer will be discarded, not saved.'
                  : `Saves ${formatDuration(end - start, false)}, ${hhmm(start)}–${hhmm(end)}.`)}
            </p>

            <IonButton expand="block" shape="round" color="danger" disabled={!!problem} onClick={() => onStop(end)}>
              <IonIcon slot="start" icon={stopIcon} />
              Stop at {hhmm(end)}
            </IonButton>
          </>
        )}
      </IonContent>
    </IonModal>
  );
}
