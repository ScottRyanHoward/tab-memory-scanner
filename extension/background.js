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

// Relevance cutoff for search. Scores are cosine similarity of L2-normalized
// MiniLM embeddings (roughly 0..1). Below this we treat a page as "not a match"
// so weak/unrelated pages are dropped instead of padding out the results.
// Tune against the "[tab-memory] top scores" logs if results feel too loose/tight.
const MIN_SCORE = 0.3;
const MAX_RESULTS = 20;

// Conversational queries ("what was that page about car parts?") carry filler
// words that dilute the embedding. Strip common question/stop words plus words
// people use to refer to the browsing item itself ("page", "article", "saw"),
// so the query vector focuses on the actual topic. Falls back to the raw query
// if stripping would leave nothing.
const QUERY_STOPWORDS = new Set([
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'it', 'its',
  'i', 'me', 'my', 'we', 'our', 'you', 'your',
  'what', 'whats', 'which', 'who', 'whom', 'where', 'when', 'why', 'how',
  'was', 'were', 'is', 'are', 'am', 'be', 'been', 'being',
  'do', 'did', 'does', 'done', 'have', 'has', 'had',
  'of', 'on', 'in', 'to', 'for', 'from', 'about', 'with', 'at', 'by', 'as', 'into', 'over',
  'and', 'or', 'but', 'if', 'so', 'than', 'then',
  'page', 'pages', 'site', 'sites', 'website', 'websites', 'article', 'articles',
  'link', 'links', 'tab', 'tabs', 'thing', 'things', 'something', 'someone',
  'see', 'saw', 'seen', 'read', 'find', 'found', 'looking', 'look', 'viewed', 'visit', 'visited',
  'again', 'around', 'some', 'any', 'there', 'here'
]);

function normalizeQuery(query) {
  const cleaned = query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // drop punctuation
    .split(/\s+/)
    .filter(w => w && !QUERY_STOPWORDS.has(w))
    .join(' ')
    .trim();
  return cleaned || query.trim(); // fall back if we stripped everything
}

async function handleSearch(query) {
  if (!query || !query.trim()) return { results: [] };
  await ensureCache(); // ensure the cache is populated even on a cold wake

  const searchText = normalizeQuery(query);
  const queryVector = await embedText(searchText);

  const scored = embeddingCache.map(item => ({
    ...item,
    score: cosineSimilarity(queryVector, item.vector)
  }));

  scored.sort((a, b) => b.score - a.score);

  // Log the strongest scores so the MIN_SCORE threshold can be tuned to real data.
  console.log('[tab-memory] query %o -> normalized %o; top scores:', query, searchText,
    scored.slice(0, 8).map(s => ({ score: +s.score.toFixed(3), title: s.title })));

  const relevant = scored
    .filter(s => s.score >= MIN_SCORE)
    .slice(0, MAX_RESULTS);

  return {
    results: relevant.map(({ vector, ...rest }) => rest)
  };
}
