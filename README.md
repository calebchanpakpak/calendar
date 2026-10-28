# Calendar (V3.1)

Caleb's calendar as an installable web app (PWA) – opens instantly and works offline.

- The calendar is kept on the phone (IndexedDB). Adds, edits and deletes show at once and wait in an outbox.
- The outbox is sent to the Google Apps Script API in the background: when the app opens, comes back online,
  is opened again, and every 10 minutes. The pill at the top right shows offline / syncing / synced / errors.
- The server (Apps Script, not in this repo) writes the Google Sheet and Google Calendar and syncs them every 5 minutes.
- The server address and the calendar's own token are typed in once (⚙︎ › Connection) and stay on the phone.
  **Neither is in this repository.**

**V3.1:** Add defaults end = start + 1 hour (until you edit end); stable title autocomplete from local events;
Month festival wallpaper (10 computed festivals – never events); fixed equal Month cells that fit one iPhone screen.

Files: `index.html`, `sync.js`, `idb.js`, `festivals.js`, `sw.js`, `manifest.json`, `icons/`.
