import { useEffect, useState } from 'react';
import { IonButton, IonChip, IonContent, IonIcon, IonLabel, IonModal, IonText } from '@ionic/react';
import { play, stop as stopIcon, swapHorizontal, trashOutline } from 'ionicons/icons';
import type { ActiveTimer, SubArea } from '../db';
import SubAreaChips from './SubAreaChips';
import type { AreaView } from '../hooks';
import { iconFor } from '../icons';
import { DateTimeField } from './IntervalEditor';
import { formatDuration, RELABEL_THRESHOLD_MS } from '../timer';

/**
 * What the sheet rewinds:
 * - stop: the running timer ended earlier (or 🗑 discard it)
 * - start: `area` started earlier: while idle, or (when it is the running area) the
 *   running timer started earlier. Never before `min` (end of the latest saved interval).
 * - switch: the running timer ended earlier and `area` ran from then on. With `subId`
 *   (holding a sub-area chip), `area` is the running area and only the sub-area changes
 *   (`null` = none); its first chip is "From the start" (= relabel the whole timer).
 * Start and switch to an area with sub-areas show them as a row (the running area's
 * current one preselected), so the sub-area can be set in the same step.
 */
export type RewindMode =
  | { kind: 'stop' }
  | { kind: 'start'; area: AreaView; min: number; afterName?: string }
  | { kind: 'switch'; area: AreaView; subId?: string | null };

interface Props {
  mode: RewindMode;
  active: ActiveTimer | undefined;
  /** The running area (for stop/switch, and "start" of the running area). */
  area: AreaView | undefined;
  subName?: string;
  /** All sub-areas (the sheet picks the target area's). */
  subAreas: SubArea[];
  open: boolean;
  onClose: () => void;
  onStop: (endMs: number) => void;
  onDiscard: () => void;
  onStart: (startMs: number, subAreaId: string | null) => void;
  onSwitch: (atMs: number, subAreaId: string | null) => void;
}

const MIN = 60_000;
const QUICK = [5, 15, 30, 60];
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const quickLabel = (m: number) => (m < 60 ? `${m} min` : '1 h');

/** "I forgot to stop / start / switch": pick when it actually happened. */
export default function StopEarlierSheet({ mode, active, area, subName, subAreas, open, onClose, onStop, onDiscard, onStart, onSwitch }: Props) {
  const start = active ? new Date(active.start).getTime() : 0;
  // A typed time (minute precision) or, when a chip is selected, that chip: chips are
  // exact offsets ("5 min ago" = now − 5:00, "5 min earlier" = start − 5:00, seconds
  // kept, so the timer moves by exactly 5:00), worked out again at the moment of applying.
  const [typedEnd, setEnd] = useState(Date.now());
  const [chip, setChip] = useState<string | null>(null);
  const [sub, setSub] = useState<string | null>(null);
  // Re-render every second while open, so "now"-based chips and the hint stay current.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [open]);
  // 🗑 is one of the choices (stop only); the main button applies whichever is
  // selected, so discarding always takes two deliberate taps.
  const [discard, setDiscard] = useState(false);

  // The earliest allowed moment, per mode.
  const earliest = mode.kind === 'start' ? mode.min : start;
  const isAllowed = (t: number) => (mode.kind === 'stop' ? t > start : t >= earliest);
  const runningStart = mode.kind === 'start' && active?.areaId === mode.area.id;
  const hasAfter = mode.kind === 'start' && Number.isFinite(mode.min) && !!mode.afterName;
  const subOnly = mode.kind === 'switch' && mode.subId !== undefined;
  const currentSub = active?.subAreaId ?? null;

  /**
   * The moment a chip stands for. Quick times count back from a fixed anchor per mode,
   * named in the label: "ago" = from now (forgot to stop / switch / start while idle),
   * "earlier" = from the running timer's start (holding the running area).
   */
  const chipTime = (key: string, now: number) => {
    if (key === 'now') return now;
    if (key === 'start') return start;
    if (key === 'after') return mode.kind === 'start' ? mode.min : now;
    return (runningStart ? start : now) - Number(key) * MIN;
  };

  useEffect(() => {
    if (!open) return;
    setDiscard(false);
    setSub(runningStart ? currentSub : mode.kind === 'switch' && mode.subId !== undefined ? mode.subId : null);
    const now = Date.now();
    // The smallest correction that fits, else the closest valid moment.
    const five = isAllowed(chipTime(String(QUICK[0]), now));
    const pick = (key: string | null, t = now) => {
      setChip(key);
      setEnd(t);
    };
    if (mode.kind === 'stop') pick(five ? String(QUICK[0]) : 'now');
    else if (runningStart) {
      // 5 min earlier than the current start; else right after the last interval; else unchanged.
      if (five) pick(String(QUICK[0]));
      else if (hasAfter && mode.min < start) pick('after');
      else pick(null, start);
    } else if (mode.kind === 'start') {
      // Right after the last interval when that was recent (the usual "meant to
      // start it right after" case), otherwise 5 minutes ago.
      const recent = hasAfter && now - mode.min <= 60 * MIN;
      pick(recent || (!five && hasAfter) ? 'after' : String(QUICK[0]));
    } else if (subOnly) {
      // Usually the sub-area was just picked late: the whole timer.
      pick('start');
    } else {
      // 5 min ago if the running timer started before that, else its very start (a relabel).
      if (five) pick(String(QUICK[0]));
      else pick(null, start);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // Typed times have minute precision; within the minute of the running start or of the
  // last interval's end they mean exactly that moment (which keeps its seconds).
  const sameMinute = (a: number, b: number) => Math.floor(a / MIN) === Math.floor(b / MIN);
  const pickTime = (t: number) => {
    setDiscard(false);
    setChip(null);
    if (active && sameMinute(t, start)) t = start;
    else if (mode.kind === 'start' && Number.isFinite(mode.min) && sameMinute(t, mode.min)) t = mode.min;
    setEnd(t);
  };
  const pickChip = (key: string) => {
    setDiscard(false);
    setChip(key);
  };

  const now = Date.now();
  const end = chip ? chipTime(chip, now) : typedEnd;
  const target = mode.kind === 'stop' ? area : mode.area;
  // Holding the running area when it already starts right after the last interval:
  // nothing earlier is possible (a later start can still be typed).
  const nothingEarlier = runningStart && mode.kind === 'start' && start - mode.min < MIN;
  const subChanged = sub !== currentSub;
  const unchanged = runningStart && end === start && !subChanged;
  const subLabel = (id: string | null) => subAreas.find((x) => x.id === id)?.name;
  // "Guitar · Songs" (or just "Guitar"), and for a sub-area switch the short form "Songs".
  const targetLabel = mode.kind === 'stop' ? '' : `${mode.area.name}${sub ? ` · ${subLabel(sub)}` : ''}`;
  const targetShort = subOnly && mode.kind === 'switch' ? (subLabel(sub) ?? mode.area.name) : targetLabel;
  const runningLabel = `${area?.name ?? ''}${subName ? ` · ${subName}` : ''}`;
  const rowSubs =
    mode.kind === 'stop' || subOnly
      ? []
      : subAreas.filter((x) => x.areaId === mode.area.id && (!x.archived || x.id === sub)).sort((a, b) => a.order - b.order);

  let problem: string | null = null;
  if (end > now) problem = 'That’s in the future';
  else if (mode.kind === 'stop' && end <= start) problem = 'That’s before the timer started';
  else if (mode.kind === 'switch' && end < start) problem = `That’s before ${runningLabel || 'the timer'} started`;
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
      (unchanged
        ? nothingEarlier
          ? `Already right after ${mode.afterName ?? 'the last interval'}.`
          : `That’s the current start.`
        : runningStart
          ? end === start
            ? `The whole timer becomes ${targetLabel}.`
            : `${targetLabel} since ${hhmm(end)} instead of ${hhmm(start)}.`
          : `Tracks ${targetLabel} since ${hhmm(end)} (${formatDuration(now - end, false)} ago).`);
  } else {
    hint =
      problem ??
      (end === start
        ? `The whole timer becomes ${targetLabel}.`
        : end - start < RELABEL_THRESHOLD_MS
          ? `Under a minute of ${runningLabel}: the timer becomes ${targetLabel} since ${hhmm(start)}.`
          : `Saves ${runningLabel} ${hhmm(start)}–${hhmm(end)}, then ${targetLabel} since ${hhmm(end)}.`);
  }

  const title =
    mode.kind === 'stop' ? 'When did you stop?' : mode.kind === 'start' ? 'When did you start?' : `When did you switch to ${subOnly ? targetShort : mode.area.name}?`;
  const fieldLabel = mode.kind === 'stop' ? 'Ended' : mode.kind === 'start' ? 'Started' : 'Switched';
  const dot = (a: AreaView) => (
    <span className="dot" style={{ background: a.color, color: a.onColor }}>
      <IonIcon icon={iconFor(a.icon)} />
    </span>
  );

  // Quick choices: "Now" (stop), "After <last area>" (start), then 5/15/30 min and 1 h
  // (ago, or earlier than the running start). Ones that don't fit are greyed, not hidden,
  // so every chip keeps its place.
  const quick: Array<{ key: string; label: string; t: number }> = [];
  if (mode.kind === 'stop') quick.push({ key: 'now', label: 'Now', t: now });
  if (subOnly) quick.push({ key: 'start', label: 'From the start', t: start });
  if (hasAfter && mode.kind === 'start' && mode.min <= now) quick.push({ key: 'after', label: `After ${mode.afterName}`, t: mode.min });
  for (const m of QUICK)
    quick.push({ key: String(m), label: `${quickLabel(m)} ${runningStart ? 'earlier' : 'ago'}`, t: chipTime(String(m), now) });
  const chipOk = (t: number) => isAllowed(t) && t <= now && !(runningStart && t >= start);

  const ready = (mode.kind === 'stop' && discard) || (!problem && !unchanged && !(mode.kind === 'start' && !target));
  const tinted = mode.kind !== 'stop' && target;
  // Same start, other area/sub-area: the whole running timer is relabelled.
  const wholeTimer = (runningStart || mode.kind === 'switch') && !!active && end === start;

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
                    {targetLabel}
                    {runningStart && <IonText color="medium"> · started at {hhmm(start)}</IonText>}
                  </span>
                </>
              )}
              {mode.kind === 'switch' && area && (
                <>
                  {dot(area)}
                  <span className="sheet-arrow">→</span>
                  {dot(mode.area)}
                  <span>
                    {targetShort} <IonText color="medium">· {runningLabel} since {hhmm(start)}</IonText>
                  </span>
                </>
              )}
            </div>

            {mode.kind !== 'stop' && rowSubs.length > 0 && (
              <SubAreaChips subAreas={rowSubs} selectedId={sub} color={mode.area.color} allowNone onSelect={setSub} />
            )}

            {/* One row: the times (scroll sideways if the screen is very narrow) and 🗑 pinned right. */}
            <div className="sheet-quick">
              <div className="sheet-times">
                {quick.map((q) => (
                  <IonChip
                    key={q.key}
                    disabled={!chipOk(q.t)}
                    outline={discard || chip !== q.key}
                    onClick={() => pickChip(q.key)}
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
                // A chip is worked out at this moment ("5 min ago" = exactly 5:00 before the tap).
                const at = chip ? Math.min(chipTime(chip, Date.now()), Date.now()) : end;
                if (mode.kind === 'stop') return discard ? onDiscard() : onStop(at);
                if (mode.kind === 'start') return onStart(at, sub);
                return onSwitch(at, sub);
              }}
            >
              <IonIcon
                slot="start"
                icon={mode.kind === 'start' ? play : mode.kind === 'switch' ? swapHorizontal : discard ? trashOutline : stopIcon}
              />
              {mode.kind === 'stop'
                ? discard
                  ? 'Discard'
                  : `Stop at ${hhmm(end)}`
                : wholeTimer
                  ? `${subLabel(sub) ?? mode.area.name} since ${hhmm(start)}`
                  : `${mode.kind === 'start' ? 'Start' : 'Switch'} at ${hhmm(end)}`}
            </IonButton>
          </>
        )}
      </IonContent>
    </IonModal>
  );
}
