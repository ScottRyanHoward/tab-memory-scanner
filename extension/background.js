// background.js (MV3 module service worker)
import { initDB, insertPage, getAllPages, getPagesByIds } from './lib/db.js';
import { embedText, cosineSimilarity } from './lib/embeddings.js';
import { answerQuestion, DEFAULT_MODEL } from './lib/llm.js';

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

  if (message.type === 'ASK') {
    handleAsk(message.query)
      .then(sendResponse)
      .catch(err => {
        console.error('[tab-memory] ask failed', err);
        sendResponse({ error: String(err && err.message || err) });
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
  'see', 'saw', 'seen', 'read', 'find', 'found', 'looking', 'look', 'lookup', 'viewed', 'visit', 'visited',
  'again', 'around', 'some', 'any', 'there', 'here',
  // phrasal-verb particles ("look up", "find out") that survive removing the verb
  'up', 'out', 'off'
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

// --- RAG question answering ---------------------------------------------------
// For answering we rank all pages and take the top-K by RELATIVE similarity,
// with only a tiny sanity floor to drop essentially-random matches. A hard
// relevance threshold hurts recall for category words: a query like "cars"
// may never literally appear on a Subaru page, so its absolute score is low
// even though it's clearly the best match. Ranking + a low floor keeps it, and
// Claude makes the final relevance call (its prompt says to admit when nothing
// fits), so weak-but-correct matches still get answered.
const RAG_TOP_K = 8;
const RAG_MIN_SCORE = 0.05;

async function handleAsk(query) {
  if (!query || !query.trim()) return { answer: '', sources: [] };

  const { anthropicApiKey, anthropicModel } =
    await chrome.storage.local.get(['anthropicApiKey', 'anthropicModel']);
  if (!anthropicApiKey) {
    return { error: 'No Anthropic API key set. Open Settings (the ⚙ link) and add your key.' };
  }

  await ensureCache();

  if (!embeddingCache.length) {
    return { answer: "Your browsing history is empty so far — visit a few pages (give each ~10 seconds) and try again.", sources: [] };
  }

  const searchText = normalizeQuery(query);
  const queryVector = await embedText(searchText);

  const scored = embeddingCache
    .map(item => ({ ...item, score: cosineSimilarity(queryVector, item.vector) }))
    .sort((a, b) => b.score - a.score);

  console.log('[tab-memory] ask %o -> normalized %o; top scores:', query, searchText,
    scored.slice(0, 8).map(s => ({ score: +s.score.toFixed(3), title: s.title })));

  const top = scored.filter(s => s.score >= RAG_MIN_SCORE).slice(0, RAG_TOP_K);
  if (!top.length) {
    return { answer: "I couldn't find anything relevant in your browsing history for that.", sources: [] };
  }

  // Pull full text for the top candidates and restore ranking order.
  const fetched = await getPagesByIds(top.map(t => t.id));
  const byId = new Map(fetched.map(p => [p.id, p]));
  const pages = top.map(t => byId.get(t.id)).filter(Boolean);

  const model = anthropicModel || DEFAULT_MODEL;
  const answer = await answerQuestion({ question: query, pages, apiKey: anthropicApiKey, model });

  return {
    answer,
    sources: pages.map(p => ({ url: p.url, title: p.title, capturedAt: p.capturedAt }))
  };
}
