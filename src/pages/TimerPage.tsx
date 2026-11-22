import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  IonButton, IonContent, IonIcon, IonPage,
} from '@ionic/react';
import { arrowRedo, arrowUndo, playBack, stop as stopIcon } from 'ionicons/icons';
import AreaPill from '../components/AreaPill';
import SubAreaChips from '../components/SubAreaChips';
import { db, type ActiveTimer } from '../db';
import { useActive, useAreas, useDarkMode, useNow, useSubAreas, useToast, type AreaView } from '../hooks';
import StopEarlierSheet, { type RewindMode } from '../components/StopEarlierSheet';
import { BACKGROUND_TINT, themeBackground, tintOverBackground } from '../color';
import { discardActive, formatDuration, RELABEL_THRESHOLD_MS, restartAt, startAt, stopAt, switchAt, track } from '../timer';
import { recordTimerAction, redo, undo, useUndoRedo } from '../undo';
import { iconFor } from '../icons';
import { startOfLocalDay } from '../time';
import { ticksInApp } from '../runningTime';
import { haptic } from '../haptics';



export default function TimerPage() {
  const areas = useAreas();
  const allAreas = useAreas(true);
  const subAreas = useSubAreas();
  const dbActive = useActive();
  // What a sheet action is about to store, shown at once: on the phone the undo
  // snapshots + write take a noticeable moment, and the timer shouldn't lag the tap.
  // Dropped once the database says the same (the live query can trail the action by a
  // moment, so not simply when it resolves), at once if the action fails, and after a
  // second in any case.
  const [pending, setPending] = useState<{ active: ActiveTimer | null } | null>(null);
  const active = pending ? (pending.active ?? undefined) : dbActive;
  useEffect(() => {
    const key = (a: ActiveTimer | null | undefined) => (a ? `${a.areaId} ${a.subAreaId} ${Date.parse(a.start)}` : '');
    if (pending && key(dbActive) === key(pending.active)) setPending(null);
  }, [dbActive, pending]);
  async function showing<T>(next: ActiveTimer | null, action: () => Promise<T>) {
    const mine = { active: next };
    setPending(mine);
    const drop = () => setPending((p) => (p === mine ? null : p));
    try {
      const result = await action();
      window.setTimeout(drop, 1000);
      return result;
    } catch (e) {
      drop();
      throw e;
    }
  }
  // Tick every second while tracking, every minute otherwise (keeps "today" correct past midnight).
  const now = useNow(active && ticksInApp(allAreas.find((a) => a.id === active.areaId)) ? 1000 : 60_000);

  const activeArea = allAreas.find((a) => a.id === active?.areaId);
  const dark = useDarkMode();
  const pageBackground = activeArea ? tintOverBackground(activeArea.color, BACKGROUND_TINT, dark) : themeBackground(dark);
  const activeSub = subAreas.find((s) => s.id === active?.subAreaId);

  // ---- Stop: tap stops now; long-press opens "When did you stop?" ----
  const toast = useToast();
  const [stopSheet, setStopSheet] = useState(false);
  const pressTimer = useRef<number | undefined>(undefined);
  const longPressed = useRef(false);

  // ---- Undo/redo: ↶ walks back through recent timer actions, ↷ forward again ----
  const { canUndo, canRedo } = useUndoRedo();
  const nameOf = (id: string) => allAreas.find((a) => a.id === id)?.name ?? 'Timer';

  async function doTrack(areaId: string, subAreaId: string | null) {
    await recordTimerAction(`${active ? 'switch to' : 'start'} ${nameOf(areaId)}`, () => track(areaId, subAreaId));
  }

  async function doStop(endMs?: number) {
    const name = active ? nameOf(active.areaId) : 'timer';
    await showing(null, () => recordTimerAction(`${endMs !== undefined ? 'rewind' : 'stop'} ${name}`, () => stopAt(endMs)));
  }

  async function doDiscard() {
    const name = active ? nameOf(active.areaId) : 'timer';
    await showing(null, () => recordTimerAction(`discard ${name}`, () => discardActive()));
  }

  async function runHistory(step: typeof undo, word: string) {
    const { ok, label } = await step();
    // Silent on success (the screen shows the result); speak up only if it was refused.
    if (label && !ok) toast(`Can’t ${word}: things changed since`);
  }
  // A press that lasts past HOLD_SHOW turns the button into REWIND and starts the
  // fill (a tap never gets there); at HOLD_DONE the "When did you stop?" sheet opens.
  // Releasing after the label changed cancels instead of stopping.
  const HOLD_SHOW = 150;
  const HOLD_DONE = 550;
  const [holding, setHolding] = useState(false);
  const showTimer = useRef<number | undefined>(undefined);
  const holdShown = useRef(false);
  const startPress = () => {
    longPressed.current = false;
    holdShown.current = false;
    window.clearTimeout(pressTimer.current);
    window.clearTimeout(showTimer.current);
    showTimer.current = window.setTimeout(() => {
      holdShown.current = true;
      setHolding(true);
    }, HOLD_SHOW);
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      haptic('long');
      setHolding(false);
      setMode({ kind: 'stop' });
      setStopSheet(true);
    }, HOLD_DONE);
  };
  const cancelPress = () => {
    window.clearTimeout(pressTimer.current);
    window.clearTimeout(showTimer.current);
    setHolding(false);
  };

  // ---- Hold an area: "earlier" (start earlier while idle, switch earlier while
  // running, or move the start of the running area). Same timings as Stop; the Stop
  // slot shows the progress, in the held area's colour (the thumb covers the area).
  const [mode, setMode] = useState<RewindMode>({ kind: 'stop' });
  const [areaHold, setAreaHold] = useState<AreaView | null>(null);
  const areaShowTimer = useRef<number | undefined>(undefined);
  const areaDoneTimer = useRef<number | undefined>(undefined);
  const areaHoldUsed = useRef(false); // the press became a hold: the click that follows is not a tap
  const last = useLiveQuery(() => db.intervals.orderBy('end').last());
  const lastEnd = last ? Date.parse(last.end) : -Infinity;
  const startAreaPress = (a: AreaView) => {
    areaHoldUsed.current = false;
    window.clearTimeout(areaShowTimer.current);
    window.clearTimeout(areaDoneTimer.current);
    areaShowTimer.current = window.setTimeout(() => {
      areaHoldUsed.current = true;
      setAreaHold(a);
    }, HOLD_SHOW);
    areaDoneTimer.current = window.setTimeout(() => {
      haptic('long');
      setAreaHold(null);
      const switching = active && a.id !== active.areaId;
      setMode(switching ? { kind: 'switch', area: a } : { kind: 'start', area: a, min: lastEnd, afterName: last ? nameOf(last.areaId) : undefined });
      setStopSheet(true);
    }, HOLD_DONE);
  };
  const endAreaPress = () => {
    window.clearTimeout(areaShowTimer.current);
    window.clearTimeout(areaDoneTimer.current);
    setAreaHold(null);
  };
  const areaHoldLabel = areaHold && (active && areaHold.id !== active.areaId ? 'Switch earlier' : 'Start earlier');

  async function doStartEarlier(a: AreaView, ms: number) {
    const start = new Date(ms).toISOString();
    if (active?.areaId === a.id) await showing({ ...active, start }, () => recordTimerAction(`start ${a.name} earlier`, () => restartAt(ms)));
    else await showing({ key: 'current', areaId: a.id, subAreaId: null, start }, () => recordTimerAction(`start ${a.name} earlier`, () => startAt(a.id, null, ms)));
  }
  async function doSwitchEarlier(a: AreaView, ms: number) {
    // Same outcome as switchAt: a relabel under a minute after the start, else a new timer at `ms`.
    const next: ActiveTimer | null = !active
      ? null
      : ms - Date.parse(active.start) < RELABEL_THRESHOLD_MS
        ? { ...active, areaId: a.id, subAreaId: null }
        : { key: 'current', areaId: a.id, subAreaId: null, start: new Date(ms).toISOString() };
    await showing(next, () => recordTimerAction(`switch to ${a.name} earlier`, () => switchAt(a.id, null, ms)));
  }
  const subsOfActive = subAreas.filter((s) => s.areaId === active?.areaId && !s.archived);
  // The current moment, not the last tick's: right after a change the digits are exact.
  const elapsed = active ? Math.max(now, Date.now()) - new Date(active.start).getTime() : 0;
  const ticking = ticksInApp(activeArea);
  const sinceText = active ? new Date(active.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';


  // Today's totals (finished intervals + running one).
  const dayStart = startOfLocalDay(now).toISOString();
  const todays = useLiveQuery(() => db.intervals.where('end').above(dayStart).toArray(), [dayStart]) ?? [];
  const totals = useMemo(() => {
    const m = new Map<string, number>();
    const ds = new Date(dayStart).getTime();
    for (const i of todays) {
      const ms = new Date(i.end).getTime() - Math.max(ds, new Date(i.start).getTime());
      m.set(i.areaId, (m.get(i.areaId) ?? 0) + ms);
    }
    if (active) {
      const ms = now - Math.max(ds, new Date(active.start).getTime());
      m.set(active.areaId, (m.get(active.areaId) ?? 0) + ms);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [todays, active, now, dayStart]);

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
          <section className="timer-display" aria-live="polite">
            {active && activeArea ? (
              <>
                <div className="timer-label">
                  <IonIcon icon={iconFor(activeArea.icon)} />
                  <span>
                    {activeArea.name}
                    {activeSub ? ` · ${activeSub.name}` : ''}
                  </span>
                </div>
                {/* One structure for every state: a caption above one big number. Running
                    time off (e.g. Sleep): the start time, muted, instead of the ticking digits. */}
                <div className="timer-caption">{ticking ? `Started at ${sinceText}` : 'Started at'}</div>
                <div className={`timer-digits${ticking ? '' : ' quiet'}`}>{ticking ? formatDuration(elapsed) : sinceText}</div>
              </>
            ) : (
              <>
                {/* Invisible stand-in for the area name, so the caption and number sit
                    on exactly the same lines as in the running states. */}
                <div className="timer-label placeholder" aria-hidden>
                  <IonIcon icon={iconFor('moon')} />
                  <span>Timer</span>
                </div>
                <div className="timer-caption">Tap an area to start</div>
                <div className="timer-digits idle">0:00:00</div>
              </>
            )}
          </section>

          <AreaPill
            areas={areas}
            background={pageBackground}
            selectedId={active?.areaId}
            onPressStart={startAreaPress}
            onPressEnd={endAreaPress}
            onSelect={(a) => {
              if (areaHoldUsed.current) {
                // The press became a hold (sheet opened, or released early = cancelled): not a tap.
                areaHoldUsed.current = false;
                return;
              }
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
              onSelect={(id) => {
                haptic();
                doTrack(activeArea.id, id);
              }}
            />
          )}

          <div className="stop-wrap">
            <IonButton
              className={`stop-button${holding || areaHold ? ' holding' : ''}${areaHold ? ' area-hold' : ''}`}
              style={{
                ['--fill-ms' as string]: `${HOLD_DONE - HOLD_SHOW}ms`,
                ...(areaHold && { ['--background' as string]: areaHold.color, ['--color' as string]: areaHold.onColor }),
              }}
              shape="round"
              size="large"
              color={areaHold ? undefined : 'danger'}
              disabled={!active && !areaHold}
              onPointerDown={startPress}
              onPointerUp={cancelPress}
              onPointerLeave={cancelPress}
              onPointerCancel={cancelPress}
              onContextMenu={(e) => e.preventDefault()}
              onClick={() => {
                if (longPressed.current || holdShown.current) {
                  // The hold opened the sheet, or was released early (cancelled): not a tap.
                  longPressed.current = false;
                  holdShown.current = false;
                  return;
                }
                haptic();
                doStop();
              }}
            >
              {/* Both labels (icon + text) share one cell, so the button is always as wide
                  as the longer one and each is centred as a group. */}
              <span className="stop-labels">
                <span className={holding || areaHold ? 'off' : undefined}>
                  <IonIcon icon={stopIcon} />
                  Stop
                </span>
                <span className={holding && !areaHold ? undefined : 'off'}>
                  <IonIcon icon={playBack} />
                  Rewind
                </span>
                {areaHold && (
                  <span className="area-hold-label">
                    <IonIcon icon={playBack} />
                    <IonIcon icon={iconFor(areaHold.icon)} />
                    {areaHoldLabel}
                  </span>
                )}
              </span>
            </IonButton>
          </div>

          <StopEarlierSheet
            mode={mode}
            onStart={(ms) => {
              setStopSheet(false);
              if (mode.kind === 'start') doStartEarlier(mode.area, ms);
            }}
            onSwitch={(ms) => {
              setStopSheet(false);
              if (mode.kind === 'switch') doSwitchEarlier(mode.area, ms);
            }}
            active={active}
            area={activeArea}
            subName={activeSub?.name}
            open={stopSheet}
            onClose={() => setStopSheet(false)}
            onDiscard={() => {
              setStopSheet(false);
              doDiscard();
            }}
            onStop={(endMs) => {
              setStopSheet(false);
              doStop(endMs);
            }}
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
