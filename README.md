# Time Tracker

Personal, local-first time tracker PWA built with Ionic React. It uses Material styling on Android and switches to iOS styling automatically on iPhone.

## Develop
    npm install
    npm run dev        # http://localhost:5173
    npm run build      # production build in dist/ (includes service worker + manifest)
    npm run preview    # serve dist/ locally

## Data
Stored in IndexedDB (Dexie), see `src/db.ts`. All timestamps are UTC ISO strings and
every record has a UUID + `updatedAt`, ready to sync to a REST backend later.
The running timer is stored as a start timestamp, so it survives app close and reboot.
Settings → Export/Restore backup for JSON backups.
