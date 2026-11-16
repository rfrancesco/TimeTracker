/**
 * Android back gesture in the browser/PWA.
 *
 * In a browser, "back" just means history.back(), so with a dialog open the page
 * underneath would navigate while the dialog stays. Here every Ionic dialog
 * (modal, alert, action sheet, popover) pushes an invisible history entry when it
 * opens; "back" then pops that entry, and we close the top dialog instead. When a
 * dialog is closed any other way, its entry is removed again so history stays
 * clean. The Android wrapper's back button calls WebView goBack(), which pops the
 * same entries, so this covers the wrapper too.
 */

const OVERLAYS = ['Modal', 'Alert', 'ActionSheet', 'Popover'];

type Overlay = HTMLElement & { dismiss: (data?: unknown, role?: string) => Promise<boolean> };

const stack: Overlay[] = [];
const closedByBack = new WeakSet<Overlay>();
let ignorePops = 0;

function onPresent(e: Event) {
  const el = e.target as Overlay;
  if (stack.includes(el)) return;
  stack.push(el);
  // Same URL and same router state (incl. its index), plus a marker: the router
  // sees no navigation when this entry is added or removed.
  history.pushState({ ...(history.state ?? {}), overlayGuard: stack.length }, '');
}

function onDismiss(e: Event) {
  const el = e.target as Overlay;
  const i = stack.lastIndexOf(el);
  if (i === -1) return;
  stack.splice(i, 1);
  if (closedByBack.has(el)) {
    closedByBack.delete(el); // its history entry was already popped by the gesture
    return;
  }
  // Closed by a button/backdrop: drop the guard entry we added for it.
  if (history.state?.overlayGuard) {
    ignorePops++;
    history.back();
  }
}

function onPopState() {
  if (ignorePops > 0) {
    ignorePops--;
    return;
  }
  const top = stack[stack.length - 1];
  if (!top) return; // no dialog open: a normal back navigation
  closedByBack.add(top);
  top.dismiss(undefined, 'cancel');
}

export function initBackGesture() {
  for (const kind of OVERLAYS) {
    document.addEventListener(`ion${kind}DidPresent`, onPresent);
    document.addEventListener(`ion${kind}DidDismiss`, onDismiss);
  }
  window.addEventListener('popstate', onPopState);
}
