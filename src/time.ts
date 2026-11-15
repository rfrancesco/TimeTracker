/**
 * Local-time helpers. Storage is always UTC; these only decide how UTC instants
 * map onto the user's calendar days. A local day is [local midnight, next local
 * midnight), which is 23 or 25 hours long on DST transition days.
 */

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

/** Local midnight at the start of the day containing `d`. */
export function startOfLocalDay(d: Date | number) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Local midnight `n` calendar days after the day containing `d` (DST-safe). */
export function addLocalDays(d: Date | number, n: number) {
  const x = startOfLocalDay(d);
  x.setDate(x.getDate() + n);
  return startOfLocalDay(x);
}

/** The instant at wall-clock `hours:minutes` on the local day of `day`. */
export function atLocalTime(day: Date | number, hours: number, minutes = 0) {
  const d = new Date(day);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hours, minutes).getTime();
}

/** "YYYY-MM-DD" of the local calendar day (not the UTC date). */
export function localDateKey(d: Date | number) {
  const x = new Date(d);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}

export interface HourMark {
  /** Real minutes since the start of the day (position on the timeline). */
  offsetMin: number;
  label: string;
  /** True when the UTC offset changed since the previous mark (DST switch). */
  shifted: boolean;
}

/**
 * Hour gridlines for a local day, stepping through *real* time. On a 23-hour
 * day the clock jumps (1 AM, 3 AM, …); on a 25-hour day an hour repeats
 * (1 AM, 2 AM, 2 AM, …), with the time zone shown where the offset changes.
 */
export function hourMarks(dayStart: number, dayEnd: number): HourMark[] {
  const marks: HourMark[] = [];
  let prevOffset = new Date(dayStart).getTimezoneOffset();
  for (let t = dayStart; t < dayEnd; t += HOUR) {
    const d = new Date(t);
    const offset = d.getTimezoneOffset();
    const shifted = offset !== prevOffset;
    prevOffset = offset;
    const label = d.toLocaleTimeString([], {
      hour: 'numeric',
      ...(d.getMinutes() ? { minute: '2-digit' } : {}),
      ...(shifted ? { timeZoneName: 'short' } : {}),
    });
    marks.push({ offsetMin: (t - dayStart) / MINUTE, label, shifted });
  }
  return marks;
}
