import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { IonButton, IonContent, IonIcon, IonPage } from '@ionic/react';
import { arrowRedo, arrowUndo, playBack, stop as stopIcon } from 'ionicons/icons';
import AreaPill from '../components/AreaPill';
import SubAreaChips from '../components/SubAreaChips';
import TimerDisplay from '../components/TimerDisplay';
import StopEarlierSheet, { type RewindMode, type SheetAction } from '../components/StopEarlierSheet';
import { db } from '../db';
import { useActive, useAreas, useDarkMode, useNow, useSubAreas, type AreaView } from '../hooks';
import { useToast } from '../toast';
import { BACKGROUND_TINT, themeBackground, tintOverBackground } from '../color';
import {
  discardActive, formatDuration, planRestart, planStart, planStop, planSwitch, restartAt, startAt, stopAt, switchAt, track,
  type Plan,
} from '../timer';
import { recordTimerAction, redo, undo, useUndoRedo } from '../undo';
import { buildReport, periodRange } from '../report';
import { iconFor } from '../icons';
import { ticksInApp } from '../runningTime';
import { haptic } from '../haptics';
import { HOLD_DONE, HOLD_SHOW, useHold } from '../useHold';
import { useOptimisticActive } from '../useOptimisticActive';

/** What a press is holding: Stop, an area, or a sub-area chip of the running area (null = None). */
type HoldTarget = { kind: 'stop' } | { kind: 'area'; area: AreaView } | { kind: 'sub'; area: AreaView; subId: string | null };

export default function TimerPage() {
  const areas = useAreas();
  const allAreas = useAreas(true);
  const subAreas = useSubAreas();
  const { active, showing } = useOptimisticActive(useActive());
  const activeArea = allAreas.find((a) => a.id === active?.areaId);
  const activeSub = subAreas.find((s) => s.id === active?.subAreaId);
  const subsOfActive = subAreas.filter((s) => s.areaId === active?.areaId && !s.archived);
  // Tick every second while the timer ticks, every minute otherwise (keeps "today" correct past midnight).
  const now = useNow(active && ticksInApp(activeArea) ? 1000 : 60_000);
  const dark = useDarkMode();
  const pageBackground = activeArea ? tintOverBackground(activeArea.color, BACKGROUND_TINT, dark) : themeBackground(dark);
  const toast = useToast();
  const { canUndo, canRedo } = useUndoRedo();
  const nameOf = (id: string) => allAreas.find((a) => a.id === id)?.name ?? 'Timer';
  const last = useLiveQuery(() => db.intervals.orderBy('end').last());
  const lastEnd = last ? Date.parse(last.end) : -Infinity;

  // ---- Timer actions: undoable; with a plan, its result shows at once ----
  async function act(label: string, plan: Plan | null, action: () => Promise<unknown>) {
    const run = () => recordTimerAction(label, action);
    await (plan?.ok ? showing(plan.next, run) : run());
  }
  const runningName = active ? nameOf(active.areaId) : 'timer';
  const doTrack = (areaId: string, subAreaId: string | null) =>
    act(`${active ? 'switch to' : 'start'} ${nameOf(areaId)}`, null, () => track(areaId, subAreaId));
  const doStop = () => act(`stop ${runningName}`, planStop(active ?? null, Date.now(), Date.now()), () => stopAt());

  function applySheet(x: SheetAction) {
    setSheetOpen(false);
    const a = active ?? null;
    const t = Date.now();
    if (x.kind === 'stop') return act(`rewind ${runningName}`, planStop(a, x.at, t), () => stopAt(x.at));
    if (x.kind === 'discard') return act(`discard ${runningName}`, { ok: true, next: null, saved: null }, discardActive);
    if (mode.kind === 'stop') return;
    const target = mode.area;
    if (x.kind === 'switch')
      return act(`switch to ${target.name} earlier`, planSwitch(a, target.id, x.subId, x.at, t), () => switchAt(target.id, x.subId, x.at));
    if (a?.areaId === target.id)
      return act(`start ${target.name} earlier`, planRestart(a, x.at, x.subId, lastEnd, t), () => restartAt(x.at, x.subId));
    return act(`start ${target.name} earlier`, planStart(a, target.id, x.subId, x.at, lastEnd, t), () => startAt(target.id, x.subId, x.at));
  }

  async function runHistory(step: typeof undo, word: string) {
    const { ok, label } = await step();
    // Silent on success (the screen shows the result); speak up only if it was refused.
    if (label && !ok) toast(`Can’t ${word}: things changed since`);
  }

  // ---- Tap = now, hold = earlier (Stop, areas, sub-area chips) ----
  // Holding Stop turns it into REWIND; holding an area or sub-area turns the Stop slot
  // into the indicator, in that area's colour (the thumb covers what is held). A
  // completed hold opens the sheet; releasing earlier cancels.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [mode, setMode] = useState<RewindMode>({ kind: 'stop' });
  const hold = useHold<HoldTarget>((t) => {
    haptic('long');
    if (t.kind === 'stop') setMode({ kind: 'stop' });
    else if (t.kind === 'sub') setMode({ kind: 'switch', area: t.area, subId: t.subId });
    else if (active && t.area.id !== active.areaId) setMode({ kind: 'switch', area: t.area });
    else setMode({ kind: 'start', area: t.area, min: lastEnd, afterName: last ? nameOf(last.areaId) : undefined });
    setSheetOpen(true);
  });
  const held = hold.held;
  const areaHold = held && held.kind !== 'stop' ? held.area : null;
  const switching = held?.kind === 'sub' || (held?.kind === 'area' && !!active && held.area.id !== active.areaId);

  // Today's totals (finished intervals + the running one).
  const today = periodRange('day', now);
  const todays = useLiveQuery(() => db.intervals.where('end').above(new Date(today.start).toISOString()).toArray(), [today.start]) ?? [];
  const totals = useMemo(
    () => [...buildReport(today, todays, active, now, null).byArea].sort((x, y) => y[1] - x[1]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [todays, active, now, today.start],
  );

  return (
    <IonPage
      className={`timer-page${activeArea ? ' tracking' : ''}`}
      style={activeArea ? { ['--area-color' as string]: activeArea.color } : undefined}
    >
      <IonContent>
        <div className="timer-layout">
          {/* ↶ ↷ in fixed slots (each fades in only when it has something to do), so a
              button never moves under the finger. */}
          <div className="history-buttons">
            <IonButton
              fill="clear"
              className={`undo-button${canUndo ? ' show' : ''}`}
              aria-label="Undo"
              disabled={!canUndo}
              onClick={() => {
                haptic();
                runHistory(undo, 'undo');
              }}
            >
              <IonIcon slot="icon-only" icon={arrowUndo} />
            </IonButton>
            <IonButton
              fill="clear"
              className={`redo-button${canRedo ? ' show' : ''}`}
              aria-label="Redo"
              disabled={!canRedo}
              onClick={() => {
                haptic();
                runHistory(redo, 'redo');
              }}
            >
              <IonIcon slot="icon-only" icon={arrowRedo} />
            </IonButton>
          </div>

          <TimerDisplay active={active} area={activeArea} subName={activeSub?.name} now={now} />

          <AreaPill
            areas={areas}
            background={pageBackground}
            selectedId={active?.areaId}
            onPressStart={(area) => hold.start({ kind: 'area', area })}
            onPressEnd={hold.end}
            onSelect={(a) => {
              if (hold.wasHold()) return;
              haptic();
              // Re-tapping the running area keeps its sub-area.
              if (a.id === active?.areaId) return;
              doTrack(a.id, null);
            }}
          />

          {activeArea && (
            <SubAreaChips
              subAreas={subsOfActive}
              selectedId={active?.subAreaId ?? null}
              color={activeArea.color}
              allowNone
              // Hold = "switch earlier" to that sub-area (not the current one: nothing to switch to).
              onPressStart={(subId) => {
                if (subId !== (active?.subAreaId ?? null)) hold.start({ kind: 'sub', area: activeArea, subId });
              }}
              onPressEnd={hold.end}
              onSelect={(id) => {
                if (hold.wasHold()) return;
                haptic();
                doTrack(activeArea.id, id);
              }}
            />
          )}

          <div className="stop-wrap">
            <IonButton
              className={`stop-button${held ? ' holding' : ''}${areaHold ? ' area-hold' : ''}`}
              style={{
                ['--fill-ms' as string]: `${HOLD_DONE - HOLD_SHOW}ms`,
                ...(areaHold && { ['--background' as string]: areaHold.color, ['--color' as string]: areaHold.onColor }),
              }}
              shape="round"
              size="large"
              color={areaHold ? undefined : 'danger'}
              disabled={!active && !areaHold}
              onPointerDown={() => hold.start({ kind: 'stop' })}
              onPointerUp={hold.end}
              onPointerLeave={hold.end}
              onPointerCancel={hold.end}
              onContextMenu={(e) => e.preventDefault()}
              onClick={() => {
                if (hold.wasHold()) return;
                haptic();
                doStop();
              }}
            >
              {/* Both labels (icon + text) share one cell, so the button is always as wide
                  as the longer one and each is centred as a group. */}
              <span className="stop-labels">
                <span className={held ? 'off' : undefined}>
                  <IonIcon icon={stopIcon} />
                  Stop
                </span>
                <span className={held?.kind === 'stop' ? undefined : 'off'}>
                  <IonIcon icon={playBack} />
                  Rewind
                </span>
                {areaHold && (
                  <span className="area-hold-label">
                    <IonIcon icon={playBack} />
                    <IonIcon icon={iconFor(areaHold.icon)} />
                    {switching ? 'Switch earlier' : 'Start earlier'}
                  </span>
                )}
              </span>
            </IonButton>
          </div>

          <StopEarlierSheet
            mode={mode}
            active={active}
            area={activeArea}
            subName={activeSub?.name}
            subAreas={subAreas}
            open={sheetOpen}
            onClose={() => setSheetOpen(false)}
            onApply={applySheet}
          />

          {totals.length > 0 && (
            <section className="today-totals">
              <h2>Today</h2>
              {totals.map(([areaId, ms]) => {
                const a = allAreas.find((x) => x.id === areaId);
                if (!a) return null;
                return (
                  <div key={areaId} className="today-row">
                    <span className="dot" style={{ background: a.color, color: a.onColor }}>
                      <IonIcon icon={iconFor(a.icon)} />
                    </span>
                    <span className="name">{a.name}</span>
                    <span className="dur">{formatDuration(ms, false)}</span>
                  </div>
                );
              })}
            </section>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
}
