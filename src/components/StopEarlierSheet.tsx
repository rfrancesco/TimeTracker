import { useEffect, useState } from 'react';
import { IonButton, IonChip, IonContent, IonIcon, IonLabel, IonModal, IonText } from '@ionic/react';
import { stop as stopIcon, trashOutline } from 'ionicons/icons';
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
  onDiscard: () => void;
}

const MIN = 60_000;
const QUICK = [5, 15, 30, 60];
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** "I forgot to stop": pick when the timer actually ended. */
export default function StopEarlierSheet({ active, area, subName, open, onClose, onStop, onDiscard }: Props) {
  const start = active ? new Date(active.start).getTime() : 0;
  const [end, setEnd] = useState(Date.now());
  // 🗑 is one of the choices; the main button applies whichever is selected, so
  // discarding always takes two deliberate taps.
  const [discard, setDiscard] = useState(false);

  useEffect(() => {
    if (open) {
      setEnd(Math.floor(Date.now() / MIN) * MIN);
      setDiscard(false);
    }
  }, [open]);
  const pickTime = (t: number) => {
    setDiscard(false);
    setEnd(t);
  };

  const now = Date.now();
  const nowMin = Math.floor(now / MIN) * MIN;
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

            {/* One row: the times (scroll sideways if the screen is very narrow) and 🗑 pinned right. */}
            <div className="sheet-quick">
              <div className="sheet-times">
                {/* "Now" is always available, so there is always a way back from 🗑. */}
                <IonChip outline={discard || end !== nowMin} onClick={() => pickTime(nowMin)}>
                  <IonLabel>Now</IonLabel>
                </IonChip>
                {QUICK.map((m) => {
                  const t = Math.floor((now - m * MIN) / MIN) * MIN;
                  return (
                    <IonChip key={m} disabled={t <= start} outline={discard || end !== t} onClick={() => pickTime(t)}>
                      <IonLabel>{m < 60 ? `${m} min` : '1 h'}</IonLabel>
                    </IonChip>
                  );
                })}
              </div>
              <IonChip outline={!discard} className="discard-chip" aria-label="Discard this timer" onClick={() => setDiscard(true)}>
                <IonIcon icon={trashOutline} />
              </IonChip>
            </div>

            {/* Dimmed while 🗑 is selected, but still tappable: touching it goes back to stopping. */}
            <div className={discard ? 'sheet-dimmed' : undefined} onClickCapture={() => setDiscard(false)}>
              <DateTimeField label="Ended" value={end} onChange={(ms) => pickTime(ms)} />
            </div>

            <p className={`sheet-hint${problem && !discard ? ' error' : ''}`}>
              {discard
                ? 'Nothing is saved.'
                : problem ??
                (tooShort
                  ? 'Under a minute: the timer will be discarded, not saved.'
                  : `Saves ${formatDuration(end - start, false)}, ${hhmm(start)}–${hhmm(end)}.`)}
            </p>

            <IonButton
              expand="block"
              shape="round"
              size="large"
              className="sheet-apply"
              color={discard ? 'medium' : 'danger'}
              disabled={!discard && !!problem}
              onClick={() => (discard ? onDiscard() : onStop(end))}
            >
              <IonIcon slot="start" icon={discard ? trashOutline : stopIcon} />
              {discard ? 'Discard' : `Stop at ${hhmm(end)}`}
            </IonButton>
          </>
        )}
      </IonContent>
    </IonModal>
  );
}
