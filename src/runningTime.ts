import type { Area, RunningTime } from './db';

/**
 * Two separate per-area settings:
 * - running time: where the time ticks. "off" = nowhere ("since 22:45" instead, in the
 *   app too); "app" = in the app only; "on" = in the app and the Android notification.
 * - live update (Android app): the timer at the far left of the status bar and on top
 *   of the lock screen, or a plain notification. A live update ticks only when the
 *   running time is "on" (the status-bar chip and the notification share one clock),
 *   otherwise it shows just the area icon.
 * Both are stored on the area (missing = on), so they travel with backups.
 */
export const areaRunningTime = (a: Pick<Area, 'runningTime'> | undefined): RunningTime => a?.runningTime ?? 'on';
export const areaLiveUpdate = (a: Pick<Area, 'liveUpdate'> | undefined) => a?.liveUpdate !== false;
/** Does the app show a ticking time for this area? */
export const ticksInApp = (a: Pick<Area, 'runningTime'> | undefined) => areaRunningTime(a) !== 'off';
