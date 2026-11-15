import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  IonButton, IonContent, IonIcon, IonPage,
} from '@ionic/react';
import { stop as stopIcon } from 'ionicons/icons';
import AreaPill from '../components/AreaPill';
import SubAreaChips from '../components/SubAreaChips';
import { db } from '../db';
import { useActive, useAreas, useDarkMode, useNow, useSubAreas } from '../hooks';
import { BACKGROUND_TINT, themeBackground, tintOverBackground } from '../color';
import { formatDuration, stop, track } from '../timer';
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
              track(a.id, null);
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
                track(activeArea.id, id);
              }}
            />
          )}

          <IonButton
            className="stop-button"
            shape="round"
            size="large"
            color="danger"
            disabled={!active}
            onClick={() => {
              haptic();
              stop();
            }}
          >
            <IonIcon slot="start" icon={stopIcon} />
            Stop
          </IonButton>

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
