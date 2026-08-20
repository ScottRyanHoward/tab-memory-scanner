// lib/db.js
// Wraps sql.js (SQLite compiled to WASM) with persistence into IndexedDB,
// since MV3 service workers can't write directly to disk.
//
// Schema:
//   pages(id INTEGER PRIMARY KEY, url TEXT, title TEXT, text TEXT,
//         referrer TEXT, capturedAt TEXT, vector TEXT)
//
// `vector` is stored as a JSON-stringified float array. For a weekend MVP
// this is fine; if the DB grows large, swap for a proper vector index
// (e.g. hnswlib-wasm) later.

import initSqlJs from './sql-wasm.js'; // vendored sql.js loader, see README

const IDB_NAME = 'tab-memory-db';
const IDB_STORE = 'sqlite-file';
const IDB_KEY = 'db-bytes';

let SQL = null;
let db = null;

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadBytes() {
  const idb = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function saveBytes(bytes) {
  const idb = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(bytes, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function initDB() {
  SQL = await initSqlJs({ locateFile: file => `lib/${file}` });

  const existing = await loadBytes();
  db = existing ? new SQL.Database(new Uint8Array(existing)) : new SQL.Database();

  db.run(`
    CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      title TEXT,
      text TEXT,
      referrer TEXT,
      capturedAt TEXT,
      vector TEXT
    );
  `);

  await persist();
}

async function persist() {
  const bytes = db.export();
  await saveBytes(bytes);
}

export async function insertPage(record) {
  db.run(
    `INSERT INTO pages (url, title, text, referrer, capturedAt, vector)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      record.url,
      record.title,
      record.text,
      record.referrer,
      record.capturedAt,
      JSON.stringify(record.vector)
    ]
  );
  const id = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
  await persist();
  return id;
}

export async function getAllPages() {
  const res = db.exec('SELECT id, url, title, text, referrer, capturedAt, vector FROM pages');
  if (!res.length) return [];

  return res[0].values.map(row => ({
    id: row[0],
    url: row[1],
    title: row[2],
    text: row[3],
    referrer: row[4],
    capturedAt: row[5],
    vector: JSON.parse(row[6])
  }));
}
