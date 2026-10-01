// src/db.js — IndexedDB wrapper. Hoja pura.

export const DB_NAME    = "omgscan";
export const DB_VERSION = 1;
export const STORE      = "documents";

let _dbPromise = null;

export function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
  return _dbPromise;
}

export async function dbPut(doc) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(doc);
    tx.oncomplete = () => res(doc);
    tx.onerror    = () => rej(tx.error);
  });
}

export async function dbGetAll() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx  = db.transaction(STORE, "readonly");
    const out = [];
    const req = tx.objectStore(STORE).openCursor();
    req.onsuccess = (e) => {
      const c = e.target.result;
      if (c) { out.push(c.value); c.continue(); }
      else res(out.sort((a, b) => b.updatedAt - a.updatedAt));
    };
    req.onerror = () => rej(req.error);
  });
}

export async function dbGet(id) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx  = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => res(req.result || null);
    req.onerror   = () => rej(req.error);
  });
}

export async function dbDelete(id) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => res();
    tx.onerror    = () => rej(tx.error);
  });
}

export async function dbCount() {
  const db = await openDB();
  return new Promise((res) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).count();
    req.onsuccess = () => res(req.result);
    req.onerror   = () => res(0);
  });
}