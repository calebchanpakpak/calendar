/* Calendar V3 — local-first model + background sync engine (pattern copied from Vault V3's sync.js).
 *  - The phone keeps a copy of the calendar (IndexedDB 'calendar-v3'): the app opens instantly, also offline.
 *  - Every add / edit / delete is applied on the phone at once and queued in the outbox; the queue is sent to the
 *    Apps Script API (Api.gs doPost) in the background, in order. Each op has an op id + phone-made row ids,
 *    so a resend never makes a second row or a second Google Calendar event.
 *  - Pull = 'boot' with the last hash: unchanged data costs one tiny reply.
 *  - Single-flight, exponential backoff (5 s → 5 min), navigator.locks so two tabs never send at once.
 */
(function (root) {
  'use strict';
  const DEFAULTS = { pullGapMs: 15000, backoffBaseMs: 5000, backoffMaxMs: 300000, batch: 5, intervalMs: 600000, maxTries: 8 };
  const clone = o => JSON.parse(JSON.stringify(o));
  const bySeq = (a, b) => a.seq - b.seq;

  /* ======================= model (pure; also used by the tests) ======================= */
  const PREFIX_RE = /^[A-Za-z]\s*[:：]/;
  const familyTitle = (s, prefix) => { s = String(s || '').trim(); return PREFIX_RE.test(s) ? s : (prefix || 'C:') + s; };
  const dupFamilyTitle = (s, prefix) => { s = String(s || '').trim(); return PREFIX_RE.test(s) ? s : (prefix || 'C:') + ' ' + s; };
  const pad = n => String(n).padStart(2, '0');
  const ymdUTC = s => { const p = s.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); };
  const isoDay = d => d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  function plusMinutes(date, time, mins) {
    const t = time.split(':').map(Number), d = ymdUTC(date);
    const total = t[0] * 60 + t[1] + mins, days = Math.floor(total / 1440), m = ((total % 1440) + 1440) % 1440;
    d.setUTCDate(d.getUTCDate() + days);
    return { date: isoDay(d), time: pad(Math.floor(m / 60)) + ':' + pad(m % 60) };
  }
  /** Same rule text as Code.gs buildRRule_. */
  function buildRRule(rep, day, allDay) {
    if (!rep || !rep.freq || rep.freq === 'none') return '';
    const freq = { weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' }[rep.freq];
    if (!freq) return '';
    const p = day.split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    const wd = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][d.getUTCDay()];
    const parts = ['FREQ=' + freq];
    const interval = Math.max(1, parseInt(rep.interval, 10) || 1);
    if (interval > 1) parts.push('INTERVAL=' + interval);
    if (freq === 'WEEKLY') parts.push('BYDAY=' + wd);
    if ((freq === 'MONTHLY' || freq === 'YEARLY') && rep.mode === 'weekday') {
      const n = Math.ceil(p[2] / 7), pos = n === 5 ? -1 : n;
      if (freq === 'YEARLY') parts.push('BYMONTH=' + p[1]);
      parts.push('BYDAY=' + pos + wd);
    } else if (freq === 'MONTHLY') parts.push('BYMONTHDAY=' + p[2]);
    if (rep.end === 'count' && parseInt(rep.count, 10) > 0) parts.push('COUNT=' + parseInt(rep.count, 10));
    else if (rep.end === 'until' && /^\d{4}-\d{2}-\d{2}$/.test(rep.until || '')) { const u = rep.until.replace(/-/g, ''); parts.push('UNTIL=' + (allDay ? u : u + 'T235959Z')); }
    return 'RRULE:' + parts.join(';');
  }
  /** Same text as Code.gs addExdate_. */
  function addExdate(rec, day, hm) {
    const parts = String(rec || '').split(' | ');
    const i = parts.findIndex(p => p.indexOf('EXDATE:') === 0);
    if (i < 0) { parts.push('EXDATE: ' + day + ' ' + hm); return parts.join(' | '); }
    const list = parts[i].slice(7).split(',').map(x => x.trim()).filter(Boolean);
    if (!list.some(x => x.slice(0, 10) === day)) list.push(day + ' ' + hm);
    parts[i] = 'EXDATE: ' + list.join(', ');
    return parts.join(' | ');
  }
  const isAppSeries = e => !!(e && e.recurrence && String(e.recurrence).indexOf('RRULE:') === 0 && !e.gcalOccurrence);
  /** Same checks as Code.gs parseEventForm_ (so a change the server would refuse is refused on the phone first). */
  function validate(form) {
    if (!String(form.title || '').trim() || !form.date) return 'Title and date are required.';
    if (form.category === 'both' && !String(form.familyTitle || '').trim()) return 'Type a family title for the family copy (e.g. C: mom).';
    const allDay = !!form.allDay || !form.startTime;
    if (allDay) { if (form.endDate && form.endDate < form.date) return 'End is before start.'; }
    else if (form.endTime && (form.endDate || form.date) + ' ' + form.endTime < form.date + ' ' + form.startTime) return 'End is before start.';
    return '';
  }
  /** Event as getEvents() would return it after the server saved this form. */
  function eventFrom(form, category, meta, id) {
    const fam = category === 'family', famColor = meta.familyColor || 'orange';
    const allDay = !!form.allDay || !form.startTime;
    let endDate, endTime = '';
    if (allDay) endDate = form.endDate || form.date;
    else if (form.endTime) { endDate = form.endDate || form.date; endTime = form.endTime; }
    else { const x = plusMinutes(form.date, form.startTime, 60); endDate = x.date; endTime = x.time; }
    const colors = meta.colors || {};
    return {
      id: id, title: fam ? familyTitle(form.title, meta.familyPrefix) : String(form.title || '').trim(),
      date: form.date, time: allDay ? '' : form.startTime, endDate: endDate, endTime: endTime, allDay: allDay,
      category: fam ? 'family' : 'personal',
      color: fam ? famColor : (colors[form.color] && form.color !== famColor ? form.color : (meta.defaultColor || 'blue')),
      source: 'new', description: String(form.description || ''),
      recurrence: form.repeat && form.repeat.freq === 'keep' ? null : buildRRule(form.repeat, form.date, allDay),
      gcal: false, gcalOccurrence: false, _pending: true
    };
  }
  /** Applies one queued op to a list of events (returns a new list). Idempotent; mirrors Code.gs. */
  function applyOp(list, op, meta) {
    const has = id => !!id && list.some(e => String(e.id) === String(id));
    const at = id => list.findIndex(e => String(e.id) === String(id));
    if (op.kind === 'add') {
      const f = op.form;
      if (has(f.newId) || has(f.newId2)) return list;
      if (f.category === 'both') {
        const p = eventFrom(f, 'personal', meta, f.newId2);
        const fam = eventFrom(Object.assign({}, f, { title: dupFamilyTitle(f.familyTitle, meta.familyPrefix) }), 'family', meta, f.newId);
        p.recurrence = p.recurrence || ''; fam.recurrence = fam.recurrence || '';
        return list.concat([p, fam]);
      }
      const e = eventFrom(f, f.category === 'family' ? 'family' : 'personal', meta, f.newId);
      e.recurrence = e.recurrence || '';
      return list.concat([e]);
    }
    if (op.kind === 'update') {
      const f = op.form, i = at(f.id);
      if (i < 0 || has(f.newId) || has(f.copyId)) return list;
      const e = list[i], dup = f.category === 'both';
      let n, copy = null;
      if (dup) {
        const rowFam = e.category === 'family';
        const pF = eventFrom(f, 'personal', meta, ''), famF = eventFrom(Object.assign({}, f, { title: dupFamilyTitle(f.familyTitle, meta.familyPrefix) }), 'family', meta, '');
        n = rowFam ? famF : pF; copy = rowFam ? pF : famF; copy.id = f.copyId || ('c-tmp' + op.id);
      } else n = eventFrom(f, f.category === 'family' ? 'family' : 'personal', meta, '');
      const out = list.slice();
      if (f.scope === 'this' && isAppSeries(e)) {
        out[i] = Object.assign({}, e, { recurrence: addExdate(e.recurrence, f.occurrence, e.allDay ? '00:00' : e.time), _pending: true });
        n.id = f.newId || ('c-tmp1' + op.id); n.recurrence = ''; n.source = e.source || 'new';
        out.push(n);
        if (copy) { copy.recurrence = ''; out.push(copy); }
        return out;
      }
      const oldRec = String(e.recurrence || '');
      const exPart = oldRec.split(' | ').filter(x => x.indexOf('EXDATE:') === 0).join(' | ');
      const rec = e.gcalOccurrence ? oldRec : n.recurrence === null ? oldRec : (n.recurrence && exPart ? n.recurrence + ' | ' + exPart : n.recurrence);
      out[i] = Object.assign({}, e, n, { id: e.id, source: e.source, recurrence: rec, gcal: n.category === 'family' ? e.gcal : false, gcalOccurrence: e.gcalOccurrence });
      if (copy) { copy.recurrence = e.gcalOccurrence ? '' : rec; out.push(copy); }
      return out;
    }
    if (op.kind === 'delete') {
      const r = op.ref, i = at(r.id);
      if (i < 0) return list;
      const e = list[i], out = list.slice();
      if (r.scope === 'this' && isAppSeries(e) && r.occurrence) {
        out[i] = Object.assign({}, e, { recurrence: addExdate(e.recurrence, r.occurrence, e.allDay ? '00:00' : e.time), _pending: true });
        return out;
      }
      out.splice(i, 1);
      return out;
    }
    return list;
  }
  const sortEvents = list => list.sort((a, b) => (a.date + a.time) < (b.date + b.time) ? -1 : (a.date + a.time) > (b.date + b.time) ? 1 : 0);
  /** Today on this phone (yyyy-MM-dd, the phone's time zone). */
  function localToday(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function rid(prefix, n) {
    const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const c = root.crypto && root.crypto.getRandomValues ? root.crypto.getRandomValues(new Uint8Array(n)) : Array.from({ length: n }, () => Math.floor(Math.random() * 256));
    return prefix + Array.from(c, x => abc[x % abc.length]).join('');
  }

  /* ======================= transport ======================= */
  /** fetch → Apps Script (Api.gs doPost). text/plain = no CORS preflight; follows the 302 to googleusercontent. */
  function fetchApi(getCfg, opts) {
    opts = opts || {};
    return async function api(action, payload, timeoutMs) {
      const c = getCfg() || {};
      if (!c.url) { const e = new Error('未設定 Apps Script 網址'); e.config = true; throw e; }
      const f = opts.fetch || root.fetch.bind(root);
      const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), timeoutMs || 30000);
      const body = JSON.stringify({ action: action, payload: payload || [], token: c.token || '' });
      let res, text;
      try {
        res = await f(c.url, { method: 'POST', redirect: 'follow', cache: 'no-store', signal: ctrl.signal,
          headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body });
        text = await res.text();
      } catch (err) {
        const e = new Error('連唔到伺服器（離線、網絡慢或者部署存取權）'); e.network = true; throw e;
      } finally { clearTimeout(timer); }
      let j;
      try { j = JSON.parse(text); } catch (err) { const e = new Error('伺服器回覆唔係 JSON：檢查網址（/exec）'); e.server = true; throw e; }
      if (!j.ok) { const e = new Error(j.error || '伺服器出錯'); e.server = true; e.auth = /UNAUTHORIZED/.test(j.error || ''); throw e; }
      return j.result;
    };
  }

  /* ======================= engine ======================= */
  function create(o) {
    const db = o.db, now = o.now || (() => Date.now());
    const opt = Object.assign({}, DEFAULTS, o.options || {});
    const listeners = []; if (o.onChange) listeners.push(o.onChange);
    const resultListeners = [];   // every finished sync (incl. automatic retries / reruns) -> the app's toast
    let cfg = { url: '', token: '' };
    const api = o.api || fetchApi(() => cfg, { fetch: o.fetch });
    let server = null;          // {hash, boot}
    let outbox = [], failed = [];
    let meta = { lastOkAt: 0, lastPullAt: 0, failCount: 0, nextAttemptAt: 0, lastError: '', lastGoogleSyncAt: 0 };
    let inflight = new Set(), running = null, rerun = null, state = 'idle', lastSeq = 0, ver = 0, viewCache = null;
    let timers = null, intervalId = null, retryId = null;

    const emit = changed => { if (changed) { ver++; viewCache = null; } const s = status(); listeners.forEach(fn => { try { fn(s); } catch (e) {} }); };
    const nextSeq = () => (lastSeq = Math.max(now() * 1000, lastSeq + 1));
    const saveMeta = () => db.put('meta', { k: 'sync', v: meta });

    async function init() {
      const rows = await db.getAll('meta');
      rows.forEach(r => { if (r.k === 'server') server = r.v; else if (r.k === 'cfg') cfg = Object.assign({ url: '', token: '' }, r.v); else if (r.k === 'sync') meta = Object.assign(meta, r.v); });
      outbox = (await db.getAll('outbox')).sort(bySeq);
      failed = await db.getAll('failed');
      lastSeq = outbox.reduce((m, x) => Math.max(m, x.seq), 0);
      emit(true);
    }
    const bootMeta = () => { const b = server ? server.boot : {}; const m = Object.assign({ colors: {}, presets: {}, suggestions: [], guests: [] }, b); delete m.events; m.today = localToday(new Date(now())); return m; };
    /** What the app shows: server copy + every queued (and sent-but-not-yet-pulled) change. */
    function view() {
      if (viewCache) return viewCache;
      const m = bootMeta();
      let list = server && server.boot ? clone(server.boot.events || []) : [];
      outbox.forEach(op => { list = applyOp(list, op, m); });
      viewCache = { meta: m, events: sortEvents(list) };
      return viewCache;
    }
    /** kind 'add' (form), 'update' (form), 'delete' (ref). Applies at once, then queues. Returns the op. */
    function enqueue(kind, data) {
      data = clone(data);
      const op = { id: rid('o', 20), seq: nextSeq(), kind: kind, at: now(), done: false, tries: 0 };
      if (kind === 'delete') op.ref = data;
      else {
        if (kind === 'add') { data.newId = data.newId || rid('c-', 14); if (data.category === 'both') data.newId2 = data.newId2 || rid('c-', 14); }
        if (kind === 'update') { if (data.scope === 'this') data.newId = data.newId || rid('c-', 14); if (data.category === 'both') data.copyId = data.copyId || rid('c-', 14); }
        delete data.submitId;
        op.form = data;
      }
      outbox.push(op);
      const p = db.put('outbox', op);   // opened in the same tick: a later read always sees it
      emit(true);
      return p.then(() => op);
    }
    const wire = op => op.kind === 'delete' ? { opId: op.id, kind: op.kind, ref: op.ref } : { opId: op.id, kind: op.kind, form: op.form };
    function toFailed(op, error, sum) {
      const f = { id: op.id, op: op, error: error, at: now() };
      failed.push(f); outbox = outbox.filter(x => x.id !== op.id);
      if (sum) sum.failed.push(f);
      return db.tx(['outbox', 'failed'], 'readwrite', s => { s.outbox.delete(op.id); s.failed.put(f); });
    }
    async function flushAll(sum) {
      for (let round = 0; round < 100; round++) {
        const batch = outbox.filter(x => !x.done).slice(0, opt.batch);
        if (!batch.length) return;
        batch.forEach(op => inflight.add(op.id)); emit();
        let out;
        try { out = await api('sync', [batch.map(wire)], 150000); }
        finally { batch.forEach(op => inflight.delete(op.id)); }
        let again = false;
        for (const r of (out && out.results) || []) {
          const op = outbox.find(x => x.id === r.opId); if (!op) continue;
          if (r.ok) { op.done = true; op.doneAt = now(); op.res = r.res || null; sum.ok++; await db.put('outbox', op); }
          else if (r.notRun) again = true;
          else if (r.retry) { op.tries++; op.lastError = r.error; again = true; if (op.tries >= opt.maxTries) await toFailed(op, r.error, sum); else await db.put('outbox', op); }
          else await toFailed(op, r.error || 'failed', sum);
        }
        sum.sent += batch.length; emit(true);
        if (again) { const e = new Error('日曆忙緊（Google 同步中），遲啲自動再試'); e.busy = true; throw e; }
      }
    }
    async function pull(sum) {
      const t0 = now();
      const res = await api('boot', [server ? server.hash : ''], 90000);
      if (res && res.boot) { server = { hash: res.hash, boot: res.boot }; await db.put('meta', { k: 'server', v: server }); sum.changed = true; }
      const drop = outbox.filter(x => x.done && x.doneAt <= t0);
      if (drop.length) { outbox = outbox.filter(x => drop.indexOf(x) < 0); await db.tx('outbox', 'readwrite', s => drop.forEach(x => s.outbox.delete(x.id))); }
      meta.lastPullAt = now(); sum.pulled = true; emit(true);
    }
    function lockWrap(fn) {
      const L = root.navigator && root.navigator.locks;
      return L && L.request ? L.request('calendar-v3-sync', fn) : fn();   // own lock name (Vault uses vault-v3-sync)
    }
    /** One sync (single-flight): send the outbox → pull → send anything added meanwhile.
     *  trigger: open / online / visible / timer / retry / write / manual */
    function syncAll(opts) {
      opts = opts || {};
      const trigger = opts.trigger || 'manual', manual = !!opts.manual || trigger === 'manual';
      if (!cfg.url) return Promise.resolve({ skipped: 'nocfg' });
      if (running) { if (!rerun || manual || trigger !== 'write') rerun = { trigger: trigger, manual: manual }; return running; }
      if (!manual && now() < meta.nextAttemptAt) return Promise.resolve({ skipped: 'backoff', retryAt: meta.nextAttemptAt });
      const sum = { trigger: trigger, sent: 0, ok: 0, failed: [], pulled: false, changed: false, first: !server };
      running = (async () => {
        state = 'syncing'; emit();
        try {
          await lockWrap(async () => {
            const stored = (await db.getAll('outbox')).sort(bySeq);   // another tab may have sent / added ops
            const before = JSON.stringify(outbox.map(x => x.id + x.done));
            outbox = stored; if (JSON.stringify(outbox.map(x => x.id + x.done)) !== before) emit(true);
            await flushAll(sum);
            const wantPull = !server || sum.sent > 0 || trigger !== 'write';
            if (wantPull && (manual || !server || sum.sent > 0 || now() - meta.lastPullAt > opt.pullGapMs)) await pull(sum);
            if (outbox.some(x => !x.done)) await flushAll(sum);
          });
          meta.failCount = 0; meta.nextAttemptAt = 0; meta.lastError = ''; meta.lastOkAt = now(); state = 'idle';
        } catch (err) {
          meta.failCount++;
          meta.nextAttemptAt = now() + Math.min(opt.backoffMaxMs, opt.backoffBaseMs * Math.pow(2, meta.failCount - 1));
          meta.lastError = String(err && err.message || err);
          state = err && err.network ? 'offline' : 'error';
          sum.error = meta.lastError; sum.network = !!(err && err.network); sum.auth = !!(err && err.auth); sum.busy = !!(err && err.busy);
        }
        saveMeta().catch(() => {});
        return sum;
      })();
      const p = running;
      p.then(sum => {
        running = null; emit();
        resultListeners.forEach(fn => { try { fn(sum); } catch (e) {} });
        const r = rerun; rerun = null;
        if (r && (outbox.some(x => !x.done) || r.manual || r.trigger !== 'write')) syncAll(r);
        else scheduleRetry();
      });
      return p;
    }
    function scheduleRetry() {
      if (!timers) return;
      if (retryId) { timers.clearTimeout(retryId); retryId = null; }
      if (meta.nextAttemptAt > now() && cfg.url) retryId = timers.setTimeout(() => { retryId = null; syncAll({ trigger: 'retry' }); }, meta.nextAttemptAt - now() + 50);
    }
    /** While the app is open: sync every intervalMs (10 min); failures retry with backoff. */
    function startAuto(a) {
      a = a || {};
      timers = a.timers || { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: id => clearTimeout(id), setInterval: (f, ms) => setInterval(f, ms), clearInterval: id => clearInterval(id) };
      if (intervalId) timers.clearInterval(intervalId);
      intervalId = timers.setInterval(() => syncAll({ trigger: 'timer' }), a.intervalMs || opt.intervalMs);
      scheduleRetry();
    }
    function stopAuto() { if (timers) { if (intervalId) timers.clearInterval(intervalId); if (retryId) timers.clearTimeout(retryId); } intervalId = retryId = null; }
    function status() {
      return { state: running ? 'syncing' : state, pending: outbox.filter(x => !x.done).length, inflight: inflight.size, failed: failed.length,
        lastOkAt: meta.lastOkAt, lastPullAt: meta.lastPullAt, lastError: meta.lastError, nextAttemptAt: meta.nextAttemptAt, failCount: meta.failCount,
        hasData: !!server, configured: !!cfg.url, lastGoogleSyncAt: meta.lastGoogleSyncAt };
    }
    /** Online-only actions (guests, duplicates, Google sync now). */
    function call(action, payload, timeoutMs) { return api(action, payload || [], timeoutMs); }
    async function syncGoogle() {
      await api('syncGoogle', [], 300000);
      meta.lastGoogleSyncAt = now(); await saveMeta();
      return syncAll({ trigger: 'manual', manual: true });
    }
    return {
      init, view, enqueue, syncAll, startAuto, stopAuto, status, call, syncGoogle,
      onChange: fn => listeners.push(fn),
      onResult: fn => resultListeners.push(fn),
      setCfg(url, token) { cfg = { url: String(url || '').trim(), token: String(token || '').trim() }; meta.failCount = 0; meta.nextAttemptAt = 0; return db.put('meta', { k: 'cfg', v: cfg }).then(() => emit()); },
      clearFailed() { failed = []; return db.clear('failed').then(() => emit(true)); },
      get cfg() { return cfg; }, get ver() { return ver; }, get server() { return server; }, get outbox() { return outbox; }, get failed() { return failed; }
    };
  }

  const CalSync = { create, fetchApi, applyOp, eventFrom, buildRRule, addExdate, validate, familyTitle, dupFamilyTitle, isAppSeries, localToday, rid };
  if (typeof module !== 'undefined' && module.exports) module.exports = CalSync; else root.CalSync = CalSync;
})(typeof self !== 'undefined' ? self : globalThis);
