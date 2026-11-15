import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  IonButton, IonButtons, IonContent, IonFab, IonFabButton, IonHeader, IonIcon, IonPage, IonTitle, IonToolbar,
  useIonToast,
} from '@ionic/react';
import { add, chevronBack, chevronForward, todayOutline } from 'ionicons/icons';
import IntervalEditor, { type EditorValue } from '../components/IntervalEditor';
import { db, type Interval } from '../db';
import { ConstraintError, freeBounds, saveInterval } from '../constraints';
import { useActive, useAreas, useNow, useSubAreas } from '../hooks';
import { iconFor } from '../icons';
import { formatDuration } from '../timer';
import { MINUTE, addLocalDays, atLocalTime, hourMarks, localDateKey, startOfLocalDay } from '../time';

const PX_PER_MIN = 1.2;
const MIN = MINUTE;
const SNAP_MIN = 5;

const midnight = startOfLocalDay;
const addDays = addLocalDays;
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
  const [presentToast] = useIonToast();
  const toast = (message: string) => presentToast({ message, duration: 2200, position: 'bottom' });
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
  // Real length of this local day: 23 h / 25 h on DST transition days.
  const dayHeight = ((dayEnd - dayStart) / MIN) * PX_PER_MIN;
  const marks = useMemo(() => hourMarks(dayStart, dayEnd), [dayStart, dayEnd]);

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
    const target = isToday ? Date.now() - 2 * 60 * MIN : atLocalTime(dayStart, 7);
    const minutes = (target - dayStart) / MIN;
    const t = setTimeout(() => contentRef.current?.scrollToPoint(0, Math.max(0, minutes * PX_PER_MIN), 300), 50);
    setSelectedId(null);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayStart]);

  // ---- drag / resize of the selected block ----
  // Free space around the selected interval: drags and resizes are clamped to it,
  // so a block can never be pushed into a neighbour, the running timer, or the future.
  const bounds = useRef<{ min: number; max: number } | null>(null);
  useEffect(() => {
    bounds.current = null;
    const iv = intervals.find((i) => i.id === selectedId);
    if (!iv) return;
    let live = true;
    freeBounds(iv.id, new Date(iv.start).getTime(), new Date(iv.end).getTime()).then((b) => {
      if (live) bounds.current = b;
    });
    return () => {
      live = false;
    };
  }, [selectedId, intervals]);

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
      const bnd = bounds.current;
      if (!bnd) return;
      const delta = Math.round(dy / PX_PER_MIN / SNAP_MIN) * SNAP_MIN * MIN;
      const minLen = SNAP_MIN * MIN;
      let s = d.s0;
      let en = d.e0;
      if (d.mode === 'move') {
        const dd = Math.min(Math.max(delta, bnd.min - d.s0), bnd.max - d.e0);
        s += dd;
        en += dd;
      } else if (d.mode === 'top') s = Math.min(Math.max(d.s0 + delta, bnd.min), d.e0 - minLen);
      else en = Math.max(Math.min(d.e0 + delta, bnd.max), d.s0 + minLen);
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
        const iv = await db.intervals.get(dr.id);
        try {
          if (iv) {
            await saveInterval({ id: iv.id, areaId: iv.areaId, subAreaId: iv.subAreaId, note: iv.note, start: dr.start, end: dr.end });
          }
        } catch (err) {
          // Clamping should prevent this; if data changed underneath, snap back.
          toast(err instanceof ConstraintError ? `Not moved: ${err.message.toLowerCase()}` : 'Not moved');
        }
        setDraft(null);
      } else if (d) {
        // A tap without movement opens the editor, even on a resize handle
        // (on short blocks the handles cover most of the block).
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

  /** Busy spans known on screen (saved intervals + running timer). */
  const busy = () => blocks.map((b) => ({ start: b.start, end: b.active ? Infinity : b.end }));

  function openNew(start: number, end: number) {
    const first = areas.find((a) => !a.archived);
    if (!first) return;
    setEditing({ kind: 'new', areaId: first.id, subAreaId: null, start, end });
  }

  /** New interval starting at (or just after) `at`, up to 30 min, within free time. */
  function newIntervalAt(at: number) {
    const now = Date.now();
    let start = at;
    for (const b of busy()) if (b.start <= start && b.end > start) start = b.end;
    if (start >= now) return toast('Can’t add time in the future');
    const next = Math.min(now, ...busy().filter((b) => b.start >= start).map((b) => b.start));
    const end = Math.min(start + 30 * MIN, next);
    if (end - start < MIN) return toast('No free time here');
    openNew(start, end);
  }

  /** New interval ending at (or just before) `at`, up to 30 min, within free time. */
  function newIntervalEndingAt(at: number) {
    let end = Math.min(at, Date.now());
    for (const b of busy()) if (b.start < end && b.end >= end) end = b.start;
    const prev = Math.max(-Infinity, ...busy().filter((b) => b.end <= end).map((b) => b.end));
    const start = Math.max(end - 30 * MIN, prev);
    if (end - start < MIN) return toast('No free time just before now');
    openNew(start, end);
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
              value={localDateKey(day)}
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
        <div className="day-view" style={{ height: dayHeight }}>
          {marks.map((m, i) => (
            <div
              key={m.offsetMin}
              className={`hour-row${m.shifted ? ' dst-shift' : ''}`}
              style={{ top: m.offsetMin * PX_PER_MIN, height: 60 * PX_PER_MIN }}
            >
              <span className="hour-label">{i === 0 ? '' : m.label}</span>
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
              if (isToday) newIntervalEndingAt(Math.floor(Date.now() / (5 * MIN)) * 5 * MIN);
              else newIntervalAt(atLocalTime(dayStart, 12));
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
