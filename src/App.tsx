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

import '@ionic/react/css/core.css';
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';
import '@ionic/react/css/padding.css';
import '@ionic/react/css/flex-utils.css';
import '@ionic/react/css/display.css';
import '@ionic/react/css/palettes/dark.system.css';
import './theme.css';

// Ionic picks 'md' (Material) on Android and 'ios' on iPhone automatically.
setupIonicReact();

export default function App() {
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
          <IonTabBar slot="bottom">
            <IonTabButton tab="timer" href="/timer">
              <IonIcon icon={timerOutline} />
              <IonLabel>Timer</IonLabel>
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
