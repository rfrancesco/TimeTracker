import { useEffect, useState } from 'react';
import { IonButton, IonChip, IonContent, IonIcon, IonLabel, IonModal, IonText } from '@ionic/react';
import { play, stop as stopIcon, swapHorizontal, trashOutline } from 'ionicons/icons';
import type { ActiveTimer } from '../db';
import type { AreaView } from '../hooks';
import { iconFor } from '../icons';
import { DateTimeField } from './IntervalEditor';
import { formatDuration, RELABEL_THRESHOLD_MS } from '../timer';

/**
 * What the sheet rewinds:
 * - stop: the running timer ended earlier (or 🗑 discard it)
 * - start: `area` started earlier: while idle, or (when it is the running area) the
 *   running timer started earlier. Never before `min` (end of the latest saved interval).
 * - switch: the running timer ended earlier and `area` ran from then on
 */
export type RewindMode =
  | { kind: 'stop' }
  | { kind: 'start'; area: AreaView; min: number; afterName?: string }
  | { kind: 'switch'; area: AreaView };

interface Props {
  mode: RewindMode;
  active: ActiveTimer | undefined;
  /** The running area (for stop/switch, and "start" of the running area). */
  area: AreaView | undefined;
  subName?: string;
  open: boolean;
  onClose: () => void;
  onStop: (endMs: number) => void;
  onDiscard: () => void;
  onStart: (startMs: number) => void;
  onSwitch: (atMs: number) => void;
}

const MIN = 60_000;
const QUICK = [5, 15, 30, 60];
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const floorMin = (ms: number) => Math.floor(ms / MIN) * MIN;
const quickLabel = (m: number) => (m < 60 ? `${m} min` : '1 h');

/** "I forgot to stop / start / switch": pick when it actually happened. */
export default function StopEarlierSheet({ mode, active, area, subName, open, onClose, onStop, onDiscard, onStart, onSwitch }: Props) {
  const start = active ? new Date(active.start).getTime() : 0;
  const [end, setEnd] = useState(Date.now());
  // 🗑 is one of the choices (stop only); the main button applies whichever is
  // selected, so discarding always takes two deliberate taps.
  const [discard, setDiscard] = useState(false);

  // The earliest allowed moment, per mode.
  const earliest = mode.kind === 'start' ? mode.min : start;
  const isAllowed = (t: number) => (mode.kind === 'stop' ? t > start : t >= earliest);

  useEffect(() => {
    if (!open) return;
    setDiscard(false);
    const nowMin = floorMin(Date.now());
    if (mode.kind === 'stop') setEnd(nowMin);
    else if (mode.kind === 'start') {
      // Right after the last interval when that was recent (the usual "meant to
      // start it right after" case), otherwise 5 minutes ago.
      const recent = Number.isFinite(mode.min) && Date.now() - mode.min <= 60 * MIN;
      setEnd(recent ? mode.min : Math.max(nowMin - 5 * MIN, mode.min));
    } else {
      // The first quick time after the running timer started, else its very start (a relabel).
      const first = QUICK.map((m) => floorMin(Date.now() - m * MIN)).find((t) => t >= start);
      setEnd(first ?? start);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const pickTime = (t: number) => {
    setDiscard(false);
    setEnd(t);
  };

  const now = Date.now();
  const nowMin = floorMin(now);
  const target = mode.kind === 'stop' ? area : mode.area;
  const runningStart = mode.kind === 'start' && active?.areaId === mode.area.id;

  let problem: string | null = null;
  if (end > now) problem = 'That’s in the future';
  else if (mode.kind === 'stop' && end <= start) problem = 'That’s before the timer started';
  else if (mode.kind === 'switch' && end < start) problem = `That’s before ${area?.name ?? 'the timer'} started`;
  else if (mode.kind === 'start' && end < mode.min)
    problem = `That overlaps ${mode.afterName ?? 'saved time'} (until ${hhmm(mode.min)})`;

  let hint: string;
  if (mode.kind === 'stop') {
    hint = discard
      ? 'Nothing is saved.'
      : (problem ??
        (end - start < RELABEL_THRESHOLD_MS
          ? 'Under a minute: the timer will be discarded, not saved.'
          : `Saves ${formatDuration(end - start, false)}, ${hhmm(start)}–${hhmm(end)}.`));
  } else if (mode.kind === 'start') {
    hint =
      problem ??
      (runningStart
        ? `${mode.area.name} since ${hhmm(end)} instead of ${hhmm(start)}.`
        : `Tracks ${mode.area.name} since ${hhmm(end)} (${formatDuration(now - end, false)} ago).`);
  } else {
    hint =
      problem ??
      (end - start < RELABEL_THRESHOLD_MS
        ? `Under a minute of ${area?.name}: the timer becomes ${mode.area.name} since ${hhmm(start)}.`
        : `Saves ${area?.name} ${hhmm(start)}–${hhmm(end)}, then ${mode.area.name} since ${hhmm(end)}.`);
  }

  const title = mode.kind === 'stop' ? 'Stopped earlier?' : mode.kind === 'start' ? 'Started earlier?' : 'Switched earlier?';
  const fieldLabel = mode.kind === 'stop' ? 'Ended' : mode.kind === 'start' ? 'Started' : 'Switched';
  const dot = (a: AreaView) => (
    <span className="dot" style={{ background: a.color, color: a.onColor }}>
      <IonIcon icon={iconFor(a.icon)} />
    </span>
  );

  // Quick choices: "Now" (stop), "After <last area>" (start), then 5/15/30 min and 1 h.
  const quick: Array<{ key: string; label: string; t: number }> = [];
  if (mode.kind === 'stop') quick.push({ key: 'now', label: 'Now', t: nowMin });
  if (mode.kind === 'start' && Number.isFinite(mode.min) && mode.afterName && mode.min <= now)
    quick.push({ key: 'after', label: `After ${mode.afterName}`, t: mode.min });
  for (const m of QUICK) quick.push({ key: String(m), label: quickLabel(m), t: floorMin(now - m * MIN) });

  const ready = (mode.kind === 'stop' && discard) || (!problem && !(mode.kind === 'start' && !target));
  const tinted = mode.kind !== 'stop' && target;

  return (
    <IonModal isOpen={open} onDidDismiss={onClose} initialBreakpoint={0.6} breakpoints={[0, 0.6, 0.9]} className="stop-sheet">
      <IonContent className="ion-padding">
        {target && (mode.kind === 'start' || (active && area)) && (
          <>
            <h2 className="sheet-title">{title}</h2>
            <div className="sheet-running">
              {mode.kind === 'stop' && area && (
                <>
                  {dot(area)}
                  <span>
                    {area.name}
                    {subName ? ` · ${subName}` : ''} <IonText color="medium">· since {hhmm(start)}</IonText>
                  </span>
                </>
              )}
              {mode.kind === 'start' && (
                <>
                  {dot(mode.area)}
                  <span>
                    {mode.area.name}
                    {runningStart && <IonText color="medium"> · since {hhmm(start)}</IonText>}
                  </span>
                </>
              )}
              {mode.kind === 'switch' && area && (
                <>
                  {dot(area)}
                  <span className="sheet-arrow">→</span>
                  {dot(mode.area)}
                  <span>
                    {mode.area.name} <IonText color="medium">· {area.name} since {hhmm(start)}</IonText>
                  </span>
                </>
              )}
            </div>

            {/* One row: the times (scroll sideways if the screen is very narrow) and 🗑 pinned right. */}
            <div className="sheet-quick">
              <div className="sheet-times">
                {quick.map((q) => (
                  <IonChip
                    key={q.key}
                    disabled={!isAllowed(q.t) || q.t > now}
                    outline={discard || end !== q.t}
                    onClick={() => pickTime(q.t)}
                  >
                    <IonLabel>{q.label}</IonLabel>
                  </IonChip>
                ))}
              </div>
              {mode.kind === 'stop' && (
                <IonChip outline={!discard} className="discard-chip" aria-label="Discard this timer" onClick={() => setDiscard(true)}>
                  <IonIcon icon={trashOutline} />
                </IonChip>
              )}
            </div>

            {/* Dimmed while 🗑 is selected, but still tappable: touching it goes back to stopping. */}
            <div className={discard ? 'sheet-dimmed' : undefined} onClickCapture={() => setDiscard(false)}>
              <DateTimeField label={fieldLabel} value={end} onChange={(ms) => pickTime(ms)} />
            </div>

            <p className={`sheet-hint${problem && !discard ? ' error' : ''}`}>{hint}</p>

            <IonButton
              expand="block"
              shape="round"
              size="large"
              className={`sheet-apply${tinted ? ' tinted' : ''}`}
              color={tinted ? undefined : discard ? 'medium' : 'danger'}
              style={tinted ? { ['--background' as string]: target.color, ['--color' as string]: target.onColor } : undefined}
              disabled={!ready}
              onClick={() => {
                if (mode.kind === 'stop') return discard ? onDiscard() : onStop(end);
                if (mode.kind === 'start') return onStart(end);
                return onSwitch(end);
              }}
            >
              <IonIcon
                slot="start"
                icon={mode.kind === 'start' ? play : mode.kind === 'switch' ? swapHorizontal : discard ? trashOutline : stopIcon}
              />
              {mode.kind === 'stop' ? (discard ? 'Discard' : `Stop at ${hhmm(end)}`) : `${mode.kind === 'start' ? 'Start' : 'Switch'} at ${hhmm(end)}`}
            </IonButton>
          </>
        )}
      </IonContent>
    </IonModal>
  );
}
