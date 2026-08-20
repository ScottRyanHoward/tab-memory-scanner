// background.js (MV3 module service worker)
import { initDB, insertPage, getAllPages } from './lib/db.js';
import { embedText, cosineSimilarity } from './lib/embeddings.js';

let dbReady = initDB();

// Simple in-memory cache of embeddings for fast search without re-reading
// the whole DB every keystroke.
let embeddingCache = []; // [{ id, url, title, capturedAt, snippet, vector }]

// MV3 service workers are killed when idle and re-spawned by an incoming
// message — and that wake fires NEITHER onInstalled NOR onStartup. So we
// can't rely on those events to populate the cache; a search that wakes a
// cold worker would otherwise run against an empty cache and return nothing.
// Instead build the cache lazily and single-flighted: the first handler to
// need it kicks off the load, everyone else awaits the same promise.
let cacheReadyPromise = null;

function ensureCache() {
  if (!cacheReadyPromise) {
    cacheReadyPromise = (async () => {
      await dbReady;
      const pages = await getAllPages();
      embeddingCache = pages.map(p => ({
        id: p.id,
        url: p.url,
        title: p.title,
        capturedAt: p.capturedAt,
        snippet: p.text.slice(0, 300),
        vector: p.vector
      }));
    })().catch(err => {
      // Let a later call retry rather than caching a rejected promise forever.
      cacheReadyPromise = null;
      throw err;
    });
  }
  return cacheReadyPromise;
}

// Warm the cache eagerly when these do fire (install/browser start), but
// correctness no longer depends on them — ensureCache() covers the wake path.
chrome.runtime.onInstalled.addListener(() => { ensureCache(); });
chrome.runtime.onStartup.addListener(() => { ensureCache(); });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PAGE_CAPTURE') {
    handleCapture(message)
      .then(() => sendResponse({ ok: true }))
      .catch(err => {
        console.error('[tab-memory] capture failed', err);
        sendResponse({ ok: false, error: String(err && err.message || err) });
      });
    return true; // keep channel open for async response
  }

  if (message.type === 'SEARCH_QUERY') {
    handleSearch(message.query)
      .then(sendResponse)
      .catch(err => {
        // Always respond, otherwise the popup hangs on "Searching…" forever.
        console.error('[tab-memory] search failed', err);
        sendResponse({ results: [], error: String(err && err.message || err) });
      });
    return true;
  }

  return false;
});

async function handleCapture(payload) {
  if (!payload.text || payload.text.length < 200) return; // skip near-empty pages
  await ensureCache(); // also awaits dbReady, and loads existing pages once

  const vector = await embedText(`${payload.title}\n\n${payload.text}`);

  const record = {
    url: payload.url,
    title: payload.title,
    text: payload.text,
    referrer: payload.referrer,
    capturedAt: payload.capturedAt,
    vector
  };

  const id = await insertPage(record);
  embeddingCache.push({
    id,
    url: record.url,
    title: record.title,
    capturedAt: record.capturedAt,
    snippet: record.text.slice(0, 300),
    vector
  });
}

async function handleSearch(query) {
  if (!query || !query.trim()) return { results: [] };
  await ensureCache(); // ensure the cache is populated even on a cold wake

  const queryVector = await embedText(query);

  const scored = embeddingCache.map(item => ({
    ...item,
    score: cosineSimilarity(queryVector, item.vector)
  }));

  scored.sort((a, b) => b.score - a.score);

  return {
    results: scored.slice(0, 20).map(({ vector, ...rest }) => rest)
  };
}
