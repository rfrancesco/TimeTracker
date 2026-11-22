import { useEffect, useState } from 'react';
import type { ActiveTimer } from './db';
import { sameTimer } from './timer';

/**
 * The running timer as the database has it, or what an action is about to store:
 * on the phone the undo snapshots + write take a noticeable moment, and the timer
 * shouldn't lag the tap. The preview is dropped once the database says the same
 * (the live query can trail the action by a moment), at once if the action fails,
 * and a second after it finishes in any case.
 */
export function useOptimisticActive(stored: ActiveTimer | undefined) {
  const [pending, setPending] = useState<{ active: ActiveTimer | null } | null>(null);
  useEffect(() => {
    if (pending && sameTimer(stored, pending.active)) setPending(null);
  }, [stored, pending]);

  async function showing<T>(next: ActiveTimer | null, action: () => Promise<T>) {
    const mine = { active: next };
    setPending(mine);
    const drop = () => setPending((p) => (p === mine ? null : p));
    try {
      const result = await action();
      window.setTimeout(drop, 1000);
      return result;
    } catch (e) {
      drop();
      throw e;
    }
  }
  const active = pending ? (pending.active ?? undefined) : stored;
  return { active, showing };
}
