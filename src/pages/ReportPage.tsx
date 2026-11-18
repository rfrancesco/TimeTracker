import { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonLabel, IonPage, IonSegment, IonSegmentButton,
  IonTitle, IonToggle, IonToolbar,
} from '@ionic/react';
import { barChartOutline, chevronBack, chevronDown, chevronForward, chevronUp } from 'ionicons/icons';
import Donut, { HATCH, type Slice } from '../components/Donut';
import DayBars from '../components/DayBars';
import { db, intervalsOverlapping } from '../db';
import { useActive, useAreas, useNow, useSubAreas } from '../hooks';
import { iconFor } from '../icons';
import { buildReport, periodLabel, periodRange, shiftPeriod, type Period } from '../report';
import { formatDuration } from '../timer';


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
/** A whole period's length: "24h" (whole hours, always for whole-hour DST shifts), else "23h 30m". */
const periodDur = (ms: number) => (ms % 3_600_000 === 0 ? `${ms / 3_600_000}h` : dur(ms));
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–');

export default function ReportPage() {
  const now = useNow(30_000);
  // What the controls ask for. What is shown follows once its data has loaded, so
  // switching days never flashes an empty report in between (label and content
  // change together, in one frame).
  const [wantPeriod, setPeriod] = useState<Period>('day');
  const [wantAnchor, setAnchor] = useState(() => Date.now());
  // Full period: the chart covers the whole day/week/month (incl. untracked and what's still to come).
  const [full, setFull] = useState(() => loadPref('report.full', true));
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  const areas = useAreas(true);
  const subAreas = useSubAreas();
  const active = useActive();

  const wantRange = useMemo(() => periodRange(wantPeriod, wantAnchor), [wantPeriod, wantAnchor]);
  const startIso = new Date(wantRange.start).toISOString();
  const endIso = new Date(wantRange.end).toISOString();
  const loaded = useLiveQuery(
    async () => ({ period: wantPeriod, anchor: wantAnchor, intervals: await intervalsOverlapping(startIso, endIso) }),
    [startIso, endIso, wantPeriod, wantAnchor],
  );
  const lastLoaded = useRef(loaded);
  if (loaded) lastLoaded.current = loaded;
  const shown = loaded ?? lastLoaded.current;
  const period = shown?.period ?? wantPeriod;
  const anchor = shown?.anchor ?? wantAnchor;
  const intervals = useMemo(() => shown?.intervals ?? [], [shown]);
  const range = useMemo(() => periodRange(period, anchor), [period, anchor]);
  const first = useLiveQuery(() => db.intervals.orderBy('start').first());
  const firstEver = Math.min(
    first ? new Date(first.start).getTime() : Infinity,
    active ? new Date(active.start).getTime() : Infinity,
  );

  const report = useMemo(
    () => buildReport(range, intervals, active, now, Number.isFinite(firstEver) ? firstEver : null),
    [range, intervals, active, now, firstEver],
  );

  const { rest } = report;
  // The non-area parts of the period, in time order around the chart.
  const restParts = [
    { id: '__nodata', label: 'Before tracking', color: HATCH, dot: 'nodata-dot', value: rest.noData },
    { id: '__untracked', label: 'Untracked', color: 'var(--viz-untracked)', dot: 'untracked-dot', value: rest.untracked },
    { id: '__upcoming', label: 'Still to come', color: 'var(--viz-upcoming)', dot: 'upcoming-dot', value: rest.upcoming },
  ].filter((r) => r.value > 0);
  const base = full ? rest.length : report.total;
  const isCurrent = range.start <= now && now < range.end;
  const canGoNext = shiftPeriod(wantPeriod, wantAnchor, 1) <= now;

  const areaInfo = (id: string) => {
    const a = areas.find((x) => x.id === id);
    return { name: a?.name ?? 'Deleted area', color: a?.color ?? '#8a8a8a', ink: a?.onColor ?? '#fff', icon: a?.icon ?? 'sparkles' };
  };

  // Ranked areas; every area gets its own slice (the list below labels each one).
  const ranked = [...report.byArea.entries()].sort((a, b) => b[1] - a[1]);
  const slices: Slice[] = useMemo(() => {
    const areaSlices: Slice[] = ranked.map(([id, ms]) => ({ id, label: areaInfo(id).name, color: areaInfo(id).color, value: ms }));
    if (!full) return areaSlices;
    const part = (id: string) => restParts.filter((r) => r.id === id);
    // Clockwise from the top: before tracking, the areas, untracked, still to come.
    return [...part('__nodata'), ...areaSlices, ...part('__untracked'), ...part('__upcoming')];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ranked.map((r) => r.join()).join(), full, rest.noData, rest.untracked, rest.upcoming, areas]);

  // Stacking order for day bars = the user's area order (stable across days).
  const series = areas.map((a) => ({ id: a.id, color: a.color }));

  const sel = slices.find((s) => s.id === selected);
  const center = sel
    ? { value: dur(sel.value), caption: `${sel.label} · ${pct(sel.value, base)}` }
    : {
        value: dur(report.total),
        caption: full ? `tracked of ${periodDur(rest.length)}` : period === 'day' ? 'tracked' : `tracked · ${report.availableDays} d`,
      };
  const fullLabel = period === 'day' ? 'Full day' : period === 'week' ? 'Full week' : 'Full month';

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
    setAnchor(shiftPeriod(wantPeriod, wantAnchor, n));
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
          <IonSegment value={wantPeriod} onIonChange={(e) => changePeriod(e.detail.value as Period)}>
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
                  ? ['tracked', rest.untracked > 0 && `${dur(rest.untracked)} untracked`, rest.upcoming > 0 && `${dur(rest.upcoming)} to go`]
                      .filter(Boolean)
                      .join(' · ')
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
                  checked={full}
                  labelPlacement="start"
                  onIonChange={(e) => {
                    setFull(e.detail.checked);
                    savePref('report.full', e.detail.checked);
                    if (!e.detail.checked && selected?.startsWith('__')) setSelected(null);
                  }}
                >
                  {fullLabel}
                </IonToggle>
              </div>

              {ranked.map(([id, ms]) => {
                const info = areaInfo(id);
                const subs = [...(report.bySub.get(id)?.entries() ?? [])].sort((a, b) => b[1] - a[1]);
                const hasSubs = subs.some(([sid]) => sid !== null);
                const open = expanded === id;
                const sliceId = id;
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

              {full &&
                restParts.map((r) => (
                  <div key={r.id} className={`report-row-wrap${selected && selected !== r.id ? ' dimmed' : ''}`}>
                    <button className="report-row" onClick={() => setSelected(selected === r.id ? null : r.id)}>
                      <span className={`dot ${r.dot}`} />
                      <span className="row-main">
                        <span className="row-top">
                          <span className="name rest-name">{r.label}</span>
                          <span className="dur">{dur(r.value)}</span>
                          <span className="pct">{pct(r.value, base)}</span>
                        </span>
                        <span className="share-track">
                          <span className={`share-bar ${r.dot}`} style={{ width: pct(r.value, base) }} />
                        </span>
                      </span>
                    </button>
                  </div>
                ))}
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
                  rest={full ? report.perDayRest : undefined}
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
                      {full &&
                        selectedDay !== null &&
                        (
                          [
                            ['untracked-dot', 'Untracked', report.perDayRest[selectedDay].untracked],
                            ['upcoming-dot', 'Still to come', report.perDayRest[selectedDay].upcoming],
                            ['nodata-dot', 'Before tracking', report.perDayRest[selectedDay].noData],
                          ] as const
                        )
                          .filter(([, , v]) => v > 0)
                          .map(([cls, label, v]) => (
                            <span key={label} className="day-detail-item">
                              <span className={`swatch ${cls}`} />
                              {label} {dur(v)}
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
