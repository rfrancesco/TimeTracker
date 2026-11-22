import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  IonButton, IonButtons, IonContent, IonFab, IonFabButton, IonHeader, IonIcon, IonPage, IonTitle, IonToolbar,
  useIonViewWillLeave,
} from '@ionic/react';
import { add, chevronBack, chevronForward, documentTextOutline, removeOutline, addOutline, todayOutline } from 'ionicons/icons';
import IntervalEditor, { type EditorValue } from '../components/IntervalEditor';
import { db, intervalsOverlapping, type Interval } from '../db';
import { ConstraintError, freeBounds, saveInterval } from '../constraints';
import { useActive, useAreas, useNow, useSubAreas } from '../hooks';
import { useToast } from '../toast';
import { useEditUndo } from '../editUndo';
import { haptic } from '../haptics';
import { longPressMs } from '../longPress';
import { readPref, writePref } from '../prefs';
import { usePinchZoom } from '../usePinchZoom';
import { iconFor } from '../icons';
import { formatDuration } from '../timer';
import { MINUTE, addLocalDays, atLocalTime, formatClock, hourMarks, localDateKey, startOfLocalDay } from '../time';

/** Zoom range in pixels per minute (1.2 ≈ the whole day in ~29 screen heights of 60px/h). */
const ZOOM_MIN = 1.2;
const ZOOM_MAX = 8;
/** Blocks shorter than this on screen are drawn as a marker + chip instead. */
const TINY_PX = 26;
const CHIP_H = 26;

const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
const loadZoom = () => clampZoom(Number(readPref('day.zoom')) || ZOOM_MIN);


/** A block on the timeline: a saved interval, or the running timer. No two overlap (invariant 2). */
interface Block {
  id: string;
  areaId: string;
  subAreaId: string | null;
  start: number;
  end: number;
  note?: string;
  active?: boolean;
}

type DragMode = 'move' | 'top' | 'bottom';

/**
 * Where a dragged block lands: moved `minutes` (snapped to `snap` minutes), or one
 * edge resized; always inside the free space `bounds` and at least `snap` long.
 */
function dragRange(mode: DragMode, s0: number, e0: number, minutes: number, snap: number, bounds: { min: number; max: number }) {
  const delta = Math.round(minutes / snap) * snap * MINUTE;
  const minLen = snap * MINUTE;
  if (mode === 'move') {
    const d = Math.min(Math.max(delta, bounds.min - s0), bounds.max - e0);
    return { start: s0 + d, end: e0 + d };
  }
  if (mode === 'top') return { start: Math.min(Math.max(s0 + delta, bounds.min), e0 - minLen), end: e0 };
  return { start: s0, end: Math.max(Math.min(e0 + delta, bounds.max), s0 + minLen) };
}

export default function DayPage() {
  const [day, setDay] = useState(() => startOfLocalDay(new Date()));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ id: string; start: number; end: number } | null>(null);
  const [editing, setEditing] = useState<EditorValue | null>(null);
  const toast = useToast();
  const editUndo = useEditUndo();
  useIonViewWillLeave(() => editUndo.forget()); // the quick undo is only valid in this view
  const areaName = (id: string | undefined) => areas.find((a) => a.id === id)?.name ?? 'interval';
  const contentRef = useRef<HTMLIonContentElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);

  // ---- zoom (pinch or the +/- pill); scroll is kept anchored on the focal point ----
  const [px, setPx] = useState(loadZoom);
  const pxRef = useRef(px);
  pxRef.current = px;
  const pendingScroll = useRef<number | null>(null);

  async function zoomTo(next: number, anchorClientY?: number) {
    const z = clampZoom(next);
    const scrollEl = await contentRef.current?.getScrollElement();
    const view = viewRef.current;
    if (!scrollEl || !view || z === pxRef.current) return;
    const rect = scrollEl.getBoundingClientRect();
    const anchor = anchorClientY ?? rect.top + rect.height / 2;
    const viewTop = view.getBoundingClientRect().top;
    const minute = (anchor - viewTop) / pxRef.current;
    pendingScroll.current = scrollEl.scrollTop + viewTop - anchor + minute * z;
    setPx(z);
    writePref('day.zoom', String(z));
  }
  useLayoutEffect(() => {
    const target = pendingScroll.current;
    if (target === null) return;
    pendingScroll.current = null;
    contentRef.current?.getScrollElement().then((el) => (el.scrollTop = Math.max(0, target)));
  }, [px]);

  usePinchZoom(viewRef, () => pxRef.current, zoomTo);
  const dateInputRef = useRef<HTMLInputElement>(null);

  const areas = useAreas(true);
  const subAreas = useSubAreas();
  const active = useActive();
  const now = useNow(30_000);

  const dayStart = day.getTime();
  const dayEnd = addLocalDays(day, 1).getTime();
  const isToday = dayStart === startOfLocalDay(new Date(now)).getTime();
  // Real length of this local day: 23 h / 25 h on DST transition days.
  const dayHeight = ((dayEnd - dayStart) / MINUTE) * px;
  const marks = useMemo(() => hourMarks(dayStart, dayEnd), [dayStart, dayEnd]);

  const startIso = new Date(dayStart).toISOString();
  const endIso = new Date(dayEnd).toISOString();
  const intervals =
    useLiveQuery(
      () => intervalsOverlapping(startIso, endIso),
      [startIso, endIso],
    ) ?? [];

  const blocks = useMemo(() => {
    const items: Block[] = intervals.map((i: Interval) => {
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
        items.push({ id: 'active', areaId: active.areaId, subAreaId: active.subAreaId, note: active.note, start: s, end: Math.max(now, s + MINUTE), active: true });
      }
    }
    return items;
  }, [intervals, draft, active, now, dayStart, dayEnd]);

  // Screen geometry. Blocks too short to read become a thin marker at their true
  // position plus a chip on the right half; chips are stacked so they never cover
  // each other, and they don't make neighbouring blocks narrower.
  const geometry = useMemo(() => {
    const items = blocks.map((b) => {
      const vs = Math.max(b.start, dayStart);
      const ve = Math.min(b.end, dayEnd);
      const top = ((vs - dayStart) / MINUTE) * px;
      const height = ((ve - vs) / MINUTE) * px;
      return { b, top, height, tiny: height < TINY_PX, chipTop: 0 };
    });
    let lastChipBottom = -Infinity;
    for (const g of items.filter((x) => x.tiny).sort((a, c) => a.top - c.top)) {
      g.chipTop = Math.max(g.top + g.height / 2 - CHIP_H / 2, lastChipBottom + 2, 0);
      lastChipBottom = g.chipTop + CHIP_H;
    }
    return items;
  }, [blocks, px, dayStart, dayEnd]);

  const totalMs = blocks.reduce((acc, b) => acc + Math.min(b.end, dayEnd) - Math.max(b.start, dayStart), 0);

  // Scroll to "now" (today) or 07:00 (other days) when the day changes.
  useEffect(() => {
    const target = isToday ? Date.now() - 2 * 60 * MINUTE : atLocalTime(dayStart, 7);
    const minutes = (target - dayStart) / MINUTE;
    const t = setTimeout(() => contentRef.current?.scrollToPoint(0, Math.max(0, minutes * pxRef.current), 300), 50);
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

  // Dragging is deliberate: on a selected block, a hold (Android's long-press delay) lifts it (vibration +
  // shadow) and only then does it follow the finger. Moving before that scrolls the
  // page as usual; a quick tap opens the editor; a hold released in place does nothing.
  const SLOP = 8; // px of movement that cancels a hold (it's a scroll)
  const drag = useRef<{ id: string; mode: DragMode; y0: number; s0: number; e0: number; armed: boolean; moved: boolean } | null>(null);
  const [lifted, setLifted] = useState<string | null>(null);
  const suppressClickUntil = useRef(0);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  function beginDrag(e: React.PointerEvent, b: Block, mode: DragMode) {
    if (b.active || selectedId !== b.id) return;
    e.stopPropagation();
    const d0 = { id: b.id, mode, y0: e.clientY, s0: b.start, e0: b.end, armed: false, moved: false };
    drag.current = d0;
    const holdTimer = window.setTimeout(() => {
      if (drag.current !== d0) return;
      d0.armed = true;
      setLifted(b.id);
      haptic('long');
    }, longPressMs());
    // Once armed, the page must not scroll under the finger.
    const blockScroll = (ev: TouchEvent) => {
      if (drag.current === d0 && d0.armed && ev.cancelable) ev.preventDefault();
    };
    window.addEventListener('touchmove', blockScroll, { passive: false });

    const onMove = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dy = ev.clientY - d.y0;
      if (!d.armed) {
        if (Math.abs(dy) > SLOP) {
          // A scroll, not a drag; a mouse would also fire a click on release: ignore it.
          suppressClickUntil.current = Date.now() + 1500;
          cleanup();
        }
        return;
      }
      if (Math.abs(dy) > 4) d.moved = true;
      if (!d.moved) return;
      if (!bounds.current) return;
      setDraft({ id: d.id, ...dragRange(d.mode, d.s0, d.e0, dy / pxRef.current, pxRef.current >= 4 ? 1 : 5, bounds.current) });
    };
    function cleanup() {
      window.clearTimeout(holdTimer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('touchmove', blockScroll);
      if (drag.current === d0) drag.current = null;
      setLifted(null);
    }
    const onCancel = () => {
      cleanup();
      setDraft(null);
    };
    const onUp = async () => {
      const d = drag.current;
      cleanup();
      if (!d) return;
      const dr = draftRef.current;
      if (d.armed) {
        // The browser fires a click after pointerup; don't let it deselect or open the editor.
        suppressClickUntil.current = Date.now() + 400;
        if (!d.moved || !dr) return void setDraft(null);
        haptic('confirm');
        const iv = await db.intervals.get(dr.id);
        const name = areaName(iv?.areaId);
        try {
          if (iv) {
            await editUndo.run(`${d.mode === 'move' ? 'Moved' : 'Resized'} ${name}`, Math.min(dr.start, d.s0), () =>
              saveInterval({ id: iv.id, areaId: iv.areaId, subAreaId: iv.subAreaId, note: iv.note, start: dr.start, end: dr.end }),
            );
          }
        } catch (err) {
          // Clamping should prevent this; if data changed underneath, snap back.
          toast(err instanceof ConstraintError ? `Not moved: ${err.message.toLowerCase()}` : 'Not moved');
        }
        setDraft(null);
      } else {
        // A tap (released before the hold) opens the editor, even on a resize handle
        // (on short blocks the handles cover most of the block).
        suppressClickUntil.current = Date.now() + 400;
        openEditor(b);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
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
    const end = Math.min(start + 30 * MINUTE, next);
    if (end - start < MINUTE) return toast('No free time here');
    openNew(start, end);
  }

  /** New interval ending at (or just before) `at`, up to 30 min, within free time. */
  function newIntervalEndingAt(at: number) {
    let end = Math.min(at, Date.now());
    for (const b of busy()) if (b.start < end && b.end >= end) end = b.start;
    const prev = Math.max(-Infinity, ...busy().filter((b) => b.end <= end).map((b) => b.end));
    const start = Math.max(end - 30 * MINUTE, prev);
    if (end - start < MINUTE) return toast('No free time just before now');
    openNew(start, end);
  }

  function onGridClick(e: React.MouseEvent) {
    if (Date.now() < suppressClickUntil.current) return;
    if (selectedId) {
      setSelectedId(null);
      return;
    }
    const rect = gridRef.current!.getBoundingClientRect();
    const step = px >= 4 ? 5 : 15;
    const minutes = Math.floor((e.clientY - rect.top) / px / step) * step;
    newIntervalAt(dayStart + minutes * MINUTE);
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
              onChange={(e) => e.target.value && setDay(startOfLocalDay(new Date(e.target.value + 'T00:00')))}
            />
          </IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={() => setDay(addLocalDays(day, -1))} aria-label="Previous day">
              <IonIcon slot="icon-only" icon={chevronBack} />
            </IonButton>
            {!isToday && (
              <IonButton onClick={() => setDay(startOfLocalDay(new Date()))} aria-label="Today">
                <IonIcon slot="icon-only" icon={todayOutline} />
              </IonButton>
            )}
            <IonButton onClick={() => setDay(addLocalDays(day, 1))} aria-label="Next day">
              <IonIcon slot="icon-only" icon={chevronForward} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent ref={contentRef}>
        <div className="day-view" ref={viewRef} style={{ height: dayHeight }}>
          {marks.map((m, i) => (
            <div
              key={m.offsetMin}
              className={`hour-row${m.shifted ? ' dst-shift' : ''}`}
              style={{ top: m.offsetMin * px, height: 60 * px }}
            >
              <span className="hour-label">{i === 0 ? '' : m.label}</span>
              {px >= 2.4 && <span className="half-hour" style={{ top: 30 * px }} />}
            </div>
          ))}

          <div className="day-grid" ref={gridRef} onClick={onGridClick}>
            {geometry.map(({ b, top, height, tiny, chipTop }) => {
              const area = areas.find((a) => a.id === b.areaId);
              const sub = subAreas.find((x) => x.id === b.subAreaId);
              const selected = selectedId === b.id;
              const color = area?.color ?? '#888';
              const ink = area?.onColor ?? '#fff';
              const label = `${area?.name ?? 'Unknown'}${sub ? ` · ${sub.name}` : ''}`;
              const onClick = (e: React.MouseEvent) => {
                e.stopPropagation();
                if (b.active) openEditor(b);
                else if (!selected) {
                  haptic('tick');
                  setSelectedId(b.id);
                }
              };
              if (tiny) {
                return (
                  <div key={b.id} className="tiny-wrap">
                    <div
                      className={`tiny-marker${selected ? ' selected' : ''}`}
                      style={{ top, height: Math.max(2, height), ['--area-color' as string]: color, ['--on-area' as string]: ink }}
                    />
                    <div
                      className={`day-chip${selected ? ' selected' : ''}${b.active ? ' active' : ''}${lifted === b.id ? ' lifted' : ''}`}
                      style={{ top: chipTop, height: CHIP_H, ['--area-color' as string]: color, ['--on-area' as string]: ink }}
                      onClick={onClick}
                      onPointerDown={(e) => beginDrag(e, b, 'move')}
                      onContextMenu={(e) => e.preventDefault()}
                      title={`${label} ${formatClock(b.start)}–${b.active ? 'now' : formatClock(b.end)}${b.note ? `\n${b.note}` : ''}`}
                    >
                      {area && <IonIcon icon={iconFor(area.icon)} />}
                      <span className="chip-name">{label}</span>
                      {b.note && <IonIcon className="note-icon" icon={documentTextOutline} aria-label="Has a note" />}
                      <span className="chip-dur">{formatDuration(b.end - b.start, false)}</span>
                    </div>
                  </div>
                );
              }
              return (
                <div
                  key={b.id}
                  className={`day-block${selected ? ' selected' : ''}${b.active ? ' active' : ''}${height < 44 ? ' compact' : ''}${lifted === b.id ? ' lifted' : ''}`}
                  style={{
                    top,
                    height: height - 2,
                    ['--area-color' as string]: color, ['--on-area' as string]: ink,
                  }}
                  onClick={onClick}
                  onPointerDown={(e) => beginDrag(e, b, 'move')}
                  onContextMenu={(e) => e.preventDefault()}
                >
                  <div className="day-block-title">
                    {area && <IonIcon icon={iconFor(area.icon)} />}
                    <span>{label}</span>
                    {b.note && <IonIcon className="note-icon" icon={documentTextOutline} aria-label="Has a note" />}
                  </div>
                  <div className="day-block-time">
                    {formatClock(b.start)} – {b.active ? 'now' : formatClock(b.end)} · {formatDuration(b.end - b.start, false)}
                  </div>
                  {b.note && height >= 62 && (
                    <div className="day-block-note" style={{ WebkitLineClamp: Math.max(1, Math.floor((height - 46) / 16)) }}>
                      {b.note}
                    </div>
                  )}
                  {selected && (
                    <>
                      <div className="handle top" onPointerDown={(e) => beginDrag(e, b, 'top')} />
                      <div className="handle bottom" onPointerDown={(e) => beginDrag(e, b, 'bottom')} />
                    </>
                  )}
                </div>
              );
            })}

            {isToday && <div className="now-line" style={{ top: ((now - dayStart) / MINUTE) * px }} />}
          </div>
        </div>

        <div slot="fixed" className="zoom-pill">
          <button aria-label="Zoom out" disabled={px <= ZOOM_MIN} onClick={() => zoomTo(px / 1.6)}>
            <IonIcon icon={removeOutline} />
          </button>
          <button aria-label="Zoom in" disabled={px >= ZOOM_MAX} onClick={() => zoomTo(px * 1.6)}>
            <IonIcon icon={addOutline} />
          </button>
        </div>

        <IonFab slot="fixed" vertical="bottom" horizontal="end">
          <IonFabButton
            aria-label="Add interval"
            onClick={() => {
              if (isToday) newIntervalEndingAt(Math.floor(Date.now() / (5 * MINUTE)) * 5 * MINUTE);
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
