import { IonIcon } from '@ionic/react';
import type { ActiveTimer } from '../db';
import type { AreaView } from '../hooks';
import { iconFor } from '../icons';
import { ticksInApp } from '../runningTime';
import { formatDuration } from '../timer';
import { formatClock } from '../time';

/**
 * The big timer: one structure in every state, a caption above one big number, so
 * nothing below moves between idle, ticking and quiet (running time off: the start
 * time, muted, instead of the ticking digits).
 */
export default function TimerDisplay({ active, area, subName, now }: { active?: ActiveTimer; area?: AreaView; subName?: string; now: number }) {
  if (!active || !area)
    return (
      <section className="timer-display" aria-live="polite">
        {/* Invisible stand-in for the area name, so the caption and number sit on exactly
            the same lines as in the running states. */}
        <div className="timer-label placeholder" aria-hidden>
          <IonIcon icon={iconFor('moon')} />
          <span>Timer</span>
        </div>
        <div className="timer-caption">Tap an area to start</div>
        <div className="timer-digits idle">0:00:00</div>
      </section>
    );
  const ticking = ticksInApp(area);
  const since = formatClock(active.start);
  // The current moment, not the last tick's: right after a change the digits are exact.
  const elapsed = Math.max(now, Date.now()) - Date.parse(active.start);
  return (
    <section className="timer-display" aria-live="polite">
      <div className="timer-label">
        <IonIcon icon={iconFor(area.icon)} />
        <span>
          {area.name}
          {subName ? ` · ${subName}` : ''}
        </span>
      </div>
      <div className="timer-caption">{ticking ? `Started at ${since}` : 'Started at'}</div>
      <div className={`timer-digits${ticking ? '' : ' quiet'}`}>{ticking ? formatDuration(elapsed) : since}</div>
    </section>
  );
}
