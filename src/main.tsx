import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { requestPersistentStorage } from './db';

// autoUpdate: a new service worker activates and the page reloads on its own.
// Besides the check on launch, look for updates whenever the app returns to the
// foreground (Android keeps PWAs alive in the background) and hourly.
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
    setInterval(check, 60 * 60 * 1000);
  },
});
requestPersistentStorage();

createRoot(document.getElementById('root')!).render(<App />);
