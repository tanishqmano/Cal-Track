/* window.storage — persistent async key/value store.

   Uses the host-provided window.storage when one exists, otherwise installs an
   IndexedDB-backed implementation. (No localStorage anywhere in this app.)

   Imported for its side effect, and imported first, so the store exists before
   anything reaches for it. */

(function () {
  if (window.storage && typeof window.storage.getItem === 'function') return;

  const DB = 'macro-tracker', STORE = 'kv';
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    return dbp;
  }

  function tx(mode, fn) {
    return open().then(db => new Promise((res, rej) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.onabort = t.onerror = () => rej(t.error);
      t.oncomplete = () => res(req ? req.result : undefined);
    }));
  }

  window.storage = {
    getItem: k => tx('readonly', s => s.get(k)).then(v => (v === undefined ? null : v)),
    setItem: (k, v) => tx('readwrite', s => s.put(v, k)).then(() => undefined),
    removeItem: k => tx('readwrite', s => s.delete(k)).then(() => undefined)
  };

  // Ask the browser not to evict this data. iOS Safari clears script-writable
  // storage for sites untouched for 7 days; granting persistence avoids losing
  // a log after a week away. Silently ignored where unsupported.
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persisted()
      .then(p => (p ? true : navigator.storage.persist()))
      .catch(() => {});
  }
})();
