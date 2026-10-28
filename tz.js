/* Calendar V3.2 – client timezone helpers.
 * Sheet / server stay Europe/Helsinki wall-clock. The phone converts for display
 * and converts form values back before enqueue, so optimistic apply + server match.
 * When device zone === Europe/Helsinki every conversion is a no-op (byte-identical).
 */
(function (root) {
  'use strict';
  const STORAGE_TZ = 'Europe/Helsinki';
  const pad = n => String(n).padStart(2, '0');

  function deviceTZ() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || STORAGE_TZ; }
    catch (e) { return STORAGE_TZ; }
  }

  /** Parts of absolute instant `ms` in `tz` → {date:'yyyy-MM-dd', time:'HH:mm'}. */
  function partsInTZ(ms, tz) {
    const dtf = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    });
    const p = {};
    dtf.formatToParts(new Date(ms)).forEach(x => { if (x.type !== 'literal') p[x.type] = x.value; });
    let h = p.hour; if (h === '24') h = '00';
    return { date: p.year + '-' + p.month + '-' + p.day, time: h + ':' + p.minute };
  }

  /** Wall-clock date+time in `tz` → UTC ms (handles DST by iterative correction). */
  function wallToUtcMs(date, time, tz) {
    const [Y, M, D] = date.split('-').map(Number);
    const hm = (time || '00:00').split(':').map(Number);
    const h = hm[0] || 0, m = hm[1] || 0;
    let t = Date.UTC(Y, M - 1, D, h, m, 0);
    for (let i = 0; i < 4; i++) {
      const got = partsInTZ(t, tz);
      const [gy, gm, gd] = got.date.split('-').map(Number);
      const [gh, gmin] = got.time.split(':').map(Number);
      const asIf = Date.UTC(gy, gm - 1, gd, gh, gmin, 0);
      const want = Date.UTC(Y, M - 1, D, h, m, 0);
      const diff = want - asIf;
      if (diff === 0) break;
      t += diff;
    }
    return t;
  }

  function convertWall(date, time, fromTz, toTz) {
    if (!date) return { date: '', time: time || '' };
    if (!time) return { date: date, time: '' }; // all-day / date-only: never shift
    if (fromTz === toTz) return { date: date, time: time };
    return partsInTZ(wallToUtcMs(date, time, fromTz), toTz);
  }

  function helToDevice(date, time, tz) {
    return convertWall(date, time, STORAGE_TZ, tz || deviceTZ());
  }
  function deviceToHel(date, time, tz) {
    return convertWall(date, time, tz || deviceTZ(), STORAGE_TZ);
  }

  /** Minutes past local midnight in device zone. */
  function nowMinutes(tz) {
    const p = partsInTZ(Date.now(), tz || deviceTZ());
    return (+p.time.slice(0, 2)) * 60 + (+p.time.slice(3, 5));
  }

  /** Next whole hour in device zone as {date, time} (for Add defaults). */
  function nextHourLocal(tz) {
    tz = tz || deviceTZ();
    const p = partsInTZ(Date.now() + 3600000, tz); // at least ~now+1h then snap down? use ceil
    // Ceil current local time to next hour
    const cur = partsInTZ(Date.now(), tz);
    let h = +cur.time.slice(0, 2), mi = +cur.time.slice(3, 5);
    let d = cur.date;
    if (mi > 0) h += 1;
    if (h >= 24) { h -= 24; const [Y, M, D] = d.split('-').map(Number); const dt = new Date(Date.UTC(Y, M - 1, D + 1)); d = dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate()); }
    return { date: d, time: pad(h) + ':00' };
  }

  const api = { STORAGE_TZ, deviceTZ, partsInTZ, wallToUtcMs, convertWall, helToDevice, deviceToHel, nowMinutes, nextHourLocal, VERSION: 'V3.2' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CalTz = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
