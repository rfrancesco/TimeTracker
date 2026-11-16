import { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  IonButton, IonContent, IonIcon, IonPage,
} from '@ionic/react';
import { arrowRedo, arrowUndo, playBack, stop as stopIcon } from 'ionicons/icons';
import AreaPill from '../components/AreaPill';
import SubAreaChips from '../components/SubAreaChips';
import { db } from '../db';
import { useActive, useAreas, useDarkMode, useNow, useSubAreas, useToast } from '../hooks';
import StopEarlierSheet from '../components/StopEarlierSheet';
import { BACKGROUND_TINT, themeBackground, tintOverBackground } from '../color';
import { discardActive, formatDuration, stopAt, track } from '../timer';
import { recordTimerAction, toggleUndo, useUndoState } from '../undo';
import { iconFor } from '../icons';
import { startOfLocalDay } from '../time';

const haptic = () => navigator.vibrate?.(12);


export default function TimerPage() {
  const areas = useAreas();
  const allAreas = useAreas(true);
  const subAreas = useSubAreas();
  const active = useActive();
  // Tick every second while tracking, every minute otherwise (keeps "today" correct past midnight).
  const now = useNow(active ? 1000 : 60_000);

  const activeArea = allAreas.find((a) => a.id === active?.areaId);
  const dark = useDarkMode();
  const pageBackground = activeArea ? tintOverBackground(activeArea.color, BACKGROUND_TINT, dark) : themeBackground(dark);
  const activeSub = subAreas.find((s) => s.id === active?.subAreaId);

  // ---- Stop: tap stops now; long-press opens "Stopped earlier?" ----
  const toast = useToast();
  const [stopSheet, setStopSheet] = useState(false);
  const pressTimer = useRef<number | undefined>(undefined);
  const longPressed = useRef(false);

  // ---- Undo: ↶ undoes the latest timer action; tapped again (↷) it redoes it ----
  const undoState = useUndoState();
  const nameOf = (id: string) => allAreas.find((a) => a.id === id)?.name ?? 'Timer';

  async function doTrack(areaId: string, subAreaId: string | null) {
    await recordTimerAction(`${active ? 'switch to' : 'start'} ${nameOf(areaId)}`, () => track(areaId, subAreaId));
  }

  async function doStop(endMs?: number) {
    const name = active ? nameOf(active.areaId) : 'timer';
    await recordTimerAction(`${endMs !== undefined ? 'rewind' : 'stop'} ${name}`, () => stopAt(endMs));
  }

  async function doDiscard() {
    const name = active ? nameOf(active.areaId) : 'timer';
    await recordTimerAction(`discard ${name}`, () => discardActive());
  }

  async function runUndo() {
    const { ok, label } = await toggleUndo();
    // Silent on success (the screen shows the result); speak up only if it was refused.
    if (label && !ok) toast('Can’t undo: things changed since');
  }
  // A press that lasts past HOLD_SHOW turns the button into REWIND and starts the
  // fill (a tap never gets there); at HOLD_DONE the "Stopped earlier?" sheet opens.
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
      navigator.vibrate?.(25);
      setHolding(false);
      setStopSheet(true);
    }, HOLD_DONE);
  };
  const cancelPress = () => {
    window.clearTimeout(pressTimer.current);
    window.clearTimeout(showTimer.current);
    setHolding(false);
  };
  const subsOfActive = subAreas.filter((s) => s.areaId === active?.areaId && !s.archived);
  const elapsed = active ? now - new Date(active.start).getTime() : 0;


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
          {/* Undo the latest timer action (then redo it); only there when there is one. */}
          <IonButton
            fill="clear"
            className={`undo-button${undoState ? ' show' : ''}`}
            aria-label={undoState === 'redo' ? 'Redo' : 'Undo'}
            disabled={!undoState}
            onClick={() => {
              haptic();
              runUndo();
            }}
          >
            <IonIcon slot="icon-only" icon={undoState === 'redo' ? arrowRedo : arrowUndo} />
          </IonButton>
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
                <div className="timer-digits">{formatDuration(elapsed)}</div>
                <div className="timer-since">
                  since {new Date(active.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </>
            ) : (
              <>
                <div className="timer-digits idle">0:00:00</div>
                <div className="timer-since">Tap an area to start tracking</div>
              </>
            )}
          </section>

          <AreaPill
            areas={areas}
            background={pageBackground}
            selectedId={active?.areaId}
            onSelect={(a) => {
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
              className={`stop-button${holding ? ' holding' : ''}`}
              style={{ ['--fill-ms' as string]: `${HOLD_DONE - HOLD_SHOW}ms` }}
              shape="round"
              size="large"
              color="danger"
              disabled={!active}
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
                <span className={holding ? 'off' : undefined}>
                  <IonIcon icon={stopIcon} />
                  Stop
                </span>
                <span className={holding ? undefined : 'off'}>
                  <IonIcon icon={playBack} />
                  Rewind
                </span>
              </span>
            </IonButton>
          </div>

          <StopEarlierSheet
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
