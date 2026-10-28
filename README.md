# Calendar (V3.2)

Caleb's calendar as an installable web app (PWA) – opens instantly and works offline.

- The calendar is kept on the phone (IndexedDB). Adds, edits and deletes show at once and wait in an outbox.
- The outbox is sent to the Google Apps Script API in the background: when the app opens, comes back online,
  is opened again, and every 10 minutes. The pill at the top right shows offline / syncing / synced / errors.
- The server (Apps Script, not in this repo) writes the Google Sheet and Google Calendar and syncs them every 5 minutes.
- The server address and the calendar's own token are typed in once (⚙︎ › Connection) and stay on the phone.
  **Neither is in this repository.**
- Sheet times stay Europe/Helsinki wall-clock; the phone shows them in the device's current timezone and converts back on save.

**V3.2:** Device-timezone display (auto on travel); Month dating-anniversary wallpaper (💛 pink, monthly/yearly + unbounded 100-day marks, diagonal split when overlapping festivals); plus V3.1 end+1h / title suggest / 10 festivals.

Files: `index.html`, `sync.js`, `idb.js`, `tz.js`, `festivals.js`, `sw.js`, `manifest.json`, `icons/`.
