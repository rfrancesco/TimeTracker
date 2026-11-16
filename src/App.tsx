import { useEffect } from 'react';
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

/** Timer tab label: the elapsed time while tracking, "Timer" otherwise. */
function TimerTabLabel() {
  const active = useActive();
  const now = useNow(1000, !!active);
  return <IonLabel>{active ? formatDuration(now - new Date(active.start).getTime()) : 'Timer'}</IonLabel>;
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

/**
 * The Android status bar matches what is directly under it: the (tinted) page on
 * Timer, the header bar everywhere else. It follows the route, so it switches on
 * the tap, together with the tab highlight, while the new page fades in under it.
 */
function StatusBarSync({ areaColor, dark }: { areaColor?: string; dark: boolean }) {
  const { pathname } = useLocation();
  const onTimer = pathname === '/' || pathname.startsWith('/timer');
  useEffect(() => {
    if (onTimer) setThemeColor(areaColor ? tintOverBackground(areaColor, BACKGROUND_TINT, dark) : themeBackground(dark));
    else setThemeColor(toolbarColor(dark));
  }, [onTimer, areaColor, dark]);
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
        <StatusBarSync areaColor={areaColor} dark={dark} />
      </IonReactRouter>
    </IonApp>
  );
}
