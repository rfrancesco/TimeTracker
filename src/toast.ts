import { useIonToast, type ToastOptions } from '@ionic/react';

/** id of the app's tab bar, so overlays can sit above it instead of covering it. */
export const TAB_BAR_ID = 'app-tab-bar';

/** One message at a time, app-wide: close whatever toast is showing (from any hook). */
export async function dismissAllToasts() {
  await Promise.all(
    [...document.querySelectorAll('ion-toast')].map((t) => (t as HTMLElement & { dismiss: () => Promise<boolean> }).dismiss().catch(() => false)),
  );
}

/**
 * Snackbar-style message anchored just above the tab bar (never blocks the tabs).
 * A new message replaces one that is still showing, like Android snackbars: Ionic's
 * toast hook would otherwise silently drop it (e.g. "Backup restored" right after
 * "App reset to defaults").
 */
export function useToast() {
  const [present, dismiss] = useIonToast();
  return async (message: string, options: ToastOptions = {}) => {
    await dismiss().catch(() => {});
    await dismissAllToasts();
    await present({ message, duration: 2500, position: 'bottom', positionAnchor: TAB_BAR_ID, ...options });
  };
}
