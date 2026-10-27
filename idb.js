/* Calendar V3 — small IndexedDB wrapper (same pattern as Vault V3's idb.js, own database name).
 * tx() opens the transaction synchronously, so later transactions always see earlier writes. */
(function (root) {
  'use strict';
  const DB_NAME = 'calendar-v3', DB_VERSION = 1;   // NOT 'vault-v3': both apps live on the same github.io origin
  const STORES = {
    meta:   { keyPath: 'k' },    // server copy (boot + hash), connection settings, sync info
    outbox: { keyPath: 'id' },   // changes waiting to reach the Sheet / Google Calendar (op id = key, seq = order)
    failed: { keyPath: 'id' }    // changes the server refused
  };
  const req2p = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  function open(opts) {
    opts = opts || {};
    const idb = opts.indexedDB || root.indexedDB;
    return new Promise((res, rej) => {
      const r = idb.open(opts.name || DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => { const db = r.result; Object.keys(STORES).forEach(n => { if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, STORES[n]); }); };
      r.onsuccess = () => res(wrap(r.result));
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('IndexedDB blocked (close other Calendar tabs and reopen)'));
    });
  }
  function wrap(db) {
    db.onversionchange = () => db.close();
    function tx(names, mode, fn) {
      names = [].concat(names);
      const t = db.transaction(names, mode);
      const s = {}; names.forEach(n => { s[n] = t.objectStore(n); });
      let out;
      try { out = fn(s); } catch (e) { try { t.abort(); } catch (x) {} return Promise.reject(e); }
      return new Promise((res, rej) => {
        t.oncomplete = () => Promise.resolve(out).then(res, rej);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error || new Error('transaction aborted'));
      });
    }
    return {
      tx, req: req2p,
      get: (n, k) => { let r; return tx(n, 'readonly', s => { r = s[n].get(k); }).then(() => r.result); },
      getAll: n => { let r; return tx(n, 'readonly', s => { r = s[n].getAll(); }).then(() => r.result || []); },
      put: (n, v) => tx(n, 'readwrite', s => { s[n].put(v); }),
      del: (n, k) => tx(n, 'readwrite', s => { s[n].delete(k); }),
      clear: n => tx(n, 'readwrite', s => { s[n].clear(); }),
      close: () => db.close()
    };
  }
  const CalIDB = { open, STORES, DB_NAME };
  if (typeof module !== 'undefined' && module.exports) module.exports = CalIDB; else root.CalIDB = CalIDB;
})(typeof self !== 'undefined' ? self : globalThis);
