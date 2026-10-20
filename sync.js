/*******************************************************************
 * SMS SYNC ENGINE — offline-first data layer for the Data tab.
 * Include this on any page that reads/writes generic records
 * (students, scores, attendance, etc. in future phases).
 *
 * Requires globals set BEFORE this script loads:
 *   window.SMS_API_URL = 'https://script.google.com/.../exec';
 * Reads the session from localStorage key 'sms_session'.
 *******************************************************************/
(function(){
  // Demo mode (see demo-mode.js) supplies its own in-browser store — never touch the real IndexedDB/server.
  if (window.SMS_DEMO) return;
  const DB_NAME = 'sms_offline_db';
  const DB_VERSION = 1;
  const STORE_RECORDS = 'records';   // cached copy of server records, keyed by recordId
  const STORE_OUTBOX = 'outbox';     // pending mutations not yet synced

  let dbPromise = null;
  let syncing = false;
  let autoSyncTimer = null;

  function openDb(){
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { resolve(null); return; } // fallback handled by callers
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_RECORDS)) {
          db.createObjectStore(STORE_RECORDS, { keyPath: 'recordId' }).createIndex('type', 'type');
        }
        if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
          db.createObjectStore(STORE_OUTBOX, { keyPath: 'localId', autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(storeName, mode){
    return openDb().then(db => db.transaction(storeName, mode).objectStore(storeName));
  }

  function reqToPromise(req){
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function getSession(){
    try { return JSON.parse(localStorage.getItem('sms_session') || 'null'); } catch(e){ return null; }
  }

  async function apiCall(payload){
    const session = getSession();
    const res = await fetch(window.SMS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...payload, sessionToken: session && session.sessionToken })
    });
    return res.json();
  }

  /* ============================== PUBLIC: WRITE ============================== */

  // Optimistic local write; queues for sync. Returns the (possibly temporary) recordId.
  async function smsSaveRecord(type, payload, recordId){
    const localId = recordId || ('local_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
    const now = new Date().toISOString();
    const record = { recordId: localId, type, payload, updatedAt: now, _pendingSync: true };

    const store = await tx(STORE_RECORDS, 'readwrite');
    store.put(record);

    const outboxStore = await tx(STORE_OUTBOX, 'readwrite');
    outboxStore.add({ action: 'saveData', body: { recordId: recordId || null, localId, type, payload }, ts: now });

    broadcastStatus();
    if (navigator.onLine) trySync();
    return localId;
  }

  async function smsDeleteRecord(recordId){
    const store = await tx(STORE_RECORDS, 'readwrite');
    store.delete(recordId);
    const outboxStore = await tx(STORE_OUTBOX, 'readwrite');
    outboxStore.add({ action: 'deleteData', body: { recordId }, ts: new Date().toISOString() });

    broadcastStatus();
    if (navigator.onLine) trySync();
  }

  /* ============================== PUBLIC: READ (from local cache) ============================== */

  async function smsGetRecords(type){
    const store = await tx(STORE_RECORDS, 'readonly');
    const idx = store.index('type');
    const all = await reqToPromise(idx.getAll(type));
    return all;
  }

  /* ============================== SYNC ============================== */

  async function getOutboxAll(){
    const store = await tx(STORE_OUTBOX, 'readonly');
    return reqToPromise(store.getAll());
  }

  async function pendingCount(){
    const all = await getOutboxAll();
    return all.length;
  }

  /* ---- Changes the server refused for good (so the user is told, instead of the change silently looping) ---- */
  const LS_REJECTED = 'sms_sync_rejected';
  function recordRejection(item, error){
    let list = [];
    try { list = JSON.parse(localStorage.getItem(LS_REJECTED) || '[]'); } catch (e) {}
    const b = item.body || {};
    list.push({ at: new Date().toISOString(), type: b.type || item.action, name: (b.payload && (b.payload.fullName || b.payload.title || b.payload.name)) || '', error: error || 'Not accepted by the server.' });
    localStorage.setItem(LS_REJECTED, JSON.stringify(list.slice(-20)));
    notify('Change not saved', error || 'The server did not accept a change.');
    window.dispatchEvent(new CustomEvent('sms-sync-rejected', { detail: list[list.length - 1] }));
  }
  function rejectedList(){ try { return JSON.parse(localStorage.getItem(LS_REJECTED) || '[]'); } catch (e) { return []; } }
  function clearRejected(){ localStorage.removeItem(LS_REJECTED); }

  /* ---- Incremental pull bookkeeping (kept in localStorage so every tab/frame shares it) ---- */
  const LS_CURSOR = 'sms_sync_cursor';   // {t, id} of the newest record already in the cache
  const LS_OWNER = 'sms_sync_owner';     // orgId|userId the cache belongs to
  const LS_LASTFULL = 'sms_sync_lastfull';
  const OVERLAP_MS = 2 * 60 * 1000;      // re-ask for the last 2 minutes as a safety margin (merging is idempotent)
  const FULL_RESYNC_MS = 24 * 60 * 60 * 1000; // a full reconcile at least daily, as a safety net
  const PAGE_SIZE = 2000;

  function readCursor(){ try { return JSON.parse(localStorage.getItem(LS_CURSOR) || 'null'); } catch(e){ return null; } }

  // Ids that must NOT be overwritten/re-added by a pull because the user has an unsent change for them.
  async function pendingRecordIds(){
    const ids = new Set();
    (await getOutboxAll()).forEach(item => {
      const b = item.body || {};
      if (b.recordId) ids.add(b.recordId);
      if (b.localId) ids.add(b.localId);
    });
    return ids;
  }

  async function localKeys(){
    const store = await tx(STORE_RECORDS, 'readonly');
    return reqToPromise(store.getAllKeys());
  }

  // Applies one page of changed records to the cache in a single transaction.
  async function upsertRecords(records, pending){
    if (!records.length) return;
    const store = await tx(STORE_RECORDS, 'readwrite');
    records.forEach(r => { if (!pending.has(r.recordId)) store.put(r); });
    await new Promise((res, rej) => { store.transaction.oncomplete = res; store.transaction.onerror = () => rej(store.transaction.error); store.transaction.onabort = () => rej(store.transaction.error); });
  }

  // Replaces the cache with exactly `fresh` (a Map of recordId -> record), in one transaction, keeping
  // anything the user hasn't synced yet. Never leaves the cache empty part-way.
  async function replaceAllRecords(fresh, pending){
    const existing = await localKeys();
    const store = await tx(STORE_RECORDS, 'readwrite');
    existing.forEach(k => { if (!fresh.has(k) && !pending.has(k) && !String(k).startsWith('local_')) store.delete(k); });
    fresh.forEach((rec, id) => { if (!pending.has(id)) store.put(rec); });
    await new Promise((res, rej) => { store.transaction.oncomplete = res; store.transaction.onerror = () => rej(store.transaction.error); store.transaction.onabort = () => rej(store.transaction.error); });
  }

  // Pulls from the server page by page. full=true gathers everything then swaps the cache in one go;
  // otherwise only records changed since `startCursor` are fetched and merged as they arrive.
  async function pullPages(startCursor, full, pending){
    let since = startCursor ? Math.max(0, startCursor.t - OVERLAP_MS) : undefined;
    let afterId;
    let newest = startCursor || null;
    let total = null, legacy = false;
    const fresh = full ? new Map() : null;
    for (let guard = 0; guard < 500; guard++) {
      const resp = await apiCall({ action: 'getData', paged: true, limit: PAGE_SIZE, since, afterId });
      if (!resp || !resp.ok) return { ok: false };
      if (!resp.paged) { // older server: it sent everything in one response
        legacy = true; total = resp.records.length;
        const m = new Map(); resp.records.forEach(r => m.set(r.recordId, r));
        await replaceAllRecords(m, pending);
        return { ok: true, total, newest: null, legacy };
      }
      total = resp.total;
      if (full) resp.records.forEach(r => fresh.set(r.recordId, r));
      else await upsertRecords(resp.records, pending);
      if (resp.cursor) newest = resp.cursor;
      if (!resp.hasMore) break;
      since = resp.cursor.t; afterId = resp.cursor.id;
    }
    if (full) await replaceAllRecords(fresh, pending);
    return { ok: true, total, newest, legacy };
  }

  async function pullLatest(){
    const session = getSession();
    const owner = ((session && session.orgId) || '') + '|' + ((session && session.userId) || '');
    let cursor = readCursor();
    let forceFull = false;

    // A different person (or school) is now signed in on this device: never show them the previous cache.
    if (localStorage.getItem(LS_OWNER) !== owner) {
      const store = await tx(STORE_RECORDS, 'readwrite');
      store.clear();
      await new Promise(res => { store.transaction.oncomplete = res; store.transaction.onerror = res; store.transaction.onabort = res; });
      cursor = null; forceFull = true;
      localStorage.setItem(LS_OWNER, owner); localStorage.removeItem(LS_CURSOR);
    }
    if (!cursor || Date.now() - Number(localStorage.getItem(LS_LASTFULL) || 0) > FULL_RESYNC_MS) forceFull = true;

    const pending = await pendingRecordIds();
    let res = await pullPages(forceFull ? null : cursor, forceFull, pending);
    let didFull = forceFull;

    // Consistency check: after merging, the cache should hold exactly as many server records as the user can see.
    // Anything else (a record deleted or archived elsewhere) means an incremental pull can't be trusted — redo it in full.
    // Skipped while the user still has unsent changes, because the cache is legitimately ahead of the server then.
    if (res.ok && !didFull && !res.legacy && pending.size === 0) {
      const have = (await localKeys()).filter(k => !String(k).startsWith('local_')).length;
      if (have !== res.total) { res = await pullPages(null, true, pending); didFull = true; }
    }
    if (res.ok) {
      if (res.newest) localStorage.setItem(LS_CURSOR, JSON.stringify(res.newest));
      if (didFull) localStorage.setItem(LS_LASTFULL, String(Date.now()));
    }
    return res.ok;
  }

  async function doSync(){
    syncing = true;
    broadcastStatus();
    let pushed = 0, failed = 0, rejected = 0;

    try {
      const outbox = await getOutboxAll();

      for (const item of outbox) {
        try {
          const resp = await apiCall({ action: item.action, ...item.body });
          if (resp.ok) {
            // A fresh transaction every time: the one opened before the network call has already
            // closed by now, so deleting through it silently failed and the item was re-sent on every
            // sync (creating duplicate records on the server).
            const outboxStore = await tx(STORE_OUTBOX, 'readwrite');
            outboxStore.delete(item.localId);
            await new Promise((res, rej) => { outboxStore.transaction.oncomplete = res; outboxStore.transaction.onerror = () => rej(outboxStore.transaction.error); outboxStore.transaction.onabort = () => rej(outboxStore.transaction.error); });
            // If this was a create with a temp local id, replace the cached record with the real one.
            if (item.action === 'saveData' && resp.recordId && item.body.localId && item.body.localId !== resp.recordId) {
              const recStore = await tx(STORE_RECORDS, 'readwrite');
              recStore.delete(item.body.localId);
              recStore.put({ recordId: resp.recordId, type: item.body.type, payload: item.body.payload, updatedAt: new Date().toISOString() });
            } else if (item.action === 'saveData' && item.body.recordId) {
              // An edit that has now reached the server: it is no longer "pending".
              const recStore = await tx(STORE_RECORDS, 'readwrite');
              const cur = await reqToPromise(recStore.get(item.body.recordId));
              if (cur && cur._pendingSync) { delete cur._pendingSync; recStore.put(cur); }
            }
            pushed++;
          } else if (resp.permanent) {
            // The server refused this change on its merits (for example a duplicate admission number). Retrying can
            // never succeed, so drop it instead of re-sending it forever, undo the local copy, and tell the user why.
            const ob = await tx(STORE_OUTBOX, 'readwrite');
            ob.delete(item.localId);
            await new Promise(res => { ob.transaction.oncomplete = res; ob.transaction.onerror = res; ob.transaction.onabort = res; });
            if (item.body.localId && !item.body.recordId) {
              const rs = await tx(STORE_RECORDS, 'readwrite');
              rs.delete(item.body.localId);
              await new Promise(res => { rs.transaction.oncomplete = res; rs.transaction.onerror = res; rs.transaction.onabort = res; });
            }
            localStorage.removeItem(LS_CURSOR);   // force a full refresh so a rejected edit goes back to the server's version
            recordRejection(item, resp.error);
            rejected++;
          } else {
            failed++;
          }
        } catch (e) {
          failed++; // network hiccup mid-sync — leave in outbox, retry next time
        }
      }

      // Pull only what changed on the server since last time (or everything, when a full sync is needed).
      try { await pullLatest(); } catch (e) { /* offline mid-pull — the cache is untouched, try again next time */ }

      localStorage.setItem('sms_last_synced', new Date().toISOString());

      if (pushed > 0) {
        notify('Synced', `${pushed} change${pushed===1?'':'s'} synced to the server.`);
      }
    } finally {
      syncing = false;
      broadcastStatus();
    }
    return { ok: true, pushed, failed, rejected };
  }

  // Every open page (dashboard shell + each tab) has its own copy of this engine. The Web Locks API makes
  // them take turns, so two frames never push the same outbox item twice (which would create duplicate records).
  async function trySync(opts){
    if (syncing) return { ok: false, error: 'Already syncing' };
    if (!navigator.onLine) return { ok: false, error: 'Offline' };
    const session = getSession();
    if (!session || !session.sessionToken) return { ok: false, error: 'Not logged in' };

    if (navigator.locks && navigator.locks.request) {
      const wait = !!(opts && opts.wait);
      let result = { ok: false, error: 'Another tab is syncing' };
      await navigator.locks.request('sms-sync', wait ? {} : { ifAvailable: true }, async (lock) => {
        if (!lock) return;
        result = await doSync();
      });
      return result;
    }
    return doSync();
  }

  /* ============================== STATUS / EVENTS ============================== */

  async function broadcastStatus(){
    const pending = await pendingCount();
    const detail = {
      online: navigator.onLine,
      syncing,
      pending,
      lastSynced: localStorage.getItem('sms_last_synced') || null
    };
    window.dispatchEvent(new CustomEvent('sms-sync-status', { detail }));
  }

  /* ============================== NOTIFICATIONS ============================== */

  function requestNotificationPermission(){
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(()=>{});
    }
  }

  function notify(title, body){
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification(title, { body, icon: 'icon-192.png' }); return; } catch(e){}
    }
    // Fallback: in-page toast
    showToast(`${title} — ${body}`);
  }

  function showToast(msg){
    let el = document.getElementById('smsToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'smsToast';
      el.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#14213D;color:#fff;padding:.6rem 1rem;border-radius:10px;font-size:.82rem;z-index:3000;box-shadow:0 8px 24px rgba(0,0,0,.3);max-width:90vw;text-align:center;transition:opacity .3s;';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(()=>{ el.style.opacity = '0'; }, 3500);
  }

  /* ============================== AUTO-SYNC TRIGGERS ============================== */

  window.addEventListener('online', () => { broadcastStatus(); notify('Back online', 'Syncing your changes now…'); trySync(); });
  window.addEventListener('offline', () => { broadcastStatus(); showToast('You are offline — changes will be saved and synced when you reconnect.'); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && navigator.onLine) trySync(); });

  function startAutoSync(intervalMs){
    if (autoSyncTimer) clearInterval(autoSyncTimer);
    autoSyncTimer = setInterval(() => { if (navigator.onLine) trySync(); }, intervalMs || 120000); // every 2 min
  }

  // Kick things off
  requestNotificationPermission();
  startAutoSync();
  broadcastStatus();
  if (navigator.onLine) trySync();

  // Expose public API
  window.smsSync = {
    saveRecord: smsSaveRecord,
    deleteRecord: smsDeleteRecord,
    getRecords: smsGetRecords,
    syncNow: () => trySync({ wait: true }),
    pendingCount,
    rejected: rejectedList,
    clearRejected,
    onStatus: (cb) => window.addEventListener('sms-sync-status', (e) => cb(e.detail)),
    toast: showToast
  };
})();
