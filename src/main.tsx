import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { requestPersistentStorage } from './db';

registerSW({ immediate: true });
requestPersistentStorage();

createRoot(document.getElementById('root')!).render(<App />);
