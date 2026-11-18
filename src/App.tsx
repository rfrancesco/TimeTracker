import { useEffect, useRef } from 'react';
import { Navigate, Route, useLocation } from 'react-router-dom';
import {
  IonApp, IonIcon, IonLabel, IonRouterOutlet, IonTabBar, IonTabButton, IonTabs, setupIonicReact,
} from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { timerOutline, calendarOutline, barChartOutline, settingsOutline } from 'ionicons/icons';

import TimerPage from './pages/TimerPage';
import DayPage from './pages/DayPage';
import ReportPage from './pages/ReportPage';
import SettingsPage from './pages/SettingsPage';
import { TAB_BAR_ID, setThemeColor, useActive, useAreas, useDarkMode, useNow, useToast } from './hooks';
import { BACKGROUND_TINT, themeBackground, tintOverBackground } from './color';
import { formatHex, parse } from 'culori';
import { formatDuration } from './timer';
import { NativeTimerSync } from './native';
import { ticksInApp } from './runningTime';

import '@ionic/react/css/core.css';
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';
import '@ionic/react/css/padding.css';
import '@ionic/react/css/flex-utils.css';
import '@ionic/react/css/display.css';
import '@ionic/react/css/palettes/dark.class.css';
import './theme.css';

// Ionic picks 'md' (Material) on Android and 'ios' on iPhone automatically.
setupIonicReact();

/** Timer tab label: the elapsed time while tracking (unless the area's running time is off), else "Timer". */
function TimerTabLabel() {
  const active = useActive();
  const area = useAreas(true).find((a) => a.id === active?.areaId);
  const ticking = !!active && ticksInApp(area);
  const now = useNow(1000, ticking);
  return <IonLabel>{ticking ? formatDuration(now - new Date(active!.start).getTime()) : 'Timer'}</IonLabel>;
}

/**
 * After the service worker installs a new version, the app reloads itself.
 * Comparing the running build with the last one seen on this device tells us
 * an update just happened (nothing is shown on the very first launch).
 */
function UpdateNotice() {
  const toast = useToast();
  useEffect(() => {
    let last: string | null = null;
    try {
      last = localStorage.getItem('lastBuild');
      localStorage.setItem('lastBuild', __APP_BUILD__);
    } catch {
      return;
    }
    if (last && last !== __APP_BUILD__) toast('App updated to the latest version', { duration: 3000 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/** The header bar colour of the other pages, read from the theme rather than hard-coded. */
function toolbarColor(dark: boolean) {
  const css = getComputedStyle(document.documentElement);
  const raw = css.getPropertyValue('--ion-toolbar-background').trim() || css.getPropertyValue('--ion-background-color').trim();
  const c = raw ? parse(raw) : undefined;
  return c ? formatHex(c) : themeBackground(dark);
}

// Must match the page fade-through in theme.css (ion-tabs .ion-page animation).
const PAGE_FADE = { duration: 220, easing: 'cubic-bezier(0.2, 0, 0, 1)' };

let cancelFade: (() => void) | null = null;

/**
 * Fade the status bar in step with the page fade-through. During a tab switch the
 * old page vanishes at once and the new one fades in over the app background, so
 * the top of the screen goes from the background colour to the new page's colour.
 * The browser runs the identical animation on a hidden element and we copy its
 * colour to the status bar each frame, so timing and easing match exactly.
 */
function fadeStatusBar(from: string, to: string) {
  cancelFade?.();
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    setThemeColor(to);
    return;
  }
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;width:0;height:0;pointer-events:none;visibility:hidden';
  document.body.appendChild(probe);
  const anim = probe.animate([{ color: from }, { color: to }], { ...PAGE_FADE, fill: 'forwards' });
  setThemeColor(from); // same frame as the page change, not the next one
  let raf = 0;
  const step = () => {
    const c = parse(getComputedStyle(probe).color);
    if (c) setThemeColor(formatHex(c));
    if (anim.playState === 'running') raf = requestAnimationFrame(step);
    else finish();
  };
  const finish = () => {
    cancelAnimationFrame(raf);
    anim.cancel();
    probe.remove();
    setThemeColor(to);
    cancelFade = null;
  };
  cancelFade = finish;
  raf = requestAnimationFrame(step);
}

/**
 * The Android status bar matches what is directly under it: the (tinted) page on
 * Timer, the header bar everywhere else. On a page change it fades along with the
 * page; other changes (switching area, theme) are instant, like the page itself.
 */
function statusTarget(onTimer: boolean, areaColor: string | undefined, dark: boolean) {
  if (!onTimer) return toolbarColor(dark);
  return areaColor ? tintOverBackground(areaColor, BACKGROUND_TINT, dark) : themeBackground(dark);
}

/**
 * Keeps the status bar in step with the page shown. Ionic reveals a tab page by
 * removing its `ion-page-hidden` class; a MutationObserver sees that change before
 * the frame is drawn, so the fade starts in exactly the frame the page appears,
 * whatever caused the navigation (tab tap, back gesture…). Other changes (switching
 * area, theme) apply instantly, like the page itself.
 */
function StatusBarSync({ areaColor, dark }: { areaColor?: string; dark: boolean }) {
  const { pathname } = useLocation();
  const onTimer = pathname === '/' || pathname.startsWith('/timer');
  const latest = useRef({ areaColor, dark });
  latest.current = { areaColor, dark };

  useEffect(() => {
    const tabs = document.querySelector('ion-tabs');
    if (!tabs) return;
    // Header height of each page, measured while it is visible (a hidden page measures 0).
    const headerHeight = new WeakMap<HTMLElement, number>();
    const measure = (el: HTMLElement) =>
      requestAnimationFrame(() => headerHeight.set(el, el.querySelector('ion-header')?.getBoundingClientRect().height ?? 0));
    const visiblePage = () =>
      [...tabs.querySelectorAll<HTMLElement>('.ion-page')].find((x) => !x.classList.contains('ion-page-hidden'));
    let shown = visiblePage() ?? null;
    if (shown) measure(shown);
    let clearUnderlay = 0;

    // The colours at the top of a page and of its content.
    const colours = (el: HTMLElement) => {
      const { areaColor: c, dark: d } = latest.current;
      const timer = el.classList.contains('timer-page');
      const top = statusTarget(timer, c, d);
      return { top, content: timer ? top : themeBackground(d) };
    };

    const revealed = (el: HTMLElement) => {
      const prev = shown;
      shown = el;
      measure(el);
      const next = colours(el);
      const outlet = el.parentElement;
      if (!prev || prev === el || !outlet) {
        fadeStatusBar(themeBackground(latest.current.dark), next.top);
        return;
      }
      // Crossfade the colours: while the new page fades in, paint the old page's
      // colour layout (header band + content) behind it instead of the bare app
      // background. Pages with the same header colour then don't dip at all, and
      // the status bar blends straight from the old top colour to the new one.
      const old = colours(prev);
      const h = headerHeight.get(prev) ?? 0;
      outlet.style.background = `linear-gradient(to bottom, ${old.top} 0, ${old.top} ${h}px, ${old.content} ${h}px)`;
      outlet.style.setProperty('--underlay-top', old.top);
      window.clearTimeout(clearUnderlay);
      clearUnderlay = window.setTimeout(() => {
        outlet.style.background = '';
        outlet.style.removeProperty('--underlay-top');
      }, PAGE_FADE.duration + 50);
      fadeStatusBar(old.top, next.top);
    };

    const observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'attributes') {
          // An existing page un-hidden (revisiting a tab).
          const el = r.target as HTMLElement;
          if (el.classList.contains('ion-page') && r.oldValue?.includes('ion-page-hidden') && !el.classList.contains('ion-page-hidden')) revealed(el);
        } else {
          // A page created on first visit.
          r.addedNodes.forEach((n) => {
            if (n instanceof HTMLElement && n.classList.contains('ion-page') && !n.classList.contains('ion-page-hidden')) revealed(n);
          });
        }
      }
    });
    observer.observe(tabs, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
    return () => {
      observer.disconnect();
      window.clearTimeout(clearUnderlay);
    };
  }, []);

  // Same page, something else changed (area switched, theme): apply at once.
  const lastPath = useRef(pathname);
  useEffect(() => {
    const pageChanged = lastPath.current !== pathname;
    lastPath.current = pathname;
    if (pageChanged) return; // the observer fades it in with the page
    cancelFade?.();
    setThemeColor(statusTarget(onTimer, areaColor, dark));
  }, [pathname, onTimer, areaColor, dark]);
  return null;
}

export default function App() {
  // While a timer runs, the tab bar carries the area's colour on every page.
  const active = useActive();
  const areas = useAreas(true);
  const dark = useDarkMode();
  const areaColor = areas.find((a) => a.id === active?.areaId)?.color;

  return (
    <IonApp>
      <IonReactRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <IonTabs>
          <IonRouterOutlet>
            <Route path="/timer" element={<TimerPage />} />
            <Route path="/day" element={<DayPage />} />
            <Route path="/reports" element={<ReportPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/" element={<Navigate to="/timer" replace />} />
          </IonRouterOutlet>
          <IonTabBar
            id={TAB_BAR_ID}
            slot="bottom"
            className={areaColor ? 'tracking' : undefined}
            style={areaColor ? { ['--area-color' as string]: areaColor } : undefined}
          >
            <IonTabButton tab="timer" href="/timer">
              <IonIcon icon={timerOutline} />
              <TimerTabLabel />
            </IonTabButton>
            <IonTabButton tab="day" href="/day">
              <IonIcon icon={calendarOutline} />
              <IonLabel>Day</IonLabel>
            </IonTabButton>
            <IonTabButton tab="reports" href="/reports">
              <IonIcon icon={barChartOutline} />
              <IonLabel>Reports</IonLabel>
            </IonTabButton>
            <IonTabButton tab="settings" href="/settings">
              <IonIcon icon={settingsOutline} />
              <IonLabel>Settings</IonLabel>
            </IonTabButton>
          </IonTabBar>
        </IonTabs>
        <UpdateNotice />
        <NativeTimerSync />
        <StatusBarSync areaColor={areaColor} dark={dark} />
      </IonReactRouter>
    </IonApp>
  );
}
