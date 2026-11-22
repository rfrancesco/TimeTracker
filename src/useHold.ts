import { useRef, useState } from 'react';

/** After HOLD_SHOW ms a press shows as a hold (fill starts); at HOLD_DONE it completes. */
export const HOLD_SHOW = 150;
export const HOLD_DONE = 550;

/**
 * Tap = now, hold = earlier: one press tracker for every holdable thing on a page.
 * `held` is what is being held while its fill runs; `onDone` fires when the hold
 * completes. A press that got as far as showing is not a tap: `wasHold()` tells the
 * click handler so (once), whether the hold completed or was released early (cancel).
 */
export function useHold<T>(onDone: (target: T) => void) {
  const [held, setHeld] = useState<T | null>(null);
  const timers = useRef<number[]>([]);
  const shown = useRef(false);
  const done = useRef(onDone);
  done.current = onDone; // the latest closure, not the one from when the press began

  const clear = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };
  const start = (target: T) => {
    clear();
    shown.current = false;
    timers.current = [
      window.setTimeout(() => {
        shown.current = true;
        setHeld(target);
      }, HOLD_SHOW),
      window.setTimeout(() => {
        setHeld(null);
        done.current(target);
      }, HOLD_DONE),
    ];
  };
  const end = () => {
    clear();
    setHeld(null);
  };
  const wasHold = () => {
    const was = shown.current;
    shown.current = false;
    return was;
  };
  return { held, start, end, wasHold };
}
