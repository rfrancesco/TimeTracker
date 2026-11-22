import { useEffect, useState } from 'react';
import { IonButton, IonChip, IonContent, IonIcon, IonLabel, IonModal, IonText } from '@ionic/react';
import { play, stop as stopIcon, swapHorizontal, trashOutline } from 'ionicons/icons';
import type { ActiveTimer, SubArea } from '../db';
import type { AreaView } from '../hooks';
import { iconFor } from '../icons';
import DateTimeField from './DateTimeField';
import SubAreaChips from './SubAreaChips';
import { formatDuration, planRestart, planStart, planStop, planSwitch, sameTimer, type Plan } from '../timer';
import { MINUTE, formatClock as hhmm } from '../time';

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

/** What the main button applies. */
export type SheetAction =
  | { kind: 'stop'; at: number }
  | { kind: 'discard' }
  | { kind: 'start' | 'switch'; at: number; subId: string | null };

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
  onApply: (action: SheetAction) => void;
}

/**
 * The five sheets. Quick times count back from a fixed anchor, named in the label:
 * "ago" = from now (forgot to stop / switch / start while idle), "earlier" = from the
 * running start (holding the running area). Extra chips come first.
 */
type Variant = 'stop' | 'start' | 'restart' | 'switch' | 'subSwitch';
const VARIANTS: Record<Variant, { title: string; field: string; anchor: 'now' | 'start'; extra?: 'now' | 'after' | 'start' }> = {
  stop: { title: 'When did you stop?', field: 'Ended', anchor: 'now', extra: 'now' },
  start: { title: 'When did you start?', field: 'Started', anchor: 'now', extra: 'after' },
  restart: { title: 'When did you start?', field: 'Started', anchor: 'start', extra: 'after' },
  switch: { title: 'When did you switch to {target}?', field: 'Switched', anchor: 'now' },
  subSwitch: { title: 'When did you switch to {target}?', field: 'Switched', anchor: 'now', extra: 'start' },
};
const QUICK = [5, 15, 30, 60];
const quickLabel = (m: number) => (m < 60 ? `${m} min` : '1 h');
const sameMinute = (a: number, b: number) => Math.floor(a / MINUTE) === Math.floor(b / MINUTE);

/** "I forgot to stop / start / switch": pick when it actually happened. */
export default function StopEarlierSheet({ mode, active, area, subName, subAreas, open, onClose, onApply }: Props) {
  const a = active ?? null;
  const start = a ? Date.parse(a.start) : 0;
  const variant: Variant =
    mode.kind === 'stop'
      ? 'stop'
      : mode.kind === 'start'
        ? a?.areaId === mode.area.id
          ? 'restart'
          : 'start'
        : mode.subId !== undefined
          ? 'subSwitch'
          : 'switch';
  const v = VARIANTS[variant];
  const min = mode.kind === 'start' ? mode.min : -Infinity;
  const afterName = mode.kind === 'start' && Number.isFinite(mode.min) ? mode.afterName : undefined;
  const currentSub = a?.subAreaId ?? null;

  // A typed time (minute precision) or, when a chip is selected, that chip: chips are
  // exact offsets ("5 min ago" = now − 5:00, "5 min earlier" = start − 5:00, seconds
  // kept, so the timer moves by exactly 5:00), worked out again at the moment of applying.
  const [typed, setTyped] = useState(Date.now());
  const [chip, setChip] = useState<string | null>(null);
  const [sub, setSub] = useState<string | null>(null);
  // 🗑 is one of the choices (stop only); the main button applies whichever is
  // selected, so discarding always takes two deliberate taps.
  const [discard, setDiscard] = useState(false);
  // Re-render every second while open, so "now"-based chips and the hint stay current.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [open]);

  const chipTime = (key: string, now: number) => {
    if (key === 'now') return now;
    if (key === 'start') return start;
    if (key === 'after') return min;
    return (v.anchor === 'start' ? start : now) - Number(key) * MINUTE;
  };
  /** The outcome of applying moment `t` (with the selected sub-area): the timer rules from timer.ts. */
  const planAt = (t: number, now: number): Plan => {
    if (mode.kind === 'stop') return planStop(a, t, now);
    if (variant === 'restart') return planRestart(a, t, sub, min, now);
    if (mode.kind === 'start') return planStart(a, mode.area.id, sub, t, min, now);
    return planSwitch(a, mode.area.id, sub, t, now);
  };
  // A chip fits if its plan works (and when moving the start: if it is earlier).
  const chipOk = (t: number, now: number) => planAt(t, now).ok && !(variant === 'restart' && t >= start);

  useEffect(() => {
    if (!open) return;
    setDiscard(false);
    setSub(variant === 'restart' ? currentSub : mode.kind === 'switch' ? (mode.subId ?? null) : null);
    const now = Date.now();
    const pick = (key: string | null, t = now) => {
      setChip(key);
      setTyped(t);
    };
    const five = String(QUICK[0]);
    const fiveOk = chipOk(chipTime(five, now), now);
    if (variant === 'subSwitch') pick('start'); // usually the sub-area was just picked late: the whole timer
    else if (variant === 'start' && afterName && (now - min <= 60 * MINUTE || !fiveOk)) pick('after'); // "meant to start it right after"
    else if (fiveOk) pick(five); // the smallest correction
    else if (variant === 'stop') pick('now');
    else if (variant === 'restart' && afterName && min < start) pick('after');
    else pick(null, start); // restart: unchanged; switch: at the start (a relabel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Typed times have minute precision; within the minute of the running start or of the
  // last interval's end they mean exactly that moment (which keeps its seconds).
  const pickTime = (t: number) => {
    setDiscard(false);
    setChip(null);
    setTyped(a && sameMinute(t, start) ? start : Number.isFinite(min) && sameMinute(t, min) ? min : t);
  };
  const pickChip = (key: string) => {
    setDiscard(false);
    setChip(key);
  };

  const now = Date.now();
  const end = chip ? chipTime(chip, now) : typed;
  const plan = planAt(end, now);
  const target = mode.kind === 'stop' ? area : mode.area;
  // Stop and switch need a running timer (it can end while the sheet is open).
  const show = !!target && (mode.kind === 'start' || (!!a && !!area));

  const subLabel = (id: string | null) => subAreas.find((x) => x.id === id)?.name;
  // "Guitar · Songs" (or just "Guitar"); for a sub-area switch the short form "Songs".
  const targetLabel = `${target?.name ?? ''}${mode.kind !== 'stop' && sub ? ` · ${subLabel(sub)}` : ''}`;
  const targetShort = variant === 'subSwitch' ? (subLabel(sub) ?? targetLabel) : targetLabel;
  const runningLabel = `${area?.name ?? ''}${subName ? ` · ${subName}` : ''}`;
  const rowSubs =
    mode.kind === 'stop' || variant === 'subSwitch'
      ? []
      : subAreas.filter((x) => x.areaId === mode.area.id && (!x.archived || x.id === sub)).sort((x, y) => x.order - y.order);

  const unchanged = variant === 'restart' && plan.ok && sameTimer(plan.next, a);
  // Same start, other label: the whole running timer is relabelled.
  const wholeTimer = (variant === 'restart' || mode.kind === 'switch') && end === start;

  let hint: string;
  let problem = false;
  if (discard) hint = 'Nothing is saved.';
  else if (!plan.ok) {
    problem = true;
    hint = {
      future: 'That’s in the future',
      beforeStart: `That’s before ${mode.kind === 'stop' ? 'the timer' : runningLabel} started`,
      overlap: `That overlaps ${afterName ?? 'saved time'} (until ${hhmm(min)})`,
      idle: 'Nothing is running anymore',
      running: 'A timer is running already',
    }[plan.error];
  } else if (variant === 'stop')
    hint = plan.saved
      ? `Saves ${formatDuration(plan.saved.end - plan.saved.start, false)}, ${hhmm(start)}–${hhmm(plan.saved.end)}.`
      : 'Under a minute: the timer will be discarded, not saved.';
  else if (variant === 'start') hint = `Tracks ${targetLabel} since ${hhmm(end)} (${formatDuration(now - end, false)} ago).`;
  else if (unchanged) hint = afterName && start - min < MINUTE ? `Already right after ${afterName}.` : 'That’s the current start.';
  else if (wholeTimer) hint = `The whole timer becomes ${targetLabel}.`;
  else if (variant === 'restart') hint = `${targetLabel} since ${hhmm(end)} instead of ${hhmm(start)}.`;
  else if (!plan.saved) hint = `Under a minute of ${runningLabel}: the timer becomes ${targetLabel} since ${hhmm(start)}.`;
  else hint = `Saves ${runningLabel} ${hhmm(start)}–${hhmm(end)}, then ${targetLabel} since ${hhmm(end)}.`;

  // Quick choices, extra chip first. Ones that don't fit are greyed, not hidden, so every chip keeps its place.
  const extra = { now: 'Now', after: afterName && `After ${afterName}`, start: 'From the start' };
  const quick = [
    ...(v.extra && extra[v.extra] ? [{ key: v.extra, label: extra[v.extra] as string }] : []),
    ...QUICK.map((m) => ({ key: String(m), label: `${quickLabel(m)} ${v.anchor === 'start' ? 'earlier' : 'ago'}` })),
  ];

  const tinted = mode.kind !== 'stop';
  const dot = (x: AreaView) => (
    <span className="dot" style={{ background: x.color, color: x.onColor }}>
      <IonIcon icon={iconFor(x.icon)} />
    </span>
  );

  return (
    <IonModal isOpen={open} onDidDismiss={onClose} initialBreakpoint={0.6} breakpoints={[0, 0.6, 0.9]} className="stop-sheet">
      <IonContent className="ion-padding">
        {show && target && (
          <>
        <h2 className="sheet-title">{v.title.replace('{target}', variant === 'subSwitch' ? targetShort : target.name)}</h2>
        <div className="sheet-running">
          {mode.kind === 'switch' && area && (
            <>
              {dot(area)}
              <span className="sheet-arrow">→</span>
            </>
          )}
          {dot(target)}
          <span>
            {mode.kind === 'stop' ? runningLabel : mode.kind === 'switch' ? targetShort : targetLabel}{' '}
            <IonText color="medium">
              {mode.kind === 'stop' && `· since ${hhmm(start)}`}
              {variant === 'restart' && `· started at ${hhmm(start)}`}
              {mode.kind === 'switch' && `· ${runningLabel} since ${hhmm(start)}`}
            </IonText>
          </span>
        </div>

        {rowSubs.length > 0 && <SubAreaChips subAreas={rowSubs} selectedId={sub} color={target.color} allowNone onSelect={setSub} />}

        {/* The times (wrapping onto a second line on narrow phones) and 🗑 at the right of the first line. */}
        <div className="sheet-quick">
          <div className="sheet-times">
            {quick.map((q) => (
              <IonChip key={q.key} disabled={!chipOk(chipTime(q.key, now), now)} outline={discard || chip !== q.key} onClick={() => pickChip(q.key)}>
                <IonLabel>{q.label}</IonLabel>
              </IonChip>
            ))}
          </div>
          {variant === 'stop' && (
            <IonChip outline={!discard} className="discard-chip" aria-label="Discard this timer" onClick={() => setDiscard(true)}>
              <IonIcon icon={trashOutline} />
            </IonChip>
          )}
        </div>

        {/* Dimmed while 🗑 is selected, but still tappable: touching it goes back to stopping. */}
        <div className={discard ? 'sheet-dimmed' : undefined} onClickCapture={() => setDiscard(false)}>
          <DateTimeField label={v.field} value={end} onChange={pickTime} />
        </div>

        <p className={`sheet-hint${problem ? ' error' : ''}`}>{hint}</p>

        <IonButton
          expand="block"
          shape="round"
          size="large"
          className={`sheet-apply${tinted ? ' tinted' : ''}`}
          color={tinted ? undefined : discard ? 'medium' : 'danger'}
          style={tinted ? { ['--background' as string]: target.color, ['--color' as string]: target.onColor } : undefined}
          disabled={!discard && (!plan.ok || unchanged)}
          onClick={() => {
            if (discard) return onApply({ kind: 'discard' });
            // A chip is worked out at this moment ("5 min ago" = exactly 5:00 before the tap).
            const at = chip ? Math.min(chipTime(chip, Date.now()), Date.now()) : end;
            onApply(mode.kind === 'stop' ? { kind: 'stop', at } : { kind: mode.kind, at, subId: sub });
          }}
        >
          <IonIcon slot="start" icon={mode.kind === 'start' ? play : mode.kind === 'switch' ? swapHorizontal : discard ? trashOutline : stopIcon} />
          {mode.kind === 'stop'
            ? discard
              ? 'Discard'
              : `Stop at ${hhmm(end)}`
            : wholeTimer
              ? `${subLabel(sub) ?? target.name} since ${hhmm(start)}`
              : `${mode.kind === 'start' ? 'Start' : 'Switch'} at ${hhmm(end)}`}
        </IonButton>
          </>
        )}
      </IonContent>
    </IonModal>
  );
}
