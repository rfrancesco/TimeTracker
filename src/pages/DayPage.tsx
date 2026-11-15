import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  IonButton, IonButtons, IonContent, IonFab, IonFabButton, IonHeader, IonIcon, IonPage, IonTitle, IonToolbar,
} from '@ionic/react';
import { add, chevronBack, chevronForward, todayOutline } from 'ionicons/icons';
import IntervalEditor, { type EditorValue } from '../components/IntervalEditor';
import { db, nowIso, type Interval } from '../db';
import { useActive, useAreas, useNow, useSubAreas } from '../hooks';
import { iconFor } from '../icons';
import { formatDuration } from '../timer';

const PX_PER_MIN = 1.2;
const MIN = 60_000;
const SNAP_MIN = 5;
const DAY_HEIGHT = 24 * 60 * PX_PER_MIN;

const midnight = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return midnight(x);
};
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

interface Block {
  id: string;
  areaId: string;
  subAreaId: string | null;
  start: number;
  end: number;
  note?: string;
  active?: boolean;
  lane: number;
  lanes: number;
}

/** Assign overlapping blocks to side-by-side lanes. */
function layout(items: Omit<Block, 'lane' | 'lanes'>[]): Block[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Block[] = [];
  let cluster: Block[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    cluster.forEach((b) => (b.lanes = laneEnds.length));
    out.push(...cluster);
    cluster = [];
    laneEnds = [];
  };
  for (const it of sorted) {
    if (it.start >= clusterEnd) flush();
    let lane = laneEnds.findIndex((e) => e <= it.start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = it.end;
    cluster.push({ ...it, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  flush();
  return out;
}

type DragMode = 'move' | 'top' | 'bottom';

export default function DayPage() {
  const [day, setDay] = useState(() => midnight(new Date()));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ id: string; start: number; end: number } | null>(null);
  const [editing, setEditing] = useState<EditorValue | null>(null);
  const contentRef = useRef<HTMLIonContentElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);

  const areas = useAreas(true);
  const subAreas = useSubAreas();
  const active = useActive();
  const now = useNow(30_000);

  const dayStart = day.getTime();
  const dayEnd = addDays(day, 1).getTime();
  const isToday = dayStart === midnight(new Date(now)).getTime();

  const startIso = new Date(dayStart).toISOString();
  const endIso = new Date(dayEnd).toISOString();
  const intervals =
    useLiveQuery(
      () => db.intervals.where('start').below(endIso).filter((i) => i.end > startIso).toArray(),
      [startIso, endIso],
    ) ?? [];

  const blocks = useMemo(() => {
    const items: Omit<Block, 'lane' | 'lanes'>[] = intervals.map((i: Interval) => {
      const d = draft?.id === i.id ? draft : null;
      return {
        id: i.id,
        areaId: i.areaId,
        subAreaId: i.subAreaId,
        note: i.note,
        start: d ? d.start : new Date(i.start).getTime(),
        end: d ? d.end : new Date(i.end).getTime(),
      };
    });
    if (active) {
      const s = new Date(active.start).getTime();
      if (s < dayEnd && now > dayStart) {
        items.push({ id: 'active', areaId: active.areaId, subAreaId: active.subAreaId, start: s, end: Math.max(now, s + MIN), active: true });
      }
    }
    return layout(items);
  }, [intervals, draft, active, now, dayStart, dayEnd]);

  const totalMs = blocks.reduce((acc, b) => acc + Math.min(b.end, dayEnd) - Math.max(b.start, dayStart), 0);

  // Scroll to "now" (today) or 07:00 (other days) when the day changes.
  useEffect(() => {
    const minutes = isToday ? (Date.now() - dayStart) / MIN - 120 : 7 * 60;
    const t = setTimeout(() => contentRef.current?.scrollToPoint(0, Math.max(0, minutes * PX_PER_MIN), 300), 50);
    setSelectedId(null);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayStart]);

  // ---- drag / resize of the selected block ----
  const drag = useRef<{ id: string; mode: DragMode; y0: number; s0: number; e0: number; moved: boolean } | null>(null);
  const suppressClickUntil = useRef(0);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  function beginDrag(e: React.PointerEvent, b: Block, mode: DragMode) {
    if (b.active || selectedId !== b.id) return;
    e.stopPropagation();
    drag.current = { id: b.id, mode, y0: e.clientY, s0: b.start, e0: b.end, moved: false };

    const onMove = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dy = ev.clientY - d.y0;
      if (Math.abs(dy) > 4) d.moved = true;
      if (!d.moved) return;
      const delta = Math.round(dy / PX_PER_MIN / SNAP_MIN) * SNAP_MIN * MIN;
      let s = d.s0;
      let en = d.e0;
      if (d.mode === 'move') {
        s += delta;
        en += delta;
      } else if (d.mode === 'top') s = Math.min(d.s0 + delta, d.e0 - SNAP_MIN * MIN);
      else en = Math.max(d.e0 + delta, d.s0 + SNAP_MIN * MIN);
      setDraft({ id: d.id, start: s, end: en });
    };
    const onUp = async () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      const d = drag.current;
      drag.current = null;
      const dr = draftRef.current;
      if (d?.moved && dr) {
        // The browser fires a click after pointerup; don't let it deselect.
        suppressClickUntil.current = Date.now() + 400;
        navigator.vibrate?.(8);
        await db.intervals.update(dr.id, {
          start: new Date(dr.start).toISOString(),
          end: new Date(dr.end).toISOString(),
          updatedAt: nowIso(),
        });
        setDraft(null);
      } else if (d && d.mode === 'move') {
        openEditor(b);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function openEditor(b: Block) {
    setSelectedId(null);
    setEditing({
      kind: b.active ? 'active' : 'existing',
      id: b.active ? undefined : b.id,
      areaId: b.areaId,
      subAreaId: b.subAreaId,
      start: b.start,
      end: b.end,
      note: b.note,
    });
  }

  function newIntervalAt(startMs: number) {
    const first = areas.find((a) => !a.archived);
    if (!first) return;
    setEditing({ kind: 'new', areaId: first.id, subAreaId: null, start: startMs, end: startMs + 30 * MIN });
  }

  function onGridClick(e: React.MouseEvent) {
    if (Date.now() < suppressClickUntil.current) return;
    if (selectedId) {
      setSelectedId(null);
      return;
    }
    const rect = gridRef.current!.getBoundingClientRect();
    const minutes = Math.floor((e.clientY - rect.top) / PX_PER_MIN / 15) * 15;
    newIntervalAt(dayStart + minutes * MIN);
  }

  const title = isToday
    ? 'Today'
    : day.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>
            <button className="title-button" onClick={() => dateInputRef.current?.showPicker?.()}>
              {title}
              <small>{formatDuration(totalMs, false)} tracked</small>
            </button>
            <input
              ref={dateInputRef}
              className="hidden-date-input"
              type="date"
              tabIndex={-1}
              aria-hidden
              value={`${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`}
              onChange={(e) => e.target.value && setDay(midnight(new Date(e.target.value + 'T00:00')))}
            />
          </IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={() => setDay(addDays(day, -1))} aria-label="Previous day">
              <IonIcon slot="icon-only" icon={chevronBack} />
            </IonButton>
            {!isToday && (
              <IonButton onClick={() => setDay(midnight(new Date()))} aria-label="Today">
                <IonIcon slot="icon-only" icon={todayOutline} />
              </IonButton>
            )}
            <IonButton onClick={() => setDay(addDays(day, 1))} aria-label="Next day">
              <IonIcon slot="icon-only" icon={chevronForward} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent ref={contentRef}>
        <div className="day-view" style={{ height: DAY_HEIGHT }}>
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="hour-row" style={{ top: h * 60 * PX_PER_MIN, height: 60 * PX_PER_MIN }}>
              <span className="hour-label">{h === 0 ? '' : new Date(dayStart + h * 60 * MIN).toLocaleTimeString([], { hour: 'numeric' })}</span>
            </div>
          ))}

          <div className="day-grid" ref={gridRef} onClick={onGridClick}>
            {blocks.map((b) => {
              const area = areas.find((a) => a.id === b.areaId);
              const sub = subAreas.find((s) => s.id === b.subAreaId);
              const vs = Math.max(b.start, dayStart);
              const ve = Math.min(b.end, dayEnd);
              const top = ((vs - dayStart) / MIN) * PX_PER_MIN;
              const height = Math.max(18, ((ve - vs) / MIN) * PX_PER_MIN - 2);
              const selected = selectedId === b.id;
              return (
                <div
                  key={b.id}
                  className={`day-block${selected ? ' selected' : ''}${b.active ? ' active' : ''}${height < 40 ? ' compact' : ''}`}
                  style={{
                    top,
                    height,
                    left: `calc(${(b.lane / b.lanes) * 100}% + 2px)`,
                    width: `calc(${100 / b.lanes}% - 4px)`,
                    ['--area-color' as string]: area?.color ?? '#888',
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (b.active) openEditor(b);
                    else if (!selected) {
                      navigator.vibrate?.(6);
                      setSelectedId(b.id);
                    }
                  }}
                  onPointerDown={(e) => beginDrag(e, b, 'move')}
                >
                  <div className="day-block-title">
                    {area && <IonIcon icon={iconFor(area.icon)} />}
                    <span>
                      {area?.name ?? 'Unknown'}
                      {sub ? ` · ${sub.name}` : ''}
                    </span>
                  </div>
                  <div className="day-block-time">
                    {hhmm(b.start)} – {b.active ? 'now' : hhmm(b.end)} · {formatDuration(b.end - b.start, false)}
                  </div>
                  {selected && (
                    <>
                      <div className="handle top" onPointerDown={(e) => beginDrag(e, b, 'top')} />
                      <div className="handle bottom" onPointerDown={(e) => beginDrag(e, b, 'bottom')} />
                    </>
                  )}
                </div>
              );
            })}

            {isToday && <div className="now-line" style={{ top: ((now - dayStart) / MIN) * PX_PER_MIN }} />}
          </div>
        </div>

        <IonFab slot="fixed" vertical="bottom" horizontal="end">
          <IonFabButton
            aria-label="Add interval"
            onClick={() => {
              const end = isToday ? Math.floor(Date.now() / (5 * MIN)) * 5 * MIN : dayStart + 12 * 60 * MIN;
              newIntervalAt(end - 30 * MIN);
            }}
          >
            <IonIcon icon={add} />
          </IonFabButton>
        </IonFab>
      </IonContent>

      <IntervalEditor value={editing} onClose={() => setEditing(null)} />
    </IonPage>
  );
}
