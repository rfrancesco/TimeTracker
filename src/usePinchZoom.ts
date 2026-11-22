import { useEffect, useRef, type RefObject } from 'react';

/**
 * Two-finger pinch on `ref` calls `zoomTo(px × spread ratio, midpoint Y)`. Native
 * listeners, because the move handler must be able to preventDefault (no page zoom).
 */
export function usePinchZoom(ref: RefObject<HTMLElement | null>, getPx: () => number, zoomTo: (px: number, anchorClientY: number) => void) {
  const latest = useRef({ getPx, zoomTo });
  latest.current = { getPx, zoomTo };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let start: { dist: number; px: number } | null = null;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const mid = (t: TouchList) => (t[0].clientY + t[1].clientY) / 2;
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) start = { dist: dist(e.touches), px: latest.current.getPx() };
    };
    const onMove = (e: TouchEvent) => {
      if (!start || e.touches.length !== 2) return;
      e.preventDefault();
      latest.current.zoomTo(start.px * (dist(e.touches) / start.dist), mid(e.touches));
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) start = null;
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [ref]);
}
