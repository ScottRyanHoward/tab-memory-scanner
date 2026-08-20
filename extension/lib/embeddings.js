// lib/embeddings.js
// Generates text embeddings fully on-device using transformers.js with a
// small MiniLM model (~25MB, cached after first download). Nothing is
// sent to any server — this is the whole point of the project.

import { pipeline, env } from './transformers.min.js'; // vendored, see README

// We vendor transformers.js but NOT the model weights, and MV3's CSP won't let
// us load remote *code*. Model files are data (fetched, not eval'd), so remote
// model loading is fine — but make sure transformers doesn't waste time probing
// for local model files inside the extension (which would 404).
env.allowLocalModels = false;
env.allowRemoteModels = true;

let extractorPromise = null;

function getExtractor() {
  if (!extractorPromise) {
    console.log('[tab-memory] loading embedding model (first use downloads ~25MB)…');
    extractorPromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      progress_callback: (p) => {
        if (p && p.status === 'progress' && p.file) {
          console.log(`[tab-memory] model ${p.file}: ${Math.round(p.progress || 0)}%`);
        } else if (p && p.status) {
          console.log(`[tab-memory] model ${p.status}${p.file ? ' ' + p.file : ''}`);
        }
      }
    }).then(
      (extractor) => { console.log('[tab-memory] embedding model ready'); return extractor; },
      (err) => { extractorPromise = null; console.error('[tab-memory] model load failed', err); throw err; }
    );
  }
  return extractorPromise;
}

export async function embedText(text) {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

export function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  // vectors are already normalized by the extractor, so dot product
  // alone approximates cosine similarity
  return dot;
}
