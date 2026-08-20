// background.js (MV3 module service worker)
import { initDB, insertPage, getAllPages } from './lib/db.js';
import { embedText, cosineSimilarity } from './lib/embeddings.js';

let dbReady = initDB();

// Simple in-memory cache of embeddings for fast search without re-reading
// the whole DB every keystroke. Rebuilt on startup and updated on insert.
let embeddingCache = []; // [{ id, url, title, capturedAt, snippet, vector }]

async function rebuildCache() {
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
}

chrome.runtime.onInstalled.addListener(async () => {
  await dbReady;
  await rebuildCache();
});

chrome.runtime.onStartup.addListener(async () => {
  await dbReady;
  await rebuildCache();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PAGE_CAPTURE') {
    handleCapture(message).then(() => sendResponse({ ok: true }));
    return true; // keep channel open for async response
  }

  if (message.type === 'SEARCH_QUERY') {
    handleSearch(message.query).then(sendResponse);
    return true;
  }

  return false;
});

async function handleCapture(payload) {
  if (!payload.text || payload.text.length < 200) return; // skip near-empty pages
  await dbReady;

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
