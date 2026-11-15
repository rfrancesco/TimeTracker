import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './theme'; // applies the saved light/dark choice before the first render
import App from './App';
import { requestPersistentStorage } from './db';

// autoUpdate: a new service worker activates and the page reloads on its own.
// Besides the check on launch, look for updates whenever the app returns to the
// foreground (Android keeps PWAs alive in the background). The running timer is
// stored as a start timestamp in IndexedDB, so a reload never affects it.
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    const check = () => {
      if (navigator.onLine) registration.update().catch(() => {});
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
  },
});
requestPersistentStorage();

createRoot(document.getElementById('root')!).render(<App />);
