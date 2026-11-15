import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonLabel, IonPage, IonSegment, IonSegmentButton,
  IonTitle, IonToggle, IonToolbar,
} from '@ionic/react';
import { barChartOutline, chevronBack, chevronDown, chevronForward, chevronUp } from 'ionicons/icons';
import Donut, { type Slice } from '../components/Donut';
import DayBars from '../components/DayBars';
import { db } from '../db';
import { useActive, useAreas, useNow, useSubAreas } from '../hooks';
import { iconFor } from '../icons';
import { buildReport, periodLabel, periodRange, shiftPeriod, type Period } from '../report';
import { formatDuration } from '../timer';

const UNTRACKED = '__untracked';
const OTHER = '__other';
const MAX_SLICES = 8; // past this, the tail folds into "Other"

const loadPref = (k: string, d: boolean) => {
  try {
    const v = localStorage.getItem(k);
    return v === null ? d : v === '1';
  } catch {
    return d;
  }
};
const savePref = (k: string, v: boolean) => {
  try {
    localStorage.setItem(k, v ? '1' : '0');
  } catch {
    /* ignore */
  }
};

const dur = (ms: number) => formatDuration(ms, false);
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–');

export default function ReportPage() {
  const now = useNow(30_000);
  const [period, setPeriod] = useState<Period>('day');
  const [anchor, setAnchor] = useState(() => Date.now());
  const [showUntracked, setShowUntracked] = useState(() => loadPref('report.untracked', true));
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  const areas = useAreas(true);
  const subAreas = useSubAreas();
  const active = useActive();

  const range = useMemo(() => periodRange(period, anchor), [period, anchor]);
  const startIso = new Date(range.start).toISOString();
  const endIso = new Date(range.end).toISOString();
  const intervals =
    useLiveQuery(
      () => db.intervals.where('start').below(endIso).filter((i) => i.end > startIso).toArray(),
      [startIso, endIso],
    ) ?? [];
  const first = useLiveQuery(() => db.intervals.orderBy('start').first());
  const firstEver = Math.min(
    first ? new Date(first.start).getTime() : Infinity,
    active ? new Date(active.start).getTime() : Infinity,
  );

  const report = useMemo(
    () => buildReport(range, intervals, active, now, Number.isFinite(firstEver) ? firstEver : null),
    [range, intervals, active, now, firstEver],
  );

  const untracked = Math.max(0, report.available - report.total);
  const base = showUntracked ? report.total + untracked : report.total;
  const isCurrent = range.start <= now && now < range.end;
  const canGoNext = shiftPeriod(period, anchor, 1) <= now;

  const areaInfo = (id: string) => {
    const a = areas.find((x) => x.id === id);
    return { name: a?.name ?? 'Deleted area', color: a?.color ?? '#8a8a8a', ink: a?.onColor ?? '#fff', icon: a?.icon ?? 'sparkles' };
  };

  // Ranked areas, and chart slices with the tail folded into "Other".
  const ranked = [...report.byArea.entries()].sort((a, b) => b[1] - a[1]);
  const slices: Slice[] = useMemo(() => {
    const room = MAX_SLICES - (showUntracked && untracked > 0 ? 1 : 0);
    const head = ranked.length > room ? ranked.slice(0, room - 1) : ranked;
    const tail = ranked.length > room ? ranked.slice(room - 1) : [];
    const out: Slice[] = head.map(([id, ms]) => ({ id, label: areaInfo(id).name, color: areaInfo(id).color, value: ms }));
    if (tail.length) out.push({ id: OTHER, label: 'Other', color: 'var(--viz-other)', value: tail.reduce((a, [, ms]) => a + ms, 0) });
    if (showUntracked && untracked > 0) out.push({ id: UNTRACKED, label: 'Untracked', color: 'var(--viz-untracked)', value: untracked });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ranked.map((r) => r.join()).join(), showUntracked, untracked, areas]);

  // Stacking order for day bars = the user's area order (stable across days).
  const series = areas.map((a) => ({ id: a.id, color: a.color }));

  const sel = slices.find((s) => s.id === selected);
  const center = sel
    ? { value: dur(sel.value), caption: `${sel.label} · ${pct(sel.value, base)}` }
    : { value: dur(report.total), caption: period === 'day' ? 'tracked' : `tracked · ${report.availableDays} d` };

  const avgPerDay = report.availableDays ? report.total / report.availableDays : 0;
  const empty = report.total === 0;
  const notStarted = range.start > now;
  const beforeData = !Number.isFinite(firstEver) || range.end <= firstEver;

  function changePeriod(p: Period) {
    setPeriod(p);
    setSelected(null);
    setSelectedDay(null);
  }
  function move(n: number) {
    setAnchor(shiftPeriod(period, anchor, n));
    setSelected(null);
    setSelectedDay(null);
  }

  const dayDetail = selectedDay !== null ? report.perDay[selectedDay] : null;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Reports</IonTitle>
        </IonToolbar>
        <IonToolbar>
          <IonSegment value={period} onIonChange={(e) => changePeriod(e.detail.value as Period)}>
            <IonSegmentButton value="day"><IonLabel>Day</IonLabel></IonSegmentButton>
            <IonSegmentButton value="week"><IonLabel>Week</IonLabel></IonSegmentButton>
            <IonSegmentButton value="month"><IonLabel>Month</IonLabel></IonSegmentButton>
          </IonSegment>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <div className="period-nav">
          <IonButtons>
            <IonButton onClick={() => move(-1)} aria-label="Previous period">
              <IonIcon slot="icon-only" icon={chevronBack} />
            </IonButton>
          </IonButtons>
          <button className="period-label" onClick={() => !isCurrent && setAnchor(Date.now())}>
            {periodLabel(period, range, now)}
            {!isCurrent && <small>Tap to return to now</small>}
          </button>
          <IonButtons>
            <IonButton onClick={() => move(1)} disabled={!canGoNext} aria-label="Next period">
              <IonIcon slot="icon-only" icon={chevronForward} />
            </IonButton>
          </IonButtons>
        </div>

        {empty ? (
          <div className="empty-state report-empty">
            <IonIcon icon={barChartOutline} />
            <p>
              {notStarted
                ? 'This period hasn’t started yet.'
                : beforeData
                  ? 'No data yet — tracking started later.'
                  : 'Nothing tracked in this period.'}
            </p>
          </div>
        ) : (
          <div className="report">
            <section className="report-hero">
              <div className="hero-value">{dur(report.total)}</div>
              <div className="hero-caption">
                {period === 'day'
                  ? `tracked${untracked > 0 ? ` · ${dur(untracked)} untracked` : ''}`
                  : `tracked · ${dur(avgPerDay)} per day on average over ${report.availableDays} day${report.availableDays === 1 ? '' : 's'}`}
              </div>
            </section>

            <Donut
              slices={slices}
              selectedId={selected}
              onSelect={setSelected}
              center={center}
              ariaLabel={`Time per area: ${slices.map((s) => `${s.label} ${dur(s.value)}`).join(', ')}`}
            />

            <div className="report-list">
              <div className="report-list-header">
                <span>By area</span>
                <IonToggle
                  checked={showUntracked}
                  labelPlacement="start"
                  onIonChange={(e) => {
                    setShowUntracked(e.detail.checked);
                    savePref('report.untracked', e.detail.checked);
                    if (!e.detail.checked && selected === UNTRACKED) setSelected(null);
                  }}
                >
                  Untracked
                </IonToggle>
              </div>

              {ranked.map(([id, ms]) => {
                const info = areaInfo(id);
                const subs = [...(report.bySub.get(id)?.entries() ?? [])].sort((a, b) => b[1] - a[1]);
                const hasSubs = subs.some(([sid]) => sid !== null);
                const open = expanded === id;
                const sliceId = slices.some((s) => s.id === id) ? id : OTHER;
                return (
                  <div key={id} className={`report-row-wrap${selected && selected !== sliceId ? ' dimmed' : ''}`}>
                    <button
                      className="report-row"
                      onClick={() => {
                        setSelected(selected === sliceId ? null : sliceId);
                        if (hasSubs) setExpanded(open ? null : id);
                      }}
                    >
                      <span className="dot" style={{ background: info.color, color: info.ink }}>
                        <IonIcon icon={iconFor(info.icon)} />
                      </span>
                      <span className="row-main">
                        <span className="row-top">
                          <span className="name">{info.name}</span>
                          <span className="dur">{dur(ms)}</span>
                          <span className="pct">{pct(ms, base)}</span>
                        </span>
                        <span className="share-track">
                          <span className="share-bar" style={{ width: pct(ms, base), background: info.color }} />
                        </span>
                      </span>
                      {hasSubs && <IonIcon className="chev" icon={open ? chevronUp : chevronDown} />}
                    </button>
                    {open && (
                      <div className="sub-rows">
                        {subs.map(([sid, sms]) => (
                          <div key={sid ?? 'none'} className="sub-row">
                            <span className="name">{sid ? subAreas.find((s) => s.id === sid)?.name ?? 'Deleted' : 'No sub-area'}</span>
                            <span className="dur">{dur(sms)}</span>
                            <span className="pct">{pct(sms, ms)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {showUntracked && untracked > 0 && (
                <div className={`report-row-wrap${selected && selected !== UNTRACKED ? ' dimmed' : ''}`}>
                  <button className="report-row" onClick={() => setSelected(selected === UNTRACKED ? null : UNTRACKED)}>
                    <span className="dot untracked-dot" />
                    <span className="row-main">
                      <span className="row-top">
                        <span className="name">Untracked</span>
                        <span className="dur">{dur(untracked)}</span>
                        <span className="pct">{pct(untracked, base)}</span>
                      </span>
                      <span className="share-track">
                        <span className="share-bar" style={{ width: pct(untracked, base), background: 'var(--viz-untracked)' }} />
                      </span>
                    </span>
                  </button>
                </div>
              )}
            </div>

            {period !== 'day' && (
              <section className="report-days">
                <h2>Per day</h2>
                <DayBars
                  days={range.days}
                  perDay={report.perDay}
                  series={series}
                  now={now}
                  selected={selectedDay}
                  onSelect={setSelectedDay}
                  compactLabels={period === 'month'}
                />
                {dayDetail && selectedDay !== null && (
                  <div className="day-detail">
                    <div className="day-detail-head">
                      <strong>
                        {new Date(range.days[selectedDay]).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}
                      </strong>
                      <span>{dur([...dayDetail.values()].reduce((a, b) => a + b, 0))}</span>
                    </div>
                    <div className="day-detail-items">
                      {[...dayDetail.entries()]
                        .sort((a, b) => b[1] - a[1])
                        .map(([id, ms]) => (
                          <span key={id} className="day-detail-item">
                            <span className="swatch" style={{ background: areaInfo(id).color }} />
                            {areaInfo(id).name} {dur(ms)}
                          </span>
                        ))}
                    </div>
                    <IonButton
                      fill="clear"
                      size="small"
                      onClick={() => {
                        setAnchor(range.days[selectedDay]);
                        changePeriod('day');
                      }}
                    >
                      Show this day
                    </IonButton>
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </IonContent>
    </IonPage>
  );
}
