import { useEffect } from 'react';
import { Navigate, Route } from 'react-router-dom';
import {
  IonApp, IonIcon, IonLabel, IonRouterOutlet, IonTabBar, IonTabButton, IonTabs, setupIonicReact,
} from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { timerOutline, calendarOutline, barChartOutline, settingsOutline } from 'ionicons/icons';

import TimerPage from './pages/TimerPage';
import DayPage from './pages/DayPage';
import ReportPage from './pages/ReportPage';
import SettingsPage from './pages/SettingsPage';
import { setThemeColor, useActive, useAreas, useDarkMode, useNow } from './hooks';
import { BACKGROUND_TINT, tintOverBackground } from './color';
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

export default function App() {
  // While a timer runs, the tab bar and the Android status bar carry the area's
  // colour on every page (same tint as the Timer page background).
  const active = useActive();
  const areas = useAreas(true);
  const dark = useDarkMode();
  const areaColor = areas.find((a) => a.id === active?.areaId)?.color;
  useEffect(() => {
    setThemeColor(areaColor ? tintOverBackground(areaColor, BACKGROUND_TINT, dark) : dark ? '#1f1f1f' : '#ffffff');
  }, [areaColor, dark]);

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
      </IonReactRouter>
    </IonApp>
  );
}
